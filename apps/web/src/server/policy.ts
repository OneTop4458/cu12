import { PolicyDocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const REQUIRED_POLICY_TYPES: PolicyDocumentType[] = [
  PolicyDocumentType.PRIVACY_POLICY,
  PolicyDocumentType.TERMS_OF_SERVICE,
];

export type PolicyErrorCode =
  | "POLICY_NOT_CONFIGURED"
  | "POLICY_CONSENT_INCOMPLETE"
  | "POLICY_VERSION_MISMATCH";

export class PolicyError extends Error {
  readonly code: PolicyErrorCode;

  constructor(code: PolicyErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface PolicyDocumentPayload {
  type: PolicyDocumentType;
  title: string;
  version: number;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserConsentInput {
  type: PolicyDocumentType;
  version: number;
}

export interface PolicyConsentRequirement {
  configured: boolean;
  required: boolean;
  policies: PolicyDocumentPayload[];
  pendingTypes: PolicyDocumentType[];
}

function policyTitle(type: PolicyDocumentType): string {
  if (type === PolicyDocumentType.PRIVACY_POLICY) return "개인정보 처리 방침";
  return "이용약관";
}

function toPolicyPayload(row: {
  type: PolicyDocumentType;
  version: number;
  content: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): PolicyDocumentPayload {
  return {
    type: row.type,
    title: policyTitle(row.type),
    version: row.version,
    content: row.content,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listPoliciesForAdmin(): Promise<PolicyDocumentPayload[]> {
  const rows = await prisma.policyDocument.findMany({
    where: { type: { in: REQUIRED_POLICY_TYPES } },
    orderBy: { type: "asc" },
    select: {
      type: true,
      version: true,
      content: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map(toPolicyPayload);
}

export async function getActiveRequiredPolicies(): Promise<PolicyDocumentPayload[]> {
  const rows = await prisma.policyDocument.findMany({
    where: {
      type: { in: REQUIRED_POLICY_TYPES },
      isActive: true,
    },
    orderBy: { type: "asc" },
    select: {
      type: true,
      version: true,
      content: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map(toPolicyPayload);
}

export async function getPolicyConsentRequirement(userId: string): Promise<PolicyConsentRequirement> {
  const [policies, consents] = await Promise.all([
    getActiveRequiredPolicies(),
    prisma.userPolicyConsent.findMany({
      where: {
        userId,
        policyType: { in: REQUIRED_POLICY_TYPES },
      },
      select: {
        policyType: true,
        policyVersion: true,
      },
    }),
  ]);

  const configured = policies.length === REQUIRED_POLICY_TYPES.length;
  if (!configured) {
    return {
      configured: false,
      required: true,
      policies: [],
      pendingTypes: [...REQUIRED_POLICY_TYPES],
    };
  }

  const consentByType = new Map(consents.map((row) => [row.policyType, row.policyVersion]));
  const pendingTypes = policies
    .filter((policy) => consentByType.get(policy.type) !== policy.version)
    .map((policy) => policy.type);

  return {
    configured: true,
    required: pendingTypes.length > 0,
    policies,
    pendingTypes,
  };
}

export async function assertPoliciesConfigured(): Promise<PolicyDocumentPayload[]> {
  const policies = await getActiveRequiredPolicies();
  if (policies.length !== REQUIRED_POLICY_TYPES.length) {
    throw new PolicyError(
      "POLICY_NOT_CONFIGURED",
      "Required policy documents are not configured by an administrator.",
    );
  }
  return policies;
}

export async function recordUserPolicyConsent(
  userId: string,
  acceptedPolicies: UserConsentInput[],
  consentIp: string | null,
): Promise<void> {
  const activePolicies = await assertPoliciesConfigured();
  const acceptedByType = new Map<PolicyDocumentType, number>();
  for (const accepted of acceptedPolicies) {
    acceptedByType.set(accepted.type, accepted.version);
  }

  for (const policy of activePolicies) {
    const acceptedVersion = acceptedByType.get(policy.type);
    if (acceptedVersion === undefined) {
      throw new PolicyError(
        "POLICY_CONSENT_INCOMPLETE",
        `Consent for ${policy.type} is required.`,
      );
    }
    if (acceptedVersion !== policy.version) {
      throw new PolicyError(
        "POLICY_VERSION_MISMATCH",
        `Policy version mismatch for ${policy.type}.`,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    for (const policy of activePolicies) {
      await tx.userPolicyConsent.upsert({
        where: {
          userId_policyType: {
            userId,
            policyType: policy.type,
          },
        },
        update: {
          policyVersion: policy.version,
          consentedAt: now,
          consentIp,
        },
        create: {
          userId,
          policyType: policy.type,
          policyVersion: policy.version,
          consentedAt: now,
          consentIp,
        },
      });
    }
  });
}

export async function upsertPoliciesByAdmin(
  actorUserId: string,
  input: Array<{
    type: PolicyDocumentType;
    content: string;
    isActive: boolean;
  }>,
): Promise<PolicyDocumentPayload[]> {
  const dedup = new Map<PolicyDocumentType, { content: string; isActive: boolean }>();
  for (const row of input) {
    dedup.set(row.type, { content: row.content.trim(), isActive: row.isActive });
  }

  await prisma.$transaction(async (tx) => {
    for (const type of REQUIRED_POLICY_TYPES) {
      const next = dedup.get(type);
      if (!next) continue;

      const existing = await tx.policyDocument.findUnique({
        where: { type },
        select: {
          id: true,
          version: true,
          content: true,
          isActive: true,
        },
      });

      if (!existing) {
        await tx.policyDocument.create({
          data: {
            type,
            version: 1,
            content: next.content,
            isActive: next.isActive,
            updatedByUserId: actorUserId,
          },
        });
        continue;
      }

      const contentChanged = existing.content !== next.content;
      const nextVersion = contentChanged ? existing.version + 1 : existing.version;
      await tx.policyDocument.update({
        where: { id: existing.id },
        data: {
          version: nextVersion,
          content: next.content,
          isActive: next.isActive,
          updatedByUserId: actorUserId,
        },
      });
    }
  });

  return listPoliciesForAdmin();
}
