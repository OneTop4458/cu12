import { NextRequest } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, signSessionToken, verifyPassword } from "@/lib/auth";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const BodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(request, BodySchema);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      return jsonError("Invalid credentials", 401);
    }

    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) {
      return jsonError("Invalid credentials", 401);
    }

    const sessionToken = await signSessionToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    const response = jsonOk({ userId: user.id, email: user.email, role: user.role });
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
    return jsonError("Login failed", 500);
  }
}
