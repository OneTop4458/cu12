import { NextRequest } from "next/server";
import { createAttentionCountHandler } from "./handler";

const handleAttentionCount = createAttentionCountHandler();

export async function GET(request: NextRequest) {
  return handleAttentionCount(request);
}
