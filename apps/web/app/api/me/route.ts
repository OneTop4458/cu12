import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) {
    return jsonError("Unauthorized", 401);
  }

  const [actor, effective] = await Promise.all([
    prisma.user.findUnique({
      where: { id: context.actor.userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    }),
    prisma.user.findUnique({
      where: { id: context.effective.userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    }),
  ]);

  if (!actor || !effective) {
    return jsonError("User not found", 404);
  }

  return jsonOk({
    actor,
    effective,
    impersonating: context.impersonating,
  });
}

