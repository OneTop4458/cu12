import { NextRequest } from "next/server";
import { z } from "zod";
import { publicMailSettings, hasEnvironmentMailConfig } from "@cu12/core";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import { writeAuditLogBestEffort } from "@/server/auth-best-effort";
import { getMailSettingsView, MailSettingsSchema, prepareMailSettings } from "@/server/mail-settings";

export async function GET(request: NextRequest) {
  if (!await requireAdminActor(request)) return jsonError("Forbidden", 403);
  try { return jsonOk(await getMailSettingsView(), { headers: { "Cache-Control": "no-store" } }); } catch {
    return jsonError("Failed to load mail settings. Check DB Bootstrap status.", 503);
  }
}

export async function PATCH(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);
  try {
    const body = await parseBody(request, MailSettingsSchema);
    const previous = await prisma.mailSettings.findUnique({ where: { id: "default" } });
    const data = prepareMailSettings(body, previous);
    const saved = await prisma.mailSettings.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
    await writeAuditLogBestEffort({ category: "ADMIN", severity: "INFO", actorUserId: context.actor.userId,
      message: "Admin updated mail settings", meta: { source: saved.source, enabled: saved.enabled, passwordChanged: Boolean(body.password || body.clearPassword) } });
    return jsonOk({ settings: publicMailSettings(saved), environmentConfigured: hasEnvironmentMailConfig(getEnv()) });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError(error.issues.map((issue) => issue.message).join(" "), 400, "VALIDATION_ERROR");
    return jsonError("Failed to save mail settings. Check DB Bootstrap status.", 503);
  }
}
