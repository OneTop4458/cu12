import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { getNotices } from "@/server/dashboard";
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
}
