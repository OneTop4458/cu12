import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { PolicyDocumentType } from "@prisma/client";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { writeAuditLog } from "@/server/audit-log";
import {
  PUBLIC_ACTIVE_POLICIES_TAG,
  getPolicyProfileForAdmin,
  listPolicyHistoryForAdmin,
  listPoliciesForAdmin,
  publishPoliciesByAdmin,
  REQUIRED_POLICY_TYPES,
} from "@/server/policy";
import { queuePolicyUpdateMailJobs } from "@/server/policy-update-mail";

const PolicyProfileSchema = z.object({
  companyName: z.string().trim().max(200).optional().nullable(),
  supportEmail: z.string().trim().max(200).optional().nullable(),
  companyAddress: z.string().trim().max(500).optional().nullable(),
  dpoName: z.string().trim().max(120).optional().nullable(),
  dpoTitle: z.string().trim().max(200).optional().nullable(),
  dpoEmail: z.string().trim().max(200).optional().nullable(),
  dpoPhone: z.string().trim().max(60).optional().nullable(),
  jurisdictionCourt: z.string().trim().max(200).optional().nullable(),
  effectiveDate: z.string().trim().max(80).optional().nullable(),
  revisionDate: z.string().trim().max(80).optional().nullable(),
});

const UpsertPolicySchema = z
  .object({
    policies: z
      .array(
        z.object({
          type: z.nativeEnum(PolicyDocumentType),
          content: z.string().trim().min(1).max(20000),
          isActive: z.boolean().default(true),
        }),
      )
      .min(1)
      .optional(),
    profile: PolicyProfileSchema.optional(),
  })
  .refine((value) => Boolean(value.policies || value.profile), {
    message: "At least one of 'policies' or 'profile' is required.",
  });

export async function GET(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const [policies, profile] = await Promise.all([listPoliciesForAdmin(), getPolicyProfileForAdmin()]);
    return jsonOk({
      requiredTypes: REQUIRED_POLICY_TYPES,
      policies,
      history: await listPolicyHistoryForAdmin(),
      profile,
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
    const publishResult = await publishPoliciesByAdmin(context.actor.userId, {
      policies: body.policies?.map((row) => ({
        type: row.type,
        content: row.content,
        isActive: row.isActive ?? true,
      })),
      profile: body.profile,
    });
    const activePublishedChanges = publishResult.publishedChanges.filter((change) =>
      publishResult.policies.find((policy) => policy.type === change.type)?.isActive === true,
    );
    const mailQueue = await queuePolicyUpdateMailJobs(activePublishedChanges);

    await writeAuditLog({
      category: "ADMIN",
      severity: "INFO",
      actorUserId: context.actor.userId,
      message: "Policy documents/profile updated",
      meta: {
        policyTypes: body.policies?.map((row) => row.type) ?? [],
        profileUpdated: Boolean(body.profile),
        publishedChanges: activePublishedChanges,
        queuedPolicyUpdateMails: mailQueue.queued,
        skippedPolicyUpdateMails: mailQueue.skipped,
      },
    });

    revalidateTag(PUBLIC_ACTIVE_POLICIES_TAG, "max");

    return jsonOk({
      updated: publishResult.updated,
      requiredTypes: REQUIRED_POLICY_TYPES,
      policies: publishResult.policies,
      history: publishResult.history,
      profile: publishResult.profile,
      publishedChanges: activePublishedChanges,
      mailQueue,
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
