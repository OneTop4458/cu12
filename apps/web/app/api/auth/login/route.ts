import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE_NAME,
  signLoginChallengeToken,
  signSessionToken,
} from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { upsertCu12Account } from "@/server/cu12-account";
import { verifyCu12Login } from "@/server/cu12-login";

const BodySchema = z.object({
  cu12Id: z.string().trim().min(4).max(80),
  cu12Password: z.string().min(4).max(120),
  campus: z.enum(["SONGSIM", "SONGSIN"]).default("SONGSIM"),
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
      return jsonError("CU12 ID or password is invalid.", 401, "CU12_AUTH_FAILED");
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

    if (existingAccount) {
      const found = await prisma.user.findUnique({
        where: { id: existingAccount.userId },
        select: { id: true, email: true, role: true },
      });

      if (!found) {
        return jsonError("User mapping not found.", 500, "INTERNAL_ERROR");
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
      const challengeToken = await signLoginChallengeToken({
        cu12Id: body.cu12Id,
        campus,
        encryptedCu12Password: encryptSecret(body.cu12Password),
        nonce: randomUUID(),
      });

      return jsonOk({
        stage: "INVITE_REQUIRED" as const,
        challengeToken,
      });
    }

    if (!user) {
      return jsonError("Failed to resolve user.", 500, "INTERNAL_ERROR");
    }

    const sessionToken = await signSessionToken({
      userId: user.id,
      email: body.cu12Id,
      role: user.role,
    });

    const response = jsonOk({
      stage: "AUTHENTICATED" as const,
      user: {
        userId: user.id,
        cu12Id: body.cu12Id,
        role: user.role,
      },
      firstLogin: false,
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
    return jsonError("Authentication failed.", 500, "INTERNAL_ERROR");
  }
}