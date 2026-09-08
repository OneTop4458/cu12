import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAdminActor } from "@/lib/http";
import { getMailTemplateViews } from "@/server/mail-settings";

export async function GET(request: NextRequest) {
  if (!await requireAdminActor(request)) return jsonError("Forbidden", 403);
  try { return jsonOk({ templates: await getMailTemplateViews() }, { headers: { "Cache-Control": "no-store" } }); } catch {
    return jsonError("Failed to load mail templates. Check DB Bootstrap status.", 503);
  }
}
