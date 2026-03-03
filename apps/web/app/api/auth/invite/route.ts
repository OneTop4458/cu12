import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/token";

const BodySchema = z.object({
  cu12Id: z.string().trim().min(4).max(80),
  role: z.enum(["ADMIN", "USER"]).default("USER"),
  expiresHours: z.number().int().min(1).max(24 * 30).default(72),
});

export async function GET(request: NextRequest) {
  const session = await requireUser(request);
  if (!session || session.role !== "ADMIN") return jsonError("Forbidden", 403);

  const rows = await prisma.inviteToken.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      cu12Id: true,
      role: true,
      createdAt: true,
      expiresAt: true,
      usedAt: true,
    },
  });

  const now = new Date();
  const invites = rows.map((row) => ({
    ...row,
    state: row.usedAt ? "USED" : row.expiresAt < now ? "EXPIRED" : "ACTIVE",
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
        cu12Id: body.cu12Id,
        role: body.role,
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