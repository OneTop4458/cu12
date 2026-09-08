import { NextRequest } from "next/server";
import { z } from "zod";
import { DEFAULT_MAIL_TEMPLATE } from "@cu12/core";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { writeAuditLogBestEffort } from "@/server/auth-best-effort";
import { isMailTemplateKind, MailTemplateSchema } from "@/server/mail-settings";

interface Params { params: Promise<{ kind: string }> }

export async function PUT(request: NextRequest, { params }: Params) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);
  const { kind } = await params;
  if (!isMailTemplateKind(kind)) return jsonError("Unknown mail template kind", 404);
  try {
    const data = await parseBody(request, MailTemplateSchema);
    const saved = await prisma.mailTemplate.upsert({ where: { kind }, create: { kind, ...data }, update: data });
    await writeAuditLogBestEffort({ category: "ADMIN", severity: "INFO", actorUserId: context.actor.userId,
      message: "Admin updated mail template", meta: { kind } });
    return jsonOk({ kind, subject: saved.subject, body: saved.body, customized: true, updatedAt: saved.updatedAt.toISOString() });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError(error.issues.map((issue) => issue.message).join(" "), 400, "VALIDATION_ERROR");
    return jsonError("Failed to save mail template.", 503);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);
  const { kind } = await params;
  if (!isMailTemplateKind(kind)) return jsonError("Unknown mail template kind", 404);
  try {
    await prisma.mailTemplate.deleteMany({ where: { kind } });
    await writeAuditLogBestEffort({ category: "ADMIN", severity: "INFO", actorUserId: context.actor.userId,
      message: "Admin reset mail template", meta: { kind } });
    return jsonOk({ kind, ...DEFAULT_MAIL_TEMPLATE, customized: false, updatedAt: null });
  } catch { return jsonError("Failed to reset mail template.", 503); }
}
