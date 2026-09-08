import { NextRequest } from "next/server";
import { z } from "zod";
import { DEFAULT_QUIZ_MODEL, isQuizModelId } from "@cu12/core";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { writeAuditLogBestEffort } from "@/server/auth-best-effort";

const SettingsSchema = z.object({
  model: z.string().trim().refine(isQuizModelId, "Enter a valid OpenAI model ID (up to 100 characters)."),
}).strict();

export async function GET(request: NextRequest) {
  if (!await requireAdminActor(request)) return jsonError("Forbidden", 403);
  try {
    const saved = await prisma.appSettings.findUnique({
      where: { id: "default" }, select: { quizModel: true },
    });
    return jsonOk({ model: saved?.quizModel ?? DEFAULT_QUIZ_MODEL }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return jsonError("Failed to load quiz AI settings. Check DB Bootstrap status.", 503);
  }
}

export async function PATCH(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);
  try {
    const body = await parseBody(request, SettingsSchema);
    const saved = await prisma.appSettings.upsert({
      where: { id: "default" },
      create: { id: "default", quizModel: body.model },
      update: { quizModel: body.model },
      select: { quizModel: true },
    });
    await writeAuditLogBestEffort({
      category: "ADMIN", severity: "INFO", actorUserId: context.actor.userId,
      message: "Admin updated quiz AI model", meta: { model: saved.quizModel },
    });
    return jsonOk({ model: saved.quizModel }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError("Invalid quiz model ID", 400, "VALIDATION_ERROR");
    return jsonError("Failed to save quiz AI settings. Check DB Bootstrap status.", 503);
  }
}
