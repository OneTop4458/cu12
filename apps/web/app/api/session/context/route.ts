import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";

export async function GET(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) {
    return jsonError("Unauthorized", 401);
  }

  return jsonOk({
    actor: context.actor,
    effective: context.effective,
    impersonating: context.impersonating,
  });
}


