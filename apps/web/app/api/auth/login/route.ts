import { NextRequest } from "next/server";
import { z } from "zod";
import { hashPassword, SESSION_COOKIE_NAME, signSessionToken } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/token";
import { upsertCu12Account } from "@/server/cu12-account";
import { verifyCu12Login } from "@/server/cu12-login";

const BodySchema = z.object({
  cu12Id: z.string().trim().min(4).max(80),
  cu12Password: z.string().min(4).max(120),
  campus: z.enum(["SONGSIM", "SONGSIN"]).default("SONGSIM"),
  inviteCode: z.string().trim().min(8).max(200).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(request, BodySchema);
    const campus = body.campus ?? "SONGSIM";

    const validation = await verifyCu12Login({
      cu12Id: body.cu12Id,
      cu12Password: body.cu12Password,
      campus,
    });
    if (!validation.ok) {
      return jsonError(validation.message, 401);
    }

    const existingAccount = await prisma.cu12Account.findUnique({
      where: { cu12Id: body.cu12Id },
      select: { userId: true },
    });
    const existingUserByEmail = await prisma.user.findUnique({
      where: { email: body.cu12Id },
      select: { id: true, email: true, role: true },
    });

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
        return jsonError("User mapping not found", 500);
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
      user = existingUserByEmail;

      await upsertCu12Account(user.id, {
        cu12Id: body.cu12Id,
        cu12Password: body.cu12Password,
        campus,
      });
    } else {
      if (!body.inviteCode) {
        return jsonError("Invite code is required for first login", 403);
      }

      const invite = await prisma.inviteToken.findUnique({
        where: { tokenHash: hashToken(body.inviteCode) },
      });

      if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
        return jsonError("Invalid or expired invite code", 400);
      }

      if (invite.cu12Id !== body.cu12Id) {
        return jsonError("Invite code does not match CU12 ID", 403);
      }

      const passwordHash = await hashPassword(generateToken(24));

      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: body.cu12Id,
            name: body.cu12Id,
            passwordHash,
            role: invite.role,
          },
          select: {
            id: true,
            email: true,
            role: true,
          },
        });

        await tx.cu12Account.create({
          data: {
            userId: created.id,
            cu12Id: body.cu12Id,
            encryptedPassword: encryptSecret(body.cu12Password),
            campus,
            accountStatus: "CONNECTED",
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
      return jsonError("Failed to resolve user", 500);
    }

    const sessionToken = await signSessionToken({
      userId: user.id,
      email: body.cu12Id,
      role: user.role,
    });

    const response = jsonOk({
      userId: user.id,
      cu12Id: body.cu12Id,
      role: user.role,
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
      return jsonError(error.issues.map((it) => it.message).join(", "), 400);
    }
    return jsonError("Authentication failed", 500);
  }
}
