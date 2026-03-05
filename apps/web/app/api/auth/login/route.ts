import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  resolveSessionLifetimePolicy,
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
import { upsertCu12Account } from "@/server/cu12-account";
import { verifyCu12Login } from "@/server/cu12-login";

const BodySchema = z.object({
  cu12Id: z.string().trim().min(4).max(80),
  cu12Password: z.string().min(4).max(120),
  campus: z.enum(["SONGSIM", "SONGSIN"]).default("SONGSIM"),
  rememberSession: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(request, BodySchema);
    const campus = body.campus ?? "SONGSIM";
    const sessionPolicy = resolveSessionLifetimePolicy(body.rememberSession);
    const loginIp = getRequestIp(request);

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
        return jsonError("This account has been deactivated.", 403, "ACCOUNT_DISABLED");
      }

      const ok = await verifyPassword(body.cu12Password, localCandidate.passwordHash);
      if (!ok) {
        return jsonError("This account password is invalid.", 401, "LOCAL_AUTH_FAILED");
      }

      await prisma.user.update({
        where: { id: localCandidate.id },
        data: {
          lastLoginAt: new Date(),
          lastLoginIp: loginIp,
        },
      });

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
      return response;
    }

    const validation = await verifyCu12Login({
      cu12Id: body.cu12Id,
      cu12Password: body.cu12Password,
      campus,
    });
    if (!validation.ok) {
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
      return jsonError("CU12 ID or password is invalid.", 401, "CU12_AUTH_FAILED");
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
        return jsonError("This account has been deactivated.", 403, "ACCOUNT_DISABLED");
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
        return jsonError("This account has been deactivated.", 403, "ACCOUNT_DISABLED");
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

