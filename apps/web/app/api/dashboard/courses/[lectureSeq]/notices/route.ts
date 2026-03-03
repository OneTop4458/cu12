import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireUser } from "@/lib/http";
import { getNotices } from "@/server/dashboard";

interface Params {
  params: Promise<{ lectureSeq: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  const { lectureSeq: lectureSeqRaw } = await params;
  const lectureSeq = Number(lectureSeqRaw);
  if (!Number.isFinite(lectureSeq) || lectureSeq <= 0) {
    return jsonError("Invalid lectureSeq", 400);
  }

  const notices = await getNotices(session.userId, lectureSeq);
  return jsonOk({ notices });
}
