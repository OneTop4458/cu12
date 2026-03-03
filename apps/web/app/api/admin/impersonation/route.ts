import { NextRequest } from "next/server";
import { z } from "zod";
import { IMPERSONATION_COOKIE_NAME, signImpersonationToken } from "@/lib/auth";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";

const BodySchema = z.object({
  targetUserId: z.string().min(10),
});

export async function POST(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const body = await parseBody(request, BodySchema);

    const target = await prisma.user.findUnique({
      where: { id: body.targetUserId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
      },
    });
    if (!target || !target.isActive) {
      return jsonError("Target user not found", 404);
    }

    if (target.id === context.actor.userId) {
      const response = jsonOk({
        impersonating: false,
        targetUser: target,
      });
      response.cookies.set(IMPERSONATION_COOKIE_NAME, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });

      return response;
    }

    const token = await signImpersonationToken({
      actorUserId: context.actor.userId,
      targetUserId: target.id,
    });
    const response = jsonOk({
      impersonating: true,
      targetUser: target,
    });
    response.cookies.set(IMPERSONATION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 6,
    });

    await writeAuditLog({
      category: "IMPERSONATION",
      severity: "INFO",
      actorUserId: context.actor.userId,
      targetUserId: target.id,
      message: "Impersonation started",
      meta: {
        actorEmail: context.actor.email,
        targetEmail: target.email,
      },
    });

    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to start impersonation", 500);
  }
}

export async function DELETE(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  const response = jsonOk({ impersonating: false });
  response.cookies.set(IMPERSONATION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  await writeAuditLog({
    category: "IMPERSONATION",
    severity: "INFO",
    actorUserId: context.actor.userId,
    targetUserId: context.impersonating ? context.effective.userId : null,
    message: "Impersonation ended",
    meta: {
      actorEmail: context.actor.email,
      hadImpersonation: context.impersonating,
    },
  });

  return response;
}


