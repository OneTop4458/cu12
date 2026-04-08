import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAdminActor, requireUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/token";
import { writeAuditLog } from "@/server/audit-log";
const BodySchema = z.object({
  cu12Id: z.string().trim().min(4).max(80),
  role: z.enum(["ADMIN", "USER"]).default("USER"),
  expiresHours: z.number().int().min(1).max(24 * 30).default(72),
  isActive: z.boolean().default(true),
});

const PatchSchema = z.object({
  inviteId: z.string().min(1),
  isActive: z.boolean(),
});

const DeleteSchema = z.object({
  inviteId: z.string().min(1),
});

export async function GET(request: NextRequest) {
  const session = await requireUser(request);
  if (!session || session.role !== "ADMIN") return jsonError("Forbidden", 403);

  const rows = await prisma.inviteToken.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      provider: true,
      cu12Id: true,
      role: true,
      isActive: true,
      createdAt: true,
      expiresAt: true,
      usedAt: true,
      usedBy: {
        select: {
          email: true,
        },
      },
    },
  });

  const now = new Date();
  const invites = rows.map((row) => ({
    ...row,
    usedByEmail: row.usedBy?.email ?? null,
    state: row.usedAt ? "USED" : row.isActive ? (row.expiresAt < now ? "EXPIRED" : "ACTIVE") : "INACTIVE",
  }));

  return jsonOk({ invites });
}

export async function POST(request: NextRequest) {
  const session = await requireUser(request);
  if (!session || session.role !== "ADMIN") return jsonError("Forbidden", 403);

  try {
    const body = await parseBody(request, BodySchema);
    const expiresHours = body.expiresHours ?? 72;
    const plainToken = generateToken(24);

    const invite = await prisma.inviteToken.create({
      data: {
        provider: "CU12",
        cu12Id: body.cu12Id,
        role: body.role,
        isActive: body.isActive,
        tokenHash: hashToken(plainToken),
        expiresAt: new Date(Date.now() + expiresHours * 60 * 60 * 1000),
        createdByUserId: session.userId,
      },
    });

    return jsonOk({
      inviteId: invite.id,
      token: plainToken,
      expiresAt: invite.expiresAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400);
    }
    return jsonError("Failed to create invite", 500);
  }
}

export async function PATCH(request: NextRequest) {
  const session = await requireUser(request);
  if (!session || session.role !== "ADMIN") return jsonError("Forbidden", 403);

  try {
    const body = await parseBody(request, PatchSchema);

    const invite = await prisma.inviteToken.findUnique({
      where: { id: body.inviteId },
      select: { id: true },
    });
    if (!invite) {
      return jsonError("Invite token not found", 404);
    }

    const updated = await prisma.inviteToken.update({
      where: { id: body.inviteId },
      data: { isActive: body.isActive },
      select: { id: true, cu12Id: true, isActive: true, expiresAt: true, usedAt: true },
    });

    return jsonOk({ invite: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to update invite", 500);
  }
}

export async function DELETE(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const body = await parseBody(request, DeleteSchema);

    const invite = await prisma.inviteToken.findUnique({
      where: { id: body.inviteId },
      select: { id: true, cu12Id: true },
    });
    if (!invite) {
      return jsonError("Invite token not found", 404);
    }

    await prisma.inviteToken.delete({ where: { id: body.inviteId } });

    await writeAuditLog({
      category: "ADMIN",
      severity: "WARN",
      actorUserId: context.actor.userId,
      message: "Admin deleted invite token",
      meta: {
        inviteId: body.inviteId,
        cu12Id: invite.cu12Id,
      },
    });

    return jsonOk({
      deleted: true,
      inviteId: body.inviteId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400, "VALIDATION_ERROR");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return jsonError("Invite token not found", 404);
      }
    }
    return jsonError("Failed to delete invite", 500);
  }
}
