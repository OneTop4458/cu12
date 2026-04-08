import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAuthContext } from "@/lib/http";
import { PORTAL_PROVIDER_VALUES } from "@/server/portal-provider";
import { updateAutomationSettings } from "@/server/cu12-account";

const BodySchema = z.object({
  currentProvider: z.enum(PORTAL_PROVIDER_VALUES).optional(),
  autoLearnEnabled: z.boolean().optional(),
  quizAutoSolveEnabled: z.boolean().optional(),
  detectActivitiesEnabled: z.boolean().optional(),
  emailDigestEnabled: z.boolean().optional(),
});

export async function PATCH(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  try {
    const body = await parseBody(request, BodySchema);
    const account = await updateAutomationSettings(context.effective.userId, body);
    return jsonOk({
      updated: true,
      currentProvider: account.provider,
      autoLearnEnabled: account.autoLearnEnabled,
      quizAutoSolveEnabled: account.quizAutoSolveEnabled,
      detectActivitiesEnabled: account.detectActivitiesEnabled,
      emailDigestEnabled: account.emailDigestEnabled,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400);
    }
    return jsonError("Failed to update automation settings", 500);
  }
}

