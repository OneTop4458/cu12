import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import {
  cancelCyberCampusApproval,
  getCyberCampusApprovalSummary,
} from "@/server/cyber-campus-autolearn";

interface Params {
  params: Promise<{ approvalId: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const { approvalId } = await params;
  const approval = await getCyberCampusApprovalSummary({
    userId: context.effective.userId,
    approvalId,
  });
  if (!approval) {
    return jsonError("Cyber Campus approval session not found", 404);
  }

  return jsonOk({
    approval,
  }, {
    headers: {
      "cache-control": "no-store",
    },
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  try {
    const { approvalId } = await params;
    const approval = await cancelCyberCampusApproval({
      userId: context.effective.userId,
      approvalId,
    });
    return jsonOk({ approval });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to cancel Cyber Campus approval";
    if (message.includes("not found")) {
      return jsonError(message, 404);
    }
    return jsonError(message, 400);
  }
}
