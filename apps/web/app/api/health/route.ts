import { jsonOk } from "@/lib/http";

export async function GET() {
  return jsonOk({
    ok: true,
    service: "cu12-web",
    ts: new Date().toISOString(),
  });
}
