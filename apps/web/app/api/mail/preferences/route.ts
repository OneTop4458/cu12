import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const PatchSchema = z.object({
  email: z.string().email().max(200).optional(),
  enabled: z.boolean().optional(),
  alertOnNotice: z.boolean().optional(),
  alertOnDeadline: z.boolean().optional(),
  alertOnAutolearn: z.boolean().optional(),
  digestEnabled: z.boolean().optional(),
  digestHour: z.number().int().min(0).max(23).optional(),
});

async function resolvePreference(userId: string) {
  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    prisma.mailSubscription.findUnique({ where: { userId } }),
  ]);

  if (!user) {
    return null;
  }

  if (!subscription) {
    return {
      email: user.email,
      enabled: false,
      alertOnNotice: true,
      alertOnDeadline: true,
      alertOnAutolearn: true,
      digestEnabled: true,
      digestHour: 8,
      updatedAt: null,
    };
  }

  return {
    email: subscription.email,
    enabled: subscription.enabled,
    alertOnNotice: subscription.alertOnNotice,
    alertOnDeadline: subscription.alertOnDeadline,
    alertOnAutolearn: subscription.alertOnAutolearn,
    digestEnabled: subscription.digestEnabled,
    digestHour: subscription.digestHour,
    updatedAt: subscription.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  const preference = await resolvePreference(session.userId);
  if (!preference) {
    return jsonError("User not found", 404);
  }

  return jsonOk({ preference });
}

export async function PATCH(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  try {
    const body = await parseBody(request, PatchSchema);

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { email: true },
    });

    if (!user) {
      return jsonError("User not found", 404);
    }

    const saved = await prisma.mailSubscription.upsert({
      where: { userId: session.userId },
      update: {
        email: body.email,
        enabled: body.enabled,
        alertOnNotice: body.alertOnNotice,
        alertOnDeadline: body.alertOnDeadline,
        alertOnAutolearn: body.alertOnAutolearn,
        digestEnabled: body.digestEnabled,
        digestHour: body.digestHour,
      },
      create: {
        userId: session.userId,
        email: body.email ?? user.email,
        enabled: body.enabled ?? true,
        alertOnNotice: body.alertOnNotice ?? true,
        alertOnDeadline: body.alertOnDeadline ?? true,
        alertOnAutolearn: body.alertOnAutolearn ?? true,
        digestEnabled: body.digestEnabled ?? true,
        digestHour: body.digestHour ?? 8,
      },
    });

    await prisma.cu12Account.updateMany({
      where: { userId: session.userId },
      data: {
        emailDigestEnabled: saved.digestEnabled,
      },
    });

    return jsonOk({
      updated: true,
      preference: {
        email: saved.email,
        enabled: saved.enabled,
        alertOnNotice: saved.alertOnNotice,
        alertOnDeadline: saved.alertOnDeadline,
        alertOnAutolearn: saved.alertOnAutolearn,
        digestEnabled: saved.digestEnabled,
        digestHour: saved.digestHour,
        updatedAt: saved.updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400);
    }
    return jsonError("Failed to update mail preferences", 500);
  }
}
