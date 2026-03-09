import { NextRequest } from "next/server";
import { PolicyDocumentType } from "@prisma/client";
import { z } from "zod";
import {
  resolveSessionLifetimePolicy,
  signIdleSessionToken,
  signSessionToken,
  verifyPolicyConsentChallengeToken,
} from "@/lib/auth";
import { getRequestIp, hasValidCsrfOrigin, jsonError, jsonOk, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { setIdleSessionCookieWithMaxAge, setSessionCookieWithMaxAge } from "@/lib/session-cookie";
import { withWithdrawnAtFallback } from "@/lib/withdrawn-compat";
import { writeAuditLogBestEffort } from "@/server/auth-best-effort";
import { PolicyError, recordUserPolicyConsent } from "@/server/policy";

const BodySchema = z.object({
  consentToken: z.string().min(20),
  acceptedPolicies: z.array(z.object({
    type: z.nativeEnum(PolicyDocumentType),
    version: z.number().int().min(1),
  })).min(1),
});

export async function POST(request: NextRequest) {
  if (!hasValidCsrfOrigin(request)) {
    return jsonError("Forbidden", 403, "CSRF_ORIGIN_INVALID");
  }

  try {
    const body = await parseBody(request, BodySchema);
    const challenge = await verifyPolicyConsentChallengeToken(body.consentToken);
    if (!challenge) {
      return jsonError(
        "Consent token is invalid or expired. Please log in again.",
        401,
        "LOGIN_CHALLENGE_INVALID",
      );
    }

    const user = await withWithdrawnAtFallback(
      () =>
        prisma.user.findUnique({
          where: { id: challenge.userId },
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            withdrawnAt: true,
          },
        }),
      () =>
        prisma.user.findUnique({
          where: { id: challenge.userId },
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
          },
        }),
    );
    if (!user || !user.isActive || user.withdrawnAt !== null) {
      return jsonError("Account is disabled.", 401, "ACCOUNT_DISABLED");
    }

    const loginIp = getRequestIp(request);
    await recordUserPolicyConsent(user.id, body.acceptedPolicies, loginIp);

    const sessionPolicy = resolveSessionLifetimePolicy(challenge.rememberSession);
    const sessionToken = await signSessionToken(
      {
        userId: challenge.userId,
        email: user.email,
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

    await prisma.user.update({
      where: { id: challenge.userId },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: loginIp,
      },
    });

    await writeAuditLogBestEffort({
      category: "AUTH",
      severity: "INFO",
      actorUserId: challenge.userId,
      targetUserId: challenge.userId,
      message: "Policy consent accepted",
      meta: {
        loginIp,
      },
    });

    const response = jsonOk({
      stage: "AUTHENTICATED" as const,
      user: {
        userId: challenge.userId,
        cu12Id: user.email,
        role: user.role,
      },
      firstLogin: challenge.firstLogin,
      session: {
        rememberSession: sessionPolicy.rememberSession,
        sessionMaxAgeSeconds: sessionPolicy.sessionMaxAgeSeconds,
        idleMaxAgeSeconds: sessionPolicy.idleSessionMaxAgeSeconds,
      },
    });
    setSessionCookieWithMaxAge(response, sessionToken, sessionPolicy.sessionMaxAgeSeconds);
    setIdleSessionCookieWithMaxAge(response, idleSessionToken, sessionPolicy.idleSessionMaxAgeSeconds);

    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(
        error.issues.map((issue) => issue.message).join(", "),
        400,
        "VALIDATION_ERROR",
      );
    }
    if (error instanceof PolicyError) {
      if (error.code === "POLICY_NOT_CONFIGURED") {
        return jsonError(error.message, 503, error.code);
      }
      if (error.code === "POLICY_VERSION_MISMATCH") {
        return jsonError(error.message, 409, error.code);
      }
      return jsonError(error.message, 400, error.code);
    }

    await writeAuditLogBestEffort({
      category: "AUTH",
      severity: "ERROR",
      message: "Policy consent failed due to server error",
      meta: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return jsonError("Policy consent failed.", 500, "INTERNAL_ERROR");
  }
}
