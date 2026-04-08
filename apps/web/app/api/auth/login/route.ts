import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  resolveSessionLifetimePolicy,
  signPolicyConsentChallengeToken,
  verifyPassword,
  signIdleSessionToken,
  signLoginChallengeToken,
  signSessionToken,
} from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { getRequestIp, hasValidCsrfOrigin, jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { applyServerTimingHeader, ServerTiming } from "@/lib/server-timing";
import { setIdleSessionCookieWithMaxAge, setSessionCookieWithMaxAge } from "@/lib/session-cookie";
import { withWithdrawnAtFallback } from "@/lib/withdrawn-compat";
import {
  checkAuthThrottleBestEffort,
  clearAuthFailuresBestEffort,
  recordAuthFailureBestEffort,
  writeAuditLogBestEffort,
} from "@/server/auth-best-effort";
import { upsertCu12Account } from "@/server/cu12-account";
import { isPortalUnavailableResult, verifyPortalLogin } from "@/server/portal-login";
import { normalizePortalProvider, PORTAL_PROVIDER_VALUES } from "@/server/portal-provider";
import { getPolicyConsentRequirement } from "@/server/policy";

const BodySchema = z.object({
  provider: z.enum(PORTAL_PROVIDER_VALUES).optional(),
  cu12Id: z.string().trim().min(4).max(80),
  cu12Password: z.string().min(4).max(120),
  campus: z.enum(["SONGSIM", "SONGSIN"]).default("SONGSIM"),
  rememberSession: z.boolean().optional().default(false),
});

function isPrismaError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError
    || error instanceof Prisma.PrismaClientUnknownRequestError
    || error instanceof Prisma.PrismaClientInitializationError
    || error instanceof Prisma.PrismaClientValidationError
  ) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as Record<string, unknown>;
  return typeof candidate.name === "string" && candidate.name.startsWith("Prisma");
}

function prismaErrorCode(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.code === "string" && candidate.code.length > 0) {
      return candidate.code;
    }
  }
  return "UNKNOWN";
}

function runInBackground(work: () => Promise<unknown>) {
  void work().catch(() => undefined);
}

function attachTiming(response: Response, timing: ServerTiming): Response {
  return applyServerTimingHeader(response, timing);
}

function scheduleAuthSuccessSideEffects(input: {
  userId: string;
  provider: string | null;
  message: string;
  cu12Id: string;
  campus: "SONGSIM" | "SONGSIN";
  loginIp: string | null;
}) {
  runInBackground(async () => {
    await Promise.allSettled([
      prisma.user.update({
        where: { id: input.userId },
        data: {
          lastLoginAt: new Date(),
          lastLoginIp: input.loginIp,
        },
      }),
      writeAuditLogBestEffort({
        category: "AUTH",
        severity: "INFO",
        actorUserId: input.userId,
        targetUserId: input.userId,
        message: input.message,
        meta: {
          provider: input.provider,
          cu12Id: input.cu12Id,
          campus: input.campus,
          loginIp: input.loginIp,
        },
      }),
    ]);
  });
}

export async function POST(request: NextRequest) {
  const timing = new ServerTiming();
  const timedError = (message: string, status = 400, errorCode?: string) =>
    attachTiming(jsonError(message, status, errorCode), timing);
  const timedOk = <T>(data: T, init?: ResponseInit) =>
    attachTiming(jsonOk(data, init), timing);

  if (!hasValidCsrfOrigin(request)) {
    return timedError("Forbidden", 403, "CSRF_ORIGIN_INVALID");
  }

  try {
    let body: z.output<typeof BodySchema>;
    try {
      body = BodySchema.parse(await request.json());
    } catch (error) {
      if (error instanceof SyntaxError) {
        return timedError("Invalid request body.", 400, "VALIDATION_ERROR");
      }
      throw error;
    }

    const explicitProviderHint = body.provider ? normalizePortalProvider(body.provider) : undefined;
    const campus = body.campus ?? "SONGSIM";
    const sessionPolicy = resolveSessionLifetimePolicy(body.rememberSession);
    const loginIp = getRequestIp(request);
    const throttleIdentifiers = [loginIp ? `ip:${loginIp}` : null, `portal:${body.cu12Id}`];
    const throttle = await timing.measure("auth-throttle", () =>
      checkAuthThrottleBestEffort("login", throttleIdentifiers),
    );
    if (throttle.blocked) {
      return timedError("Too many authentication attempts. Please try again shortly.", 429, "RATE_LIMITED");
    }

    const [existingAccount, localCandidate] = await Promise.all([
      timing.measure("provider-detect", () =>
        prisma.cu12Account.findUnique({
          where: { cu12Id: body.cu12Id },
          select: { userId: true, provider: true },
        }),
      ),
      timing.measure("local-user", () =>
        withWithdrawnAtFallback(
          () =>
            prisma.user.findUnique({
              where: { email: body.cu12Id },
              select: {
                id: true,
                email: true,
                role: true,
                isActive: true,
                withdrawnAt: true,
                isTestUser: true,
                passwordHash: true,
              },
            }),
          () =>
            prisma.user.findUnique({
              where: { email: body.cu12Id },
              select: {
                id: true,
                email: true,
                role: true,
                isActive: true,
                isTestUser: true,
                passwordHash: true,
              },
            }),
        ),
      ),
    ]);

    const storedCurrentProvider = existingAccount?.provider
      ? normalizePortalProvider(existingAccount.provider)
      : undefined;
    const resolvedCurrentProvider = explicitProviderHint ?? storedCurrentProvider;

    if (localCandidate?.isTestUser) {
      if (!localCandidate.isActive || localCandidate.withdrawnAt !== null) {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
        return timedError("Account is disabled.", 401, "ACCOUNT_DISABLED");
      }

      const passwordValid = await timing.measure("password", () =>
        verifyPassword(body.cu12Password, localCandidate.passwordHash),
      );
      if (!passwordValid) {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
        return timedError("Authentication failed.", 401, "AUTH_FAILED");
      }

      const consent = await timing.measure("policy", () =>
        getPolicyConsentRequirement(localCandidate.id),
      );
      if (!consent.configured && localCandidate.role !== "ADMIN") {
        return timedError(
          "Required policy documents are not configured by an administrator.",
          503,
          "POLICY_NOT_CONFIGURED",
        );
      }
      if (consent.configured && consent.required) {
        const consentToken = await timing.measure("session", () =>
          signPolicyConsentChallengeToken({
            userId: localCandidate.id,
            email: body.cu12Id,
            role: localCandidate.role,
            rememberSession: sessionPolicy.rememberSession,
            firstLogin: false,
          }),
        );
        await clearAuthFailuresBestEffort("login", throttleIdentifiers);
        return timedOk({
          stage: "CONSENT_REQUIRED" as const,
          consentToken,
          policies: consent.policies,
          user: {
            userId: localCandidate.id,
            provider: resolvedCurrentProvider ?? undefined,
            cu12Id: body.cu12Id,
            role: localCandidate.role,
          },
          firstLogin: false,
          session: {
            rememberSession: sessionPolicy.rememberSession,
            sessionMaxAgeSeconds: sessionPolicy.sessionMaxAgeSeconds,
            idleMaxAgeSeconds: sessionPolicy.idleSessionMaxAgeSeconds,
          },
        });
      }

      const [sessionToken, idleSessionToken] = await timing.measure("session", () =>
        Promise.all([
          signSessionToken(
            {
              userId: localCandidate.id,
              email: body.cu12Id,
              role: localCandidate.role,
            },
            {
              maxAgeSeconds: sessionPolicy.sessionMaxAgeSeconds,
            },
          ),
          signIdleSessionToken(localCandidate.id, {
            rememberSession: sessionPolicy.rememberSession,
            maxAgeSeconds: sessionPolicy.idleSessionMaxAgeSeconds,
          }),
        ]),
      );

      const response = jsonOk({
        stage: "AUTHENTICATED" as const,
        user: {
          userId: localCandidate.id,
          provider: resolvedCurrentProvider ?? undefined,
          cu12Id: body.cu12Id,
          role: localCandidate.role,
        },
        firstLogin: false,
        session: {
          rememberSession: sessionPolicy.rememberSession,
          sessionMaxAgeSeconds: sessionPolicy.sessionMaxAgeSeconds,
          idleMaxAgeSeconds: sessionPolicy.idleSessionMaxAgeSeconds,
        },
      });
      setSessionCookieWithMaxAge(response, sessionToken, sessionPolicy.sessionMaxAgeSeconds);
      setIdleSessionCookieWithMaxAge(response, idleSessionToken, sessionPolicy.idleSessionMaxAgeSeconds);
      await clearAuthFailuresBestEffort("login", throttleIdentifiers);

      scheduleAuthSuccessSideEffects({
        userId: localCandidate.id,
        provider: resolvedCurrentProvider ?? null,
        message: "User authenticated using local credentials",
        cu12Id: body.cu12Id,
        campus,
        loginIp,
      });
      return attachTiming(response, timing);
    }

    const validation = await timing.measure("external-portal", () =>
      verifyPortalLogin({
        providerHint: explicitProviderHint,
        cu12Id: body.cu12Id,
        cu12Password: body.cu12Password,
        campus,
      }),
    );

    if (!validation.ok) {
      const unavailable = isPortalUnavailableResult(validation);
      if (!unavailable) {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
      }
      await writeAuditLogBestEffort({
        category: "AUTH",
        severity: unavailable ? "ERROR" : "WARN",
        message: unavailable
          ? "Authentication failed due to portal network failure"
          : "Portal login validation failed",
        meta: {
          provider: explicitProviderHint ?? validation.verifiedProvider ?? storedCurrentProvider ?? null,
          cu12Id: body.cu12Id,
          campus,
          messageCode: validation.messageCode ?? null,
        },
      });
      if (unavailable) {
        return timedError("Authentication service unavailable.", 503, "PORTAL_UNAVAILABLE");
      }
      return timedError("Authentication failed.", 401, "AUTH_FAILED");
    }

    const verifiedProvider = validation.verifiedProvider ?? explicitProviderHint ?? "CU12";
    const currentProvider = resolvedCurrentProvider ?? verifiedProvider;
    const verifiedCampus = verifiedProvider === "CU12" ? campus : undefined;
    const existingUserByEmail = await timing.measure("portal-user", () =>
      withWithdrawnAtFallback(
        () =>
          prisma.user.findUnique({
            where: { email: body.cu12Id },
            select: { id: true, email: true, role: true, isActive: true, withdrawnAt: true },
          }),
        () =>
          prisma.user.findUnique({
            where: { email: body.cu12Id },
            select: { id: true, email: true, role: true, isActive: true },
          }),
      ),
    );

    let user:
      | {
        id: string;
        email: string;
        role: "ADMIN" | "USER";
      }
      | undefined;

    if (existingAccount) {
      const found = await timing.measure("account-user", () =>
        withWithdrawnAtFallback(
          () =>
            prisma.user.findUnique({
              where: { id: existingAccount.userId },
              select: { id: true, email: true, role: true, isActive: true, withdrawnAt: true },
            }),
          () =>
            prisma.user.findUnique({
              where: { id: existingAccount.userId },
              select: { id: true, email: true, role: true, isActive: true },
            }),
        ),
      );

      if (!found) {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
        return timedError("Authentication failed.", 401, "AUTH_FAILED");
      }
      if (!found.isActive || found.withdrawnAt !== null) {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
        return timedError("Account is disabled.", 401, "ACCOUNT_DISABLED");
      }

      user = await timing.measure("account-link", () =>
        prisma.user.update({
          where: { id: found.id },
          data: { email: body.cu12Id },
          select: { id: true, email: true, role: true },
        }),
      );

      await timing.measure("account-upsert", () =>
        upsertCu12Account(user!.id, {
          currentProvider,
          cu12Id: body.cu12Id,
          cu12Password: body.cu12Password,
          campus: verifiedCampus,
        }),
      );
    } else if (existingUserByEmail) {
      if (!existingUserByEmail.isActive || existingUserByEmail.withdrawnAt !== null) {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
        return timedError("Account is disabled.", 401, "ACCOUNT_DISABLED");
      }

      user = existingUserByEmail;
      await timing.measure("account-upsert", () =>
        upsertCu12Account(user!.id, {
          currentProvider,
          cu12Id: body.cu12Id,
          cu12Password: body.cu12Password,
          campus: verifiedCampus,
        }),
      );
    } else {
      const challengeToken = await timing.measure("session", () =>
        signLoginChallengeToken({
          provider: verifiedProvider,
          cu12Id: body.cu12Id,
          campus: verifiedProvider === "CU12" ? campus : null,
          encryptedCu12Password: encryptSecret(body.cu12Password),
          nonce: randomUUID(),
        }),
      );

      runInBackground(async () => {
        await Promise.allSettled([
          writeAuditLogBestEffort({
            category: "AUTH",
            severity: "INFO",
            message: "Login challenge issued for first-time portal user",
            meta: {
              provider: verifiedProvider,
              cu12Id: body.cu12Id,
              campus,
            },
          }),
        ]);
      });
      await clearAuthFailuresBestEffort("login", throttleIdentifiers);

      return timedOk({
        stage: "INVITE_REQUIRED" as const,
        challengeToken,
      });
    }

    if (!user) {
      return timedError("Failed to resolve user.", 500, "INTERNAL_ERROR");
    }

    const consent = await timing.measure("policy", () =>
      getPolicyConsentRequirement(user.id),
    );
    if (!consent.configured && user.role !== "ADMIN") {
      return timedError(
        "Required policy documents are not configured by an administrator.",
        503,
        "POLICY_NOT_CONFIGURED",
      );
    }
    if (consent.configured && consent.required) {
      const consentToken = await timing.measure("session", () =>
        signPolicyConsentChallengeToken({
          userId: user.id,
          email: body.cu12Id,
          role: user.role,
          rememberSession: sessionPolicy.rememberSession,
          firstLogin: false,
        }),
      );
      await clearAuthFailuresBestEffort("login", throttleIdentifiers);
      return timedOk({
        stage: "CONSENT_REQUIRED" as const,
        consentToken,
        policies: consent.policies,
        user: {
          userId: user.id,
          provider: currentProvider,
          cu12Id: body.cu12Id,
          role: user.role,
        },
        firstLogin: false,
        session: {
          rememberSession: sessionPolicy.rememberSession,
          sessionMaxAgeSeconds: sessionPolicy.sessionMaxAgeSeconds,
          idleMaxAgeSeconds: sessionPolicy.idleSessionMaxAgeSeconds,
        },
      });
    }

    const [sessionToken, idleSessionToken] = await timing.measure("session", () =>
      Promise.all([
        signSessionToken(
          {
            userId: user.id,
            email: body.cu12Id,
            role: user.role,
          },
          {
            maxAgeSeconds: sessionPolicy.sessionMaxAgeSeconds,
          },
        ),
        signIdleSessionToken(user.id, {
          rememberSession: sessionPolicy.rememberSession,
          maxAgeSeconds: sessionPolicy.idleSessionMaxAgeSeconds,
        }),
      ]),
    );

    const response = jsonOk({
      stage: "AUTHENTICATED" as const,
      user: {
        userId: user.id,
        provider: currentProvider,
        cu12Id: body.cu12Id,
        role: user.role,
      },
      firstLogin: false,
      session: {
        rememberSession: sessionPolicy.rememberSession,
        sessionMaxAgeSeconds: sessionPolicy.sessionMaxAgeSeconds,
        idleMaxAgeSeconds: sessionPolicy.idleSessionMaxAgeSeconds,
      },
    });
    setSessionCookieWithMaxAge(response, sessionToken, sessionPolicy.sessionMaxAgeSeconds);
    setIdleSessionCookieWithMaxAge(response, idleSessionToken, sessionPolicy.idleSessionMaxAgeSeconds);
    await clearAuthFailuresBestEffort("login", throttleIdentifiers);

    scheduleAuthSuccessSideEffects({
      userId: user.id,
      provider: currentProvider,
      message: "User authenticated with portal credentials",
      cu12Id: body.cu12Id,
      campus,
      loginIp,
    });

    return attachTiming(response, timing);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return timedError(
        error.issues.map((it) => it.message).join(", "),
        400,
        "VALIDATION_ERROR",
      );
    }
    if (isPrismaError(error)) {
      const code = prismaErrorCode(error);
      await writeAuditLogBestEffort({
        category: "AUTH",
        severity: "ERROR",
        message: "Authentication failed due to database error",
        meta: { code },
      });
      return timedError("Authentication failed.", 500, `INTERNAL_DB_${code}`);
    }
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      const networkFailure =
        message.includes("fetch failed")
        || message.includes("etimedout")
        || message.includes("econnrefused")
        || message.includes("enotfound")
        || message.includes("eai_again")
        || message.includes("network");
      if (networkFailure) {
        await writeAuditLogBestEffort({
          category: "AUTH",
          severity: "ERROR",
          message: "Authentication failed due to portal network failure",
          meta: {
            error: error.message,
          },
        });
        return timedError("Authentication service unavailable.", 503, "PORTAL_UNAVAILABLE");
      }
    }
    await writeAuditLogBestEffort({
      category: "AUTH",
      severity: "ERROR",
      message: "Authentication failed due to server error",
      meta: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return timedError("Authentication failed.", 500, "INTERNAL_ERROR");
  }
}
