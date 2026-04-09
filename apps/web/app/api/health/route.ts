import { jsonOk } from "@/lib/http";
import { getServiceHealth } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getServiceHealth();

  return jsonOk(health, {
    status: health.status === "error" ? 503 : 200,
    headers: {
      "cache-control": "no-store",
    },
  });
}
