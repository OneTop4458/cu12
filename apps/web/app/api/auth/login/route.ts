import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
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
import { getRequestIp, jsonError, jsonOk, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { setIdleSessionCookieWithMaxAge, setSessionCookieWithMaxAge } from "@/lib/session-cookie";
import { writeAuditLog } from "@/server/audit-log";
import { checkAuthThrottle, clearAuthFailures, recordAuthFailure } from "@/server/auth-rate-limit";
import { upsertCu12Account } from "@/server/cu12-account";
import { verifyCu12Login } from "@/server/cu12-login";
import { getPolicyConsentRequirement } from "@/server/policy";

const BodySchema = z.object({
  cu12Id: z.string().trim().min(4).max(80),
  cu12Password: z.string().min(4).max(120),
  campus: z.enum(["SONGSIM", "SONGSIN"]).default("SONGSIM"),
  rememberSession: z.boolean().optional().default(false),
});

function rateLimitedLoginError() {
  return jsonError("Too many authentication attempts. Please try again shortly.", 429, "RATE_LIMITED");
}

function authenticationFailedError() {
  return jsonError("Authentication failed.", 401, "AUTH_FAILED");
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(request, BodySchema);
    const campus = body.campus ?? "SONGSIM";
    const sessionPolicy = resolveSessionLifetimePolicy(body.rememberSession);
    const loginIp = getRequestIp(request);
    const throttleIdentifiers = [loginIp ? `ip:${loginIp}` : null, `cu12:${body.cu12Id}`];
    const throttle = await checkAuthThrottle("login", throttleIdentifiers);
    if (throttle.blocked) {
      return rateLimitedLoginError();
    }

    const localCandidate = await prisma.user.findUnique({
      where: { email: body.cu12Id },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        isTestUser: true,
        passwordHash: true,
      },
    });

    if (localCandidate?.isTestUser) {
      if (!localCandidate.isActive) {
        await recordAuthFailure("login", throttleIdentifiers);
        return authenticationFailedError();
      }

      const ok = await verifyPassword(body.cu12Password, localCandidate.passwordHash);
      if (!ok) {
        await recordAuthFailure("login", throttleIdentifiers);
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
        await clearAuthFailures("login", throttleIdentifiers);
        return jsonOk({
          stage: "CONSENT_REQUIRED" as const,
          consentToken,
          policies: consent.policies,
          user: {
            userId: localCandidate.id,
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

      await writeAuditLog({
        category: "AUTH",
        severity: "INFO",
        actorUserId: localCandidate.id,
        targetUserId: localCandidate.id,
        message: "User authenticated using local credentials",
        meta: {
          cu12Id: body.cu12Id,
          campus,
          loginIp,
        },
      });
      await clearAuthFailures("login", throttleIdentifiers);
      return response;
    }

    const validation = await verifyCu12Login({
      cu12Id: body.cu12Id,
      cu12Password: body.cu12Password,
      campus,
    });
    if (!validation.ok) {
      await recordAuthFailure("login", throttleIdentifiers);
      await writeAuditLog({
        category: "AUTH",
        severity: "WARN",
        message: "CU12 login validation failed",
        meta: {
          cu12Id: body.cu12Id,
          campus,
          messageCode: validation.messageCode ?? null,
        },
      });
      return authenticationFailedError();
    }

    const existingAccount = await prisma.cu12Account.findUnique({
      where: { cu12Id: body.cu12Id },
      select: { userId: true },
    });
    const existingUserByEmail = await prisma.user.findUnique({
      where: { email: body.cu12Id },
      select: { id: true, email: true, role: true, isActive: true },
    });

    let user:
      | {
        id: string;
        email: string;
        role: "ADMIN" | "USER";
      }
      | undefined;

    if (existingAccount) {
      const found = await prisma.user.findUnique({
        where: { id: existingAccount.userId },
        select: { id: true, email: true, role: true, isActive: true },
      });

      if (!found || !found.isActive) {
        await recordAuthFailure("login", throttleIdentifiers);
        return authenticationFailedError();
      }

      user = await prisma.user.update({
        where: { id: found.id },
        data: { email: body.cu12Id },
        select: { id: true, email: true, role: true },
      });

      await upsertCu12Account(user.id, {
        cu12Id: body.cu12Id,
        cu12Password: body.cu12Password,
        campus,
      });
    } else if (existingUserByEmail) {
      if (!existingUserByEmail.isActive) {
        await recordAuthFailure("login", throttleIdentifiers);
        return authenticationFailedError();
      }

      user = existingUserByEmail;

      await upsertCu12Account(user.id, {
        cu12Id: body.cu12Id,
        cu12Password: body.cu12Password,
        campus,
      });
    } else {
      const challengeToken = await signLoginChallengeToken({
        cu12Id: body.cu12Id,
        campus,
        encryptedCu12Password: encryptSecret(body.cu12Password),
        nonce: randomUUID(),
      });

      await writeAuditLog({
        category: "AUTH",
        severity: "INFO",
        message: "Login challenge issued for first-time CU12 user",
        meta: {
          cu12Id: body.cu12Id,
          campus,
        },
      });
      await clearAuthFailures("login", throttleIdentifiers);

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
      await clearAuthFailures("login", throttleIdentifiers);
      return jsonOk({
        stage: "CONSENT_REQUIRED" as const,
        consentToken,
        policies: consent.policies,
        user: {
          userId: user.id,
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

    await writeAuditLog({
      category: "AUTH",
      severity: "INFO",
      actorUserId: user.id,
      targetUserId: user.id,
      message: "User authenticated with CU12 credentials",
      meta: {
        cu12Id: body.cu12Id,
        campus,
        loginIp,
      },
    });
    await clearAuthFailures("login", throttleIdentifiers);

    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(
        error.issues.map((it) => it.message).join(", "),
        400,
        "VALIDATION_ERROR",
      );
    }
    await writeAuditLog({
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

