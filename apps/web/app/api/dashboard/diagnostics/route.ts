import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { getDashboardDiagnostics } from "@/server/dashboard";
import { getCurrentPortalProvider } from "@/server/current-provider";

function parsePositiveInt(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

export async function GET(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const url = new URL(request.url);
  const lectureSeqRaw = url.searchParams.get("lectureSeq");
  const sampleLimitRaw = url.searchParams.get("sampleLimit");

  const lectureSeq = parsePositiveInt(lectureSeqRaw);
  if (lectureSeqRaw !== null && lectureSeq === null) {
    return jsonError("Invalid lectureSeq", 400);
  }

  const sampleLimitParsed = parsePositiveInt(sampleLimitRaw);
  if (sampleLimitRaw !== null && sampleLimitParsed === null) {
    return jsonError("Invalid sampleLimit", 400);
  }
  const provider = await getCurrentPortalProvider(context.effective.userId);

  const diagnostics = await getDashboardDiagnostics(context.effective.userId, provider, {
    lectureSeq: lectureSeq ?? undefined,
    sampleLimit: sampleLimitParsed ?? 20,
  });

  return jsonOk({ diagnostics });
}

