import { NextRequest } from "next/server";
import { PolicyDocumentType } from "@prisma/client";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { writeAuditLog } from "@/server/audit-log";
import { listPoliciesForAdmin, REQUIRED_POLICY_TYPES, upsertPoliciesByAdmin } from "@/server/policy";

const UpsertPolicySchema = z.object({
  policies: z.array(
    z.object({
      type: z.nativeEnum(PolicyDocumentType),
      content: z.string().trim().min(1).max(20000),
      isActive: z.boolean().default(true),
    }),
  ).min(1),
});

export async function GET(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const policies = await listPoliciesForAdmin();
    return jsonOk({
      requiredTypes: REQUIRED_POLICY_TYPES,
      policies,
    });
  } catch {
    return jsonError("Failed to load policy documents", 500);
  }
}

export async function PUT(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const body = await parseBody(request, UpsertPolicySchema);
    const policies = await upsertPoliciesByAdmin(
      context.actor.userId,
      body.policies.map((row) => ({
        type: row.type,
        content: row.content,
        isActive: row.isActive ?? true,
      })),
    );

    await writeAuditLog({
      category: "ADMIN",
      severity: "INFO",
      actorUserId: context.actor.userId,
      message: "Policy documents updated",
      meta: {
        types: body.policies.map((row) => row.type),
      },
    });

    return jsonOk({
      updated: true,
      requiredTypes: REQUIRED_POLICY_TYPES,
      policies,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(
        error.issues.map((issue) => issue.message).join(", "),
        400,
        "VALIDATION_ERROR",
      );
    }
    return jsonError("Failed to update policy documents", 500);
  }
}
