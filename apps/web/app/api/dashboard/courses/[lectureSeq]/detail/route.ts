import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { getCurrentPortalProvider } from "@/server/current-provider";
import { getCourses } from "@/server/dashboard";

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

  const provider = await getCurrentPortalProvider(context.effective.userId);
  const courses = await getCourses(context.effective.userId, provider);
  const course = courses.find((entry) => entry.lectureSeq === lectureSeq);
  if (!course) {
    return jsonError("Course not found", 404, "COURSE_NOT_FOUND");
  }

  return jsonOk({
    detail: {
      lectureSeq: course.lectureSeq,
      taskTypeCounts: course.taskTypeCounts,
      pendingTaskTypeCounts: course.pendingTaskTypeCounts,
      weekSummaries: course.weekSummaries,
    },
  });
}
