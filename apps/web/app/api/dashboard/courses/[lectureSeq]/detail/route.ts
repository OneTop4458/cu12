import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { getCourses } from "@/server/dashboard";
import { resolveRequestPortalProvider } from "@/server/request-provider";

interface Params {
  params: Promise<{ lectureSeq: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const { lectureSeq: lectureSeqRaw } = await params;
  const lectureSeq = Number(lectureSeqRaw);
  if (!Number.isFinite(lectureSeq) || lectureSeq <= 0) {
    return jsonError("Invalid lectureSeq", 400, "VALIDATION_ERROR");
  }

  const provider = await resolveRequestPortalProvider(request, context.effective.userId);
  const courses = await getCourses(context.effective.userId, provider);
  const course = courses.find((entry) => entry.lectureSeq === lectureSeq);
  if (!course) {
    return jsonError("Course not found", 404, "COURSE_NOT_FOUND");
  }

  return jsonOk({
    detail: {
      provider,
      lectureSeq: course.lectureSeq,
      taskTypeCounts: course.taskTypeCounts,
      pendingTaskTypeCounts: course.pendingTaskTypeCounts,
      weekSummaries: course.weekSummaries,
    },
  });
}
