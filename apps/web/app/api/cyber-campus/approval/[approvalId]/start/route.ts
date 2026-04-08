import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAuthContext } from "@/lib/http";
import { startCyberCampusApproval } from "@/server/cyber-campus-autolearn";

const BodySchema = z.object({
  way: z.number().int().positive(),
  param: z.string().max(200).optional(),
});

interface Params {
  params: Promise<{ approvalId: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  try {
    const { approvalId } = await params;
    const body = await parseBody(request, BodySchema);
    const approval = await startCyberCampusApproval({
      userId: context.effective.userId,
      approvalId,
      way: body.way,
      param: body.param ?? null,
    });
    return jsonOk({ approval });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((issue) => issue.message).join(", "), 400);
    }
    const message = error instanceof Error ? error.message : "Failed to start Cyber Campus approval";
    if (message.includes("not found")) {
      return jsonError(message, 404);
    }
    return jsonError(message, 400);
  }
}
