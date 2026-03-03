import { NextRequest } from "next/server";
import { z } from "zod";
import {
  hashPassword,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifyLoginChallengeToken,
} from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/token";
import { upsertCu12Account } from "@/server/cu12-account";

const BodySchema = z.object({
  challengeToken: z.string().min(20),
  inviteCode: z.string().trim().min(8).max(200),
});

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(request, BodySchema);

    const challenge = await verifyLoginChallengeToken(body.challengeToken);
    if (!challenge) {
      return jsonError(
        "Login challenge is invalid or expired. Please log in again.",
        401,
        "LOGIN_CHALLENGE_INVALID",
      );
    }

    const invite = await prisma.inviteToken.findUnique({
      where: { tokenHash: hashToken(body.inviteCode) },
    });
    if (
      !invite ||
      invite.usedAt ||
      invite.expiresAt < new Date() ||
      invite.cu12Id !== challenge.cu12Id
    ) {
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
        select: { id: true, email: true, role: true },
      });
      if (!found) {
        return jsonError("User mapping not found.", 500, "INTERNAL_ERROR");
      }
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

    const sessionToken = await signSessionToken({
      userId: user.id,
      email: challenge.cu12Id,
      role: user.role,
    });

    const response = jsonOk({
      stage: "AUTHENTICATED" as const,
      user: {
        userId: user.id,
        cu12Id: challenge.cu12Id,
        role: user.role,
      },
      firstLogin,
    });
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
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
    return jsonError("Invite verification failed.", 500, "INTERNAL_ERROR");
  }
}