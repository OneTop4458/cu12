import { NextRequest } from "next/server";
import { z } from "zod";
import { hashPassword, SESSION_COOKIE_NAME, signSessionToken } from "@/lib/auth";
import { jsonCreated, jsonError, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/token";

const BodySchema = z.object({
  token: z.string().min(8),
  name: z.string().min(1).max(80),
  password: z.string().min(8).max(128),
});

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(request, BodySchema);
    const invite = await prisma.inviteToken.findUnique({
      where: { tokenHash: hashToken(body.token) },
    });

    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      return jsonError("Invalid or expired invite token", 400);
    }

    const existing = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existing) {
      return jsonError("User already exists", 409);
    }

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        email: invite.email,
        name: body.name,
        passwordHash,
        role: invite.role,
      },
    });

    await prisma.inviteToken.update({
      where: { id: invite.id },
      data: { usedAt: new Date(), usedByUserId: user.id },
    });

    const sessionToken = await signSessionToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    const response = jsonCreated({ userId: user.id, email: user.email });
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
    return jsonError("Failed to accept invite", 500);
  }
}
