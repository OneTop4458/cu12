import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAuthContext } from "@/lib/http";
import {
  DASHBOARD_MANUAL_VERSION,
  markDashboardManualGuideSeen,
} from "@/server/user-guide";

const BodySchema = z.object({
  seenVersion: z.literal(DASHBOARD_MANUAL_VERSION),
});

export async function PATCH(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  try {
    const body = await parseBody(request, BodySchema);
    const dashboardManual = await markDashboardManualGuideSeen(context.effective.userId, body.seenVersion);

    return jsonOk({
      userGuide: {
        dashboardManual,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((issue) => issue.message).join(", "), 400, "VALIDATION_ERROR");
    }
    console.error("[user-guide/dashboard-manual] failed", error);
    return jsonError("Failed to update guide state.", 503, "USER_GUIDE_UPDATE_FAILED");
  }
}
