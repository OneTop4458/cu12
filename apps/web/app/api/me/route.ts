import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { applyServerTimingHeader, ServerTiming } from "@/lib/server-timing";
import { getCachedActiveUser } from "@/server/auth-state-cache";

export async function GET(request: NextRequest) {
  const timing = new ServerTiming();
  const context = await requireAuthContext(request);
  if (!context) {
    return jsonError("Unauthorized", 401);
  }

  const [actor, effective] = await Promise.all([
    timing.measure("actor", () => getCachedActiveUser(context.actor.userId)),
    timing.measure("effective", () => getCachedActiveUser(context.effective.userId)),
  ]);

  if (!actor || !effective) {
    return jsonError("User not found", 404);
  }

  return applyServerTimingHeader(jsonOk({
    actor: {
      id: actor.id,
      email: actor.email,
      name: actor.name,
      role: actor.role,
      createdAt: actor.createdAt,
    },
    effective: {
      id: effective.id,
      email: effective.email,
      name: effective.name,
      role: effective.role,
      createdAt: effective.createdAt,
    },
    impersonating: context.impersonating,
  }), timing);
}

