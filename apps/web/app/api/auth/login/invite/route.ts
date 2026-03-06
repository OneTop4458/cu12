import { NextRequest } from "next/server";
import { z } from "zod";
import {
  hashPassword,
  resolveSessionLifetimePolicy,
  signIdleSessionToken,
  signPolicyConsentChallengeToken,
  signSessionToken,
  verifyLoginChallengeToken,
} from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { getRequestIp, jsonError, jsonOk, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { setIdleSessionCookieWithMaxAge, setSessionCookieWithMaxAge } from "@/lib/session-cookie";
import { generateToken, hashToken } from "@/lib/token";
import { writeAuditLog } from "@/server/audit-log";
import { checkAuthThrottle, clearAuthFailures, recordAuthFailure } from "@/server/auth-rate-limit";
import { upsertCu12Account } from "@/server/cu12-account";
import { getPolicyConsentRequirement } from "@/server/policy";

const BodySchema = z.object({
  challengeToken: z.string().min(20),
  inviteCode: z.string().trim().min(8).max(200),
  rememberSession: z.boolean().optional().default(false),
});

function rateLimitedInviteError() {
  return jsonError("Too many invite verification attempts. Please try again shortly.", 429, "RATE_LIMITED");
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(request, BodySchema);
    const sessionPolicy = resolveSessionLifetimePolicy(body.rememberSession);
    const loginIp = getRequestIp(request);
    const ipThrottleIdentifier = loginIp ? `ip:${loginIp}` : null;
    const ipThrottle = await checkAuthThrottle("invite", [ipThrottleIdentifier]);
    if (ipThrottle.blocked) {
      return rateLimitedInviteError();
    }

    const challenge = await verifyLoginChallengeToken(body.challengeToken);
    if (!challenge) {
      await recordAuthFailure("invite", [ipThrottleIdentifier]);
      return jsonError(
        "Login challenge is invalid or expired. Please log in again.",
        401,
        "LOGIN_CHALLENGE_INVALID",
      );
    }
    const throttleIdentifiers = [ipThrottleIdentifier, `cu12:${challenge.cu12Id}`];
    const challengeThrottle = await checkAuthThrottle("invite", throttleIdentifiers);
    if (challengeThrottle.blocked) {
      return rateLimitedInviteError();
    }

    const invite = await prisma.inviteToken.findUnique({
      where: { tokenHash: hashToken(body.inviteCode) },
    });

    if (!invite) {
      const hasInvite = await prisma.inviteToken.findFirst({
        where: { cu12Id: challenge.cu12Id },
        select: { id: true },
      });

      if (!hasInvite) {
        await recordAuthFailure("invite", throttleIdentifiers);
        await writeAuditLog({
          category: "AUTH",
          severity: "WARN",
          message: "Invite verification failed: CU12 ID is not approved",
          meta: {
            cu12Id: challenge.cu12Id,
          },
        });
        return jsonError("This CU12 ID is not approved for self-signup. Contact administrator.", 403, "UNAPPROVED_ID");
      }

      await recordAuthFailure("invite", throttleIdentifiers);
      await writeAuditLog({
        category: "AUTH",
        severity: "WARN",
        message: "Invite verification failed: invalid invite code",
        meta: {
          cu12Id: challenge.cu12Id,
        },
      });
      return jsonError(
        "Invite code is invalid or expired.",
        403,
        "INVITE_CODE_INVALID",
      );
    }

    if (!invite.isActive) {
      await recordAuthFailure("invite", throttleIdentifiers);
      await writeAuditLog({
        category: "AUTH",
        severity: "WARN",
        message: "Invite verification failed: invite code is inactive",
        meta: {
          cu12Id: challenge.cu12Id,
          inviteId: invite.id,
        },
      });
      return jsonError("This invite code is currently disabled.", 403, "INVITE_CODE_INVALID");
    }

    if (invite.expiresAt < new Date()) {
      await recordAuthFailure("invite", throttleIdentifiers);
      await writeAuditLog({
        category: "AUTH",
        severity: "WARN",
        message: "Invite verification failed: invite code expired",
        meta: {
          cu12Id: challenge.cu12Id,
          inviteId: invite.id,
        },
      });
      return jsonError("Invite code is invalid or expired.", 403, "INVITE_CODE_INVALID");
    }

    if (invite.usedAt) {
      await recordAuthFailure("invite", throttleIdentifiers);
      await writeAuditLog({
        category: "AUTH",
        severity: "WARN",
        message: "Invite verification failed: invite code already used",
        meta: {
          cu12Id: challenge.cu12Id,
          inviteId: invite.id,
        },
      });
      return jsonError("Invite code is already used.", 403, "INVITE_CODE_INVALID");
    }

    if (invite.cu12Id !== challenge.cu12Id) {
      await recordAuthFailure("invite", throttleIdentifiers);
      await writeAuditLog({
        category: "AUTH",
        severity: "WARN",
        message: "Invite verification failed: unapproved CU12 ID",
        meta: {
          cu12Id: challenge.cu12Id,
          inviteCu12Id: invite.cu12Id,
        },
      });
      return jsonError(
        "This CU12 ID is not approved. Contact an administrator.",
        403,
        "UNAPPROVED_ID",
      );
    }

    const existingAccount = await prisma.cu12Account.findUnique({
      where: { cu12Id: challenge.cu12Id },
      select: { userId: true },
    });

    const cu12Password = decryptSecret(challenge.encryptedCu12Password);

    let user:
      | {
        id: string;
        email: string;
        role: "ADMIN" | "USER";
      }
      | undefined;
    let firstLogin = false;

    if (existingAccount) {
        const found = await prisma.user.findUnique({
          where: { id: existingAccount.userId },
          select: { id: true, email: true, role: true, isActive: true },
        });
        if (!found) {
          return jsonError("User mapping not found.", 500, "INTERNAL_ERROR");
        }
        if (!found.isActive) {
          await recordAuthFailure("invite", throttleIdentifiers);
          return jsonError("This account has been deactivated.", 403, "ACCOUNT_DISABLED");
        }
        await prisma.inviteToken.update({
          where: { id: invite.id },
          data: {
            usedAt: new Date(),
            usedByUserId: found.id,
          },
        });
        user = found;
      } else {
      const passwordHash = await hashPassword(generateToken(24));

      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: challenge.cu12Id,
            name: challenge.cu12Id,
            passwordHash,
            role: invite.role,
          },
          select: {
            id: true,
            email: true,
            role: true,
          },
        });

        await tx.inviteToken.update({
          where: { id: invite.id },
          data: { usedAt: new Date(), usedByUserId: created.id },
        });

        return created;
      });

      firstLogin = true;
    }

    if (!user) {
      return jsonError("Failed to resolve user.", 500, "INTERNAL_ERROR");
    }

    await upsertCu12Account(user.id, {
      cu12Id: challenge.cu12Id,
      cu12Password,
      campus: challenge.campus,
    });

    const consent = await getPolicyConsentRequirement(user.id);
    if (!consent.configured) {
      return jsonError(
        "Required policy documents are not configured by an administrator.",
        503,
        "POLICY_NOT_CONFIGURED",
      );
    }
    if (consent.required) {
      const consentToken = await signPolicyConsentChallengeToken({
        userId: user.id,
        email: challenge.cu12Id,
        role: user.role,
        rememberSession: sessionPolicy.rememberSession,
        firstLogin,
      });
      await clearAuthFailures("invite", throttleIdentifiers);
      return jsonOk({
        stage: "CONSENT_REQUIRED" as const,
        consentToken,
        policies: consent.policies,
        user: {
          userId: user.id,
          cu12Id: challenge.cu12Id,
          role: user.role,
        },
        firstLogin,
        session: {
          rememberSession: sessionPolicy.rememberSession,
          sessionMaxAgeSeconds: sessionPolicy.sessionMaxAgeSeconds,
          idleMaxAgeSeconds: sessionPolicy.idleSessionMaxAgeSeconds,
        },
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: loginIp,
      },
    });

    const sessionToken = await signSessionToken(
      {
        userId: user.id,
        email: challenge.cu12Id,
        role: user.role,
      },
      {
        maxAgeSeconds: sessionPolicy.sessionMaxAgeSeconds,
      },
    );
    const idleSessionToken = await signIdleSessionToken(user.id, {
      rememberSession: sessionPolicy.rememberSession,
      maxAgeSeconds: sessionPolicy.idleSessionMaxAgeSeconds,
    });

    const response = jsonOk({
      stage: "AUTHENTICATED" as const,
      user: {
        userId: user.id,
        cu12Id: challenge.cu12Id,
        role: user.role,
      },
      firstLogin,
      session: {
        rememberSession: sessionPolicy.rememberSession,
        sessionMaxAgeSeconds: sessionPolicy.sessionMaxAgeSeconds,
        idleMaxAgeSeconds: sessionPolicy.idleSessionMaxAgeSeconds,
      },
    });
    setSessionCookieWithMaxAge(response, sessionToken, sessionPolicy.sessionMaxAgeSeconds);
    setIdleSessionCookieWithMaxAge(response, idleSessionToken, sessionPolicy.idleSessionMaxAgeSeconds);

    await writeAuditLog({
      category: "AUTH",
      severity: "INFO",
      actorUserId: user.id,
      targetUserId: user.id,
      message: firstLogin ? "First-login invite verification succeeded" : "Invite verification succeeded",
      meta: {
        cu12Id: challenge.cu12Id,
        role: user.role,
        loginIp,
      },
    });
    await clearAuthFailures("invite", throttleIdentifiers);

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
      message: "Invite verification failed due to server error",
      meta: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return jsonError("Invite verification failed.", 500, "INTERNAL_ERROR");
  }
}

