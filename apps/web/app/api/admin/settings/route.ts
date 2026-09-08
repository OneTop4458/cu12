import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { writeAuditLogBestEffort } from "@/server/auth-best-effort";
import { getMemberApprovalRequired } from "@/server/member-approval";

const SettingsSchema = z.object({ memberApprovalRequired: z.boolean() }).strict();

export async function GET(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    return jsonOk({ memberApprovalRequired: await getMemberApprovalRequired() });
  } catch {
    return jsonError("Failed to load member approval setting", 503);
  }
}

export async function PATCH(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const body = await parseBody(request, SettingsSchema);
    const settings = await prisma.appSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...body },
      update: body,
      select: { memberApprovalRequired: true },
    });
    await writeAuditLogBestEffort({
      category: "ADMIN",
      severity: "INFO",
      actorUserId: context.actor.userId,
      message: "Admin updated member approval setting",
      meta: settings,
    });
    return jsonOk(settings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError("memberApprovalRequired must be a boolean", 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to save member approval setting. Check DB Bootstrap status.", 503);
  }
}
