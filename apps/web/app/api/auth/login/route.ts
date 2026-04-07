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
  provider: z.enum(PORTAL_PROVIDER_VALUES).optional().default("CU12"),
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

function rateLimitedLoginError() {
  return jsonError("Too many authentication attempts. Please try again shortly.", 429, "RATE_LIMITED");
}

function authenticationFailedError() {
  return jsonError("Authentication failed.", 401, "AUTH_FAILED");
}

function accountDisabledError() {
  return jsonError("Account is disabled.", 401, "ACCOUNT_DISABLED");
}

export async function POST(request: NextRequest) {
  if (!hasValidCsrfOrigin(request)) {
    return jsonError("Forbidden", 403, "CSRF_ORIGIN_INVALID");
  }

  try {
    let body: z.output<typeof BodySchema>;
    try {
      body = BodySchema.parse(await request.json());
    } catch (error) {
      if (error instanceof SyntaxError) {
        return jsonError("Invalid request body.", 400, "VALIDATION_ERROR");
      }
      throw error;
    }

    const provider = normalizePortalProvider(body.provider);
    const campus = provider === "CU12" ? (body.campus ?? "SONGSIM") : null;
    const sessionPolicy = resolveSessionLifetimePolicy(body.rememberSession);
    const loginIp = getRequestIp(request);
    const throttleIdentifiers = [loginIp ? `ip:${loginIp}` : null, `portal:${provider}:${body.cu12Id}`];
    const throttle = await checkAuthThrottleBestEffort("login", throttleIdentifiers);
    if (throttle.blocked) {
      return rateLimitedLoginError();
    }

    const localCandidate = await withWithdrawnAtFallback(
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
    );

    if (localCandidate?.isTestUser) {
      if (!localCandidate.isActive || localCandidate.withdrawnAt !== null) {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
        return accountDisabledError();
      }

      const ok = await verifyPassword(body.cu12Password, localCandidate.passwordHash);
      if (!ok) {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
        return authenticationFailedError();
      }

      const consent = await getPolicyConsentRequirement(localCandidate.id);
      if (!consent.configured && localCandidate.role !== "ADMIN") {
        return jsonError(
          "Required policy documents are not configured by an administrator.",
          503,
          "POLICY_NOT_CONFIGURED",
        );
      }
      if (consent.configured && consent.required) {
        const consentToken = await signPolicyConsentChallengeToken({
          userId: localCandidate.id,
          email: body.cu12Id,
          role: localCandidate.role,
          rememberSession: sessionPolicy.rememberSession,
          firstLogin: false,
        });
        await clearAuthFailuresBestEffort("login", throttleIdentifiers);
        return jsonOk({
          stage: "CONSENT_REQUIRED" as const,
          consentToken,
          policies: consent.policies,
          user: {
            userId: localCandidate.id,
            provider,
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

      const sessionToken = await signSessionToken(
        {
          userId: localCandidate.id,
          email: body.cu12Id,
          role: localCandidate.role,
        },
        {
          maxAgeSeconds: sessionPolicy.sessionMaxAgeSeconds,
        },
      );
      const idleSessionToken = await signIdleSessionToken(localCandidate.id, {
        rememberSession: sessionPolicy.rememberSession,
        maxAgeSeconds: sessionPolicy.idleSessionMaxAgeSeconds,
      });

      const response = jsonOk({
        stage: "AUTHENTICATED" as const,
        user: {
          userId: localCandidate.id,
          provider,
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

      await prisma.user.update({
        where: { id: localCandidate.id },
        data: {
          lastLoginAt: new Date(),
          lastLoginIp: loginIp,
        },
      });

      await writeAuditLogBestEffort({
        category: "AUTH",
        severity: "INFO",
        actorUserId: localCandidate.id,
        targetUserId: localCandidate.id,
        message: "User authenticated using local credentials",
        meta: {
          provider,
          cu12Id: body.cu12Id,
          campus,
          loginIp,
        },
      });
      await clearAuthFailuresBestEffort("login", throttleIdentifiers);
      return response;
    }

    const validation = await verifyPortalLogin({
      provider,
      cu12Id: body.cu12Id,
      cu12Password: body.cu12Password,
      campus,
    });
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
          provider,
          cu12Id: body.cu12Id,
          campus,
          messageCode: validation.messageCode ?? null,
        },
      });
      if (unavailable) {
        return jsonError("Authentication service unavailable.", 503, "PORTAL_UNAVAILABLE");
      }
      return authenticationFailedError();
    }

    const existingAccount = await prisma.cu12Account.findUnique({
      where: {
        provider_cu12Id: {
          provider,
          cu12Id: body.cu12Id,
        },
      },
      select: { userId: true },
    });
    const existingUserByEmail = await withWithdrawnAtFallback(
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
    );

    let user:
      | {
        id: string;
        email: string;
        role: "ADMIN" | "USER";
      }
      | undefined;

    if (existingAccount) {
      const found = await withWithdrawnAtFallback(
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
      );

      if (!found) {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
        return authenticationFailedError();
      }
      if (!found.isActive || found.withdrawnAt !== null) {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
        return accountDisabledError();
      }

      user = await prisma.user.update({
        where: { id: found.id },
        data: { email: body.cu12Id },
        select: { id: true, email: true, role: true },
      });

      await upsertCu12Account(user.id, {
        provider,
        cu12Id: body.cu12Id,
        cu12Password: body.cu12Password,
        campus,
      });
    } else if (existingUserByEmail) {
      if (!existingUserByEmail.isActive || existingUserByEmail.withdrawnAt !== null) {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
        return accountDisabledError();
      }

      user = existingUserByEmail;

      await upsertCu12Account(user.id, {
        provider,
        cu12Id: body.cu12Id,
        cu12Password: body.cu12Password,
        campus,
      });
    } else {
      const challengeToken = await signLoginChallengeToken({
        provider,
        cu12Id: body.cu12Id,
        campus,
        encryptedCu12Password: encryptSecret(body.cu12Password),
        nonce: randomUUID(),
      });

      await writeAuditLogBestEffort({
        category: "AUTH",
        severity: "INFO",
        message: "Login challenge issued for first-time portal user",
        meta: {
          provider,
          cu12Id: body.cu12Id,
          campus,
        },
      });
      await clearAuthFailuresBestEffort("login", throttleIdentifiers);

      return jsonOk({
        stage: "INVITE_REQUIRED" as const,
        challengeToken,
      });
    }

    if (!user) {
      return jsonError("Failed to resolve user.", 500, "INTERNAL_ERROR");
    }

    const sessionToken = await signSessionToken(
      {
        userId: user.id,
        email: body.cu12Id,
        role: user.role,
      },
      {
        maxAgeSeconds: sessionPolicy.sessionMaxAgeSeconds,
      },
    );
    const consent = await getPolicyConsentRequirement(user.id);
    if (!consent.configured && user.role !== "ADMIN") {
      return jsonError(
        "Required policy documents are not configured by an administrator.",
        503,
        "POLICY_NOT_CONFIGURED",
      );
    }
    if (consent.configured && consent.required) {
      const consentToken = await signPolicyConsentChallengeToken({
        userId: user.id,
        email: body.cu12Id,
        role: user.role,
        rememberSession: sessionPolicy.rememberSession,
        firstLogin: false,
      });
      await clearAuthFailuresBestEffort("login", throttleIdentifiers);
      return jsonOk({
        stage: "CONSENT_REQUIRED" as const,
        consentToken,
        policies: consent.policies,
        user: {
          userId: user.id,
          provider,
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

    const idleSessionToken = await signIdleSessionToken(user.id, {
      rememberSession: sessionPolicy.rememberSession,
      maxAgeSeconds: sessionPolicy.idleSessionMaxAgeSeconds,
    });

    const response = jsonOk({
      stage: "AUTHENTICATED" as const,
      user: {
        userId: user.id,
        provider,
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

    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: loginIp,
      },
    });

    await writeAuditLogBestEffort({
      category: "AUTH",
      severity: "INFO",
      actorUserId: user.id,
      targetUserId: user.id,
      message: "User authenticated with portal credentials",
      meta: {
        provider,
        cu12Id: body.cu12Id,
        campus,
        loginIp,
      },
    });
    await clearAuthFailuresBestEffort("login", throttleIdentifiers);

    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(
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
        meta: {
          code,
        },
      });
      return jsonError("Authentication failed.", 500, `INTERNAL_DB_${code}`);
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
        return jsonError("Authentication service unavailable.", 503, "PORTAL_UNAVAILABLE");
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
    return jsonError("Authentication failed.", 500, "INTERNAL_ERROR");
  }
}
