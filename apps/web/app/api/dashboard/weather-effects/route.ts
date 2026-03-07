import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { getDashboardWeatherEffects } from "@/server/dashboard-weather-effects";

export async function GET(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const weatherEffects = await getDashboardWeatherEffects();
  return jsonOk(
    weatherEffects,
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

