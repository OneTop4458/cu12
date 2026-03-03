import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireUser } from "@/lib/http";
import { getCourses } from "@/server/dashboard";

export async function GET(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  const courses = await getCourses(session.userId);
  return jsonOk({ courses });
}
