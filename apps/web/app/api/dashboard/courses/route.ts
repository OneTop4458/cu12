import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { applyServerTimingHeader, ServerTiming } from "@/lib/server-timing";
import { getCourses } from "@/server/dashboard";
import { resolveRequestPortalProvider } from "@/server/request-provider";

export async function GET(request: NextRequest) {
  const timing = new ServerTiming();
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const provider = await timing.measure("provider-detect", () =>
    resolveRequestPortalProvider(request, context.effective.userId),
  );
  const courses = await timing.measure("courses", () =>
    getCourses(context.effective.userId, provider),
  );

  return applyServerTimingHeader(jsonOk({
    courses: courses.map(({ weekSummaries, taskTypeCounts, pendingTaskTypeCounts, ...course }) => ({
      ...course,
      provider,
      weekSummaries: [],
      taskTypeCounts: null,
      pendingTaskTypeCounts: null,
    })),
  }), timing);
}

