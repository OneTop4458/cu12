import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireUser } from "@/lib/http";
import { updateAutomationSettings } from "@/server/cu12-account";

const BodySchema = z.object({
  autoLearnEnabled: z.boolean().optional(),
  detectActivitiesEnabled: z.boolean().optional(),
  emailDigestEnabled: z.boolean().optional(),
});

export async function PATCH(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  try {
    const body = await parseBody(request, BodySchema);
    const account = await updateAutomationSettings(session.userId, body);
    return jsonOk({
      updated: true,
      autoLearnEnabled: account.autoLearnEnabled,
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
