import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { getNotices } from "@/server/dashboard";
import { resolveRequestPortalProvider } from "@/server/request-provider";

interface Params {
  params: Promise<{ lectureSeq: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const context = await requireAuthContext(request);
    if (!context) return jsonError("Unauthorized", 401);

    const { lectureSeq: lectureSeqRaw } = await params;
    const lectureSeq = Number(lectureSeqRaw);
    if (!Number.isFinite(lectureSeq) || lectureSeq <= 0) {
      return jsonError("Invalid lectureSeq", 400);
    }

    const provider = await resolveRequestPortalProvider(request, context.effective.userId);
    const notices = await getNotices(context.effective.userId, lectureSeq, provider);
    return jsonOk({
      notices: notices.map((notice) => ({
        ...notice,
        provider,
      })),
    });
  } catch (error) {
    console.error("[dashboard/course-notices] failed", error);
    return jsonError("Dashboard course notices failed. Please refresh and try again.", 503, "DASHBOARD_COURSE_NOTICES_FAILED");
  }
}
