import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  hashPassword,
  resolveSessionLifetimePolicy,
  signPolicyConsentChallengeToken,
  verifyPassword,
  signIdleSessionToken,
  signSessionToken,
} from "@/lib/auth";
import { getRequestIp, hasValidCsrfOrigin, jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { applyServerTimingHeader, ServerTiming } from "@/lib/server-timing";
import { setIdleSessionCookieWithMaxAge, setSessionCookieWithMaxAge } from "@/lib/session-cookie";
import { withIsTestUserFallback } from "@/lib/test-user-compat";
import { withWithdrawnAtFallback } from "@/lib/withdrawn-compat";
import { generateToken } from "@/lib/token";
import { queueAdminApprovalRequestMailJobs } from "@/server/admin-approval-mail";
import {
  checkAuthThrottleBestEffort,
  clearAuthFailuresBestEffort,
  recordAuthFailureBestEffort,
  writeAuditLogBestEffort,
} from "@/server/auth-best-effort";
import { getAccountProviderByCu12Id, upsertCu12Account } from "@/server/cu12-account";
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

type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

function approvalStatusOrApproved(value: ApprovalStatus | null | undefined): ApprovalStatus {
  return value ?? "APPROVED";
}

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

function isCompatibilityPrismaError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2021" || error.code === "P2022";
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return true;
  }
  return false;
}

function describePrismaError(error: unknown) {
  return {
    name: error instanceof Error ? error.name : typeof error,
    code: prismaErrorCode(error),
    message: error instanceof Error ? error.message : String(error),
  };
}

async function loadAuthLookupFallback(cu12Id: string) {
  console.warn(
    "[auth] Falling back to legacy login lookup compatibility mode. Optional auth columns are missing in the DB.",
  );

  const [legacyAccount, legacyUser] = await Promise.all([
    prisma.cu12Account.findFirst({
      where: { cu12Id },
      select: {
        userId: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    }).catch(() => null),
    prisma.user.findUnique({
      where: { email: cu12Id },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        passwordHash: true,
      },
    }).catch(() => null),
  ]);

  return {
    existingAccount: legacyAccount
      ? {
        userId: legacyAccount.userId,
        provider: "CU12" as const,
      }
      : null,
    localCandidate: legacyUser
      ? {
        ...legacyUser,
        withdrawnAt: null,
        isTestUser: false,
        approvalStatus: "APPROVED" as const,
      }
      : null,
  };
}

async function loadExistingUserByEmailFallback(cu12Id: string) {
  console.warn(
    "[auth] Falling back to legacy existing-user lookup by email during portal-auth reconciliation.",
  );

  const legacyUser = await prisma.user.findUnique({
    where: { email: cu12Id },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
    },
  }).catch(() => null);

  return legacyUser
    ? {
      ...legacyUser,
      withdrawnAt: null,
      approvalStatus: "APPROVED" as const,
    }
    : null;
}

async function loadExistingUserByIdFallback(userId: string) {
  console.warn(
    "[auth] Falling back to legacy existing-user lookup by id during account-link reconciliation.",
  );

  const legacyUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
    },
  }).catch(() => null);

  return legacyUser
    ? {
      ...legacyUser,
      withdrawnAt: null,
      approvalStatus: "APPROVED" as const,
    }
    : null;
}

function emptyPolicyConsentRequirement(): Awaited<ReturnType<typeof getPolicyConsentRequirement>> {
  return {
    configured: false,
    required: false,
    policies: [],
    pendingTypes: [],
    consentMode: null,
    policyChanges: [],
  };
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

function scheduleApprovalRequestSideEffects(input: {
  userId: string;
  cu12Id: string;
  requestedAt: Date;
  campus: "SONGSIM" | "SONGSIN";
  provider: "CU12" | "CYBER_CAMPUS";
  loginIp: string | null;
}) {
  runInBackground(async () => {
    await Promise.allSettled([
      queueAdminApprovalRequestMailJobs({
        requestedUserId: input.userId,
        requestedCu12Id: input.cu12Id,
        requestedAt: input.requestedAt,
      }),
      writeAuditLogBestEffort({
        category: "AUTH",
        severity: "INFO",
        targetUserId: input.userId,
        message: "First-login user queued for admin approval",
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

    let existingAccount:
      | {
        userId: string;
        provider: "CU12" | "CYBER_CAMPUS";
      }
      | null;
    let localCandidate:
      | {
        id: string;
        email: string;
        role: "ADMIN" | "USER";
        isActive: boolean;
        withdrawnAt: Date | null;
        isTestUser: boolean;
        passwordHash: string;
        approvalStatus?: ApprovalStatus | null;
      }
      | null;

    try {
      [existingAccount, localCandidate] = await Promise.all([
        timing.measure("provider-detect", () =>
          getAccountProviderByCu12Id(body.cu12Id),
        ),
        timing.measure("local-user", () =>
          withWithdrawnAtFallback(
            () =>
              withIsTestUserFallback(
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
                      approvalStatus: true,
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
                      withdrawnAt: true,
                      passwordHash: true,
                      approvalStatus: true,
                    },
                  }),
              ),
            () =>
              withIsTestUserFallback(
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
                      approvalStatus: true,
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
                      passwordHash: true,
                      approvalStatus: true,
                    },
                  }),
              ),
          ),
        ),
      ]);
    } catch (error) {
      if (!isPrismaError(error)) {
        throw error;
      }

      const fallback = await loadAuthLookupFallback(body.cu12Id);
      existingAccount = fallback.existingAccount;
      localCandidate = fallback.localCandidate;
    }

    const storedCurrentProvider = existingAccount?.provider
      ? normalizePortalProvider(existingAccount.provider)
      : undefined;
    const resolvedCurrentProvider = explicitProviderHint ?? storedCurrentProvider;

    if (localCandidate?.isTestUser) {
      const approvalStatus = approvalStatusOrApproved(localCandidate.approvalStatus);
      if (approvalStatus === "PENDING") {
        await clearAuthFailuresBestEffort("login", throttleIdentifiers);
        return timedOk({
          stage: "APPROVAL_PENDING" as const,
          user: {
            userId: localCandidate.id,
            cu12Id: body.cu12Id,
            role: localCandidate.role,
          },
        });
      }
      if (approvalStatus === "REJECTED") {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
        return timedError("Account approval request was rejected.", 403, "APPROVAL_REJECTED");
      }
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
      ).catch((error) => {
        if (!isCompatibilityPrismaError(error)) {
          throw error;
        }

        console.warn(
          "[auth] Test-user login skipped policy consent lookup because legacy policy/consent DB structures are incompatible.",
        );
        return emptyPolicyConsentRequirement();
      });
      if (!consent.configured && localCandidate.role !== "ADMIN") {
        if (!localCandidate.isTestUser) {
          return timedError(
            "Required policy documents are not configured by an administrator.",
            503,
            "POLICY_NOT_CONFIGURED",
          );
        }
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
          consentMode: consent.consentMode ?? "INITIAL_REQUIRED",
          policyChanges: consent.policyChanges,
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
    let existingUserByEmail:
      | {
        id: string;
        email: string;
        role: "ADMIN" | "USER";
        isActive: boolean;
        withdrawnAt: Date | null;
        approvalStatus?: ApprovalStatus | null;
      }
      | null;

    try {
      existingUserByEmail = await timing.measure("portal-user", () =>
        withWithdrawnAtFallback(
          () =>
            prisma.user.findUnique({
              where: { email: body.cu12Id },
              select: { id: true, email: true, role: true, isActive: true, withdrawnAt: true, approvalStatus: true },
            }),
          () =>
            prisma.user.findUnique({
              where: { email: body.cu12Id },
              select: { id: true, email: true, role: true, isActive: true, approvalStatus: true },
            }),
        ),
      );
    } catch (error) {
      if (!isPrismaError(error)) {
        throw error;
      }

      console.warn("[auth] Portal-user lookup hit a Prisma compatibility error.", describePrismaError(error));
      existingUserByEmail = await loadExistingUserByEmailFallback(body.cu12Id);
    }

    let user:
      | {
        id: string;
        email: string;
        role: "ADMIN" | "USER";
      }
      | undefined;

    if (existingAccount) {
      let found:
        | {
          id: string;
          email: string;
          role: "ADMIN" | "USER";
          isActive: boolean;
          withdrawnAt: Date | null;
          approvalStatus?: ApprovalStatus | null;
        }
        | null;

      try {
        found = await timing.measure("account-user", () =>
          withWithdrawnAtFallback(
            () =>
              prisma.user.findUnique({
                where: { id: existingAccount.userId },
                select: { id: true, email: true, role: true, isActive: true, withdrawnAt: true, approvalStatus: true },
              }),
            () =>
              prisma.user.findUnique({
                where: { id: existingAccount.userId },
                select: { id: true, email: true, role: true, isActive: true, approvalStatus: true },
              }),
          ),
        );
      } catch (error) {
        if (!isPrismaError(error)) {
          throw error;
        }

        console.warn("[auth] Account-user lookup hit a Prisma compatibility error.", describePrismaError(error));
        found = await loadExistingUserByIdFallback(existingAccount.userId);
      }

      if (!found) {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
        return timedError("Authentication failed.", 401, "AUTH_FAILED");
      }
      const approvalStatus = approvalStatusOrApproved(found.approvalStatus);
      if (approvalStatus === "PENDING") {
        await clearAuthFailuresBestEffort("login", throttleIdentifiers);
        return timedOk({
          stage: "APPROVAL_PENDING" as const,
          user: {
            userId: found.id,
            provider: currentProvider,
            cu12Id: body.cu12Id,
            role: found.role,
          },
        });
      }
      if (approvalStatus === "REJECTED") {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
        return timedError("Account approval request was rejected.", 403, "APPROVAL_REJECTED");
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

      try {
        await timing.measure("account-upsert", () =>
          upsertCu12Account(user!.id, {
            currentProvider,
            cu12Id: body.cu12Id,
            cu12Password: body.cu12Password,
            campus: verifiedCampus,
          }),
        );
      } catch (error) {
        if (!isPrismaError(error)) {
          throw error;
        }

        console.warn("[auth] Skipping account credential refresh after successful portal auth due to Prisma compatibility error.", describePrismaError(error));
      }
    } else if (existingUserByEmail) {
      const approvalStatus = approvalStatusOrApproved(existingUserByEmail.approvalStatus);
      if (approvalStatus === "PENDING") {
        await clearAuthFailuresBestEffort("login", throttleIdentifiers);
        return timedOk({
          stage: "APPROVAL_PENDING" as const,
          user: {
            userId: existingUserByEmail.id,
            provider: currentProvider,
            cu12Id: body.cu12Id,
            role: existingUserByEmail.role,
          },
        });
      }
      if (approvalStatus === "REJECTED") {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
        return timedError("Account approval request was rejected.", 403, "APPROVAL_REJECTED");
      }
      if (!existingUserByEmail.isActive || existingUserByEmail.withdrawnAt !== null) {
        await recordAuthFailureBestEffort("login", throttleIdentifiers);
        return timedError("Account is disabled.", 401, "ACCOUNT_DISABLED");
      }

      user = existingUserByEmail;
      try {
        await timing.measure("account-upsert", () =>
          upsertCu12Account(user!.id, {
            currentProvider,
            cu12Id: body.cu12Id,
            cu12Password: body.cu12Password,
            campus: verifiedCampus,
          }),
        );
      } catch (error) {
        if (!isPrismaError(error)) {
          throw error;
        }

        console.warn("[auth] Skipping account credential refresh after successful portal auth due to Prisma compatibility error.", describePrismaError(error));
      }
    } else {
      const requestedAt = new Date();
      let pendingUser:
        | {
          id: string;
          email: string;
          role: "ADMIN" | "USER";
          approvalRequestedAt: Date | null;
        };

      try {
        pendingUser = await timing.measure("approval-request", async () =>
          prisma.user.create({
            data: {
              email: body.cu12Id,
              name: body.cu12Id,
              passwordHash: await hashPassword(generateToken(32)),
              role: "USER",
              isActive: false,
              approvalStatus: "PENDING",
              approvalRequestedAt: requestedAt,
            },
            select: {
              id: true,
              email: true,
              role: true,
              approvalRequestedAt: true,
            },
          }),
        );
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }

        const existingPending = await prisma.user.findUnique({
          where: { email: body.cu12Id },
          select: {
            id: true,
            email: true,
            role: true,
            approvalStatus: true,
            approvalRequestedAt: true,
          },
        });
        if (!existingPending || existingPending.approvalStatus !== "PENDING") {
          throw error;
        }
        pendingUser = existingPending;
      }

      scheduleApprovalRequestSideEffects({
        userId: pendingUser.id,
        cu12Id: body.cu12Id,
        requestedAt: pendingUser.approvalRequestedAt ?? requestedAt,
        campus,
        provider: verifiedProvider,
        loginIp,
      });
      await clearAuthFailuresBestEffort("login", throttleIdentifiers);

      return timedOk({
        stage: "APPROVAL_PENDING" as const,
        user: {
          userId: pendingUser.id,
          provider: verifiedProvider,
          cu12Id: body.cu12Id,
          role: pendingUser.role,
        },
      });
    }

    if (!user) {
      return timedError("Failed to resolve user.", 500, "INTERNAL_ERROR");
    }

    const consent = await timing.measure("policy", () =>
      getPolicyConsentRequirement(user.id),
    ).catch((error) => {
      if (!isPrismaError(error)) {
        throw error;
      }

      console.warn(
        "[auth] Existing-user login skipped policy consent lookup because legacy policy/consent DB structures are incompatible.",
        describePrismaError(error),
      );
      return emptyPolicyConsentRequirement();
    });
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
        consentMode: consent.consentMode ?? "INITIAL_REQUIRED",
        policyChanges: consent.policyChanges,
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
