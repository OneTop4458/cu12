import { PolicyDocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const REQUIRED_POLICY_TYPES: PolicyDocumentType[] = [
  PolicyDocumentType.PRIVACY_POLICY,
  PolicyDocumentType.TERMS_OF_SERVICE,
];

const POLICY_PROFILE_ID = "default";

const POLICY_TEMPLATE_TOKENS = {
  companyName: "{{COMPANY_NAME}}",
  supportEmail: "{{SUPPORT_EMAIL}}",
  companyAddress: "{{COMPANY_ADDRESS}}",
  dpoName: "{{DPO_NAME}}",
  dpoTitle: "{{DPO_TITLE}}",
  dpoEmail: "{{DPO_EMAIL}}",
  dpoPhone: "{{DPO_PHONE}}",
  jurisdictionCourt: "{{JURISDICTION_COURT}}",
  effectiveDate: "{{EFFECTIVE_DATE}}",
  revisionDate: "{{REVISION_DATE}}",
} as const;

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

export interface PolicyProfilePayload {
  companyName: string | null;
  supportEmail: string | null;
  companyAddress: string | null;
  dpoName: string | null;
  dpoTitle: string | null;
  dpoEmail: string | null;
  dpoPhone: string | null;
  jurisdictionCourt: string | null;
  effectiveDate: string | null;
  revisionDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PolicyProfileInput {
  companyName?: string | null;
  supportEmail?: string | null;
  companyAddress?: string | null;
  dpoName?: string | null;
  dpoTitle?: string | null;
  dpoEmail?: string | null;
  dpoPhone?: string | null;
  jurisdictionCourt?: string | null;
  effectiveDate?: string | null;
  revisionDate?: string | null;
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

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next.length > 0 ? next : null;
}

function emptyProfilePayload(): PolicyProfilePayload {
  return {
    companyName: null,
    supportEmail: null,
    companyAddress: null,
    dpoName: null,
    dpoTitle: null,
    dpoEmail: null,
    dpoPhone: null,
    jurisdictionCourt: null,
    effectiveDate: null,
    revisionDate: null,
    createdAt: null,
    updatedAt: null,
  };
}

function mapProfileRow(row: {
  companyName: string | null;
  supportEmail: string | null;
  companyAddress: string | null;
  dpoName: string | null;
  dpoTitle: string | null;
  dpoEmail: string | null;
  dpoPhone: string | null;
  jurisdictionCourt: string | null;
  effectiveDate: string | null;
  revisionDate: string | null;
  createdAt: Date;
  updatedAt: Date;
} | null): PolicyProfilePayload {
  if (!row) return emptyProfilePayload();
  return {
    companyName: row.companyName,
    supportEmail: row.supportEmail,
    companyAddress: row.companyAddress,
    dpoName: row.dpoName,
    dpoTitle: row.dpoTitle,
    dpoEmail: row.dpoEmail,
    dpoPhone: row.dpoPhone,
    jurisdictionCourt: row.jurisdictionCourt,
    effectiveDate: row.effectiveDate,
    revisionDate: row.revisionDate,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function sanitizeProfileInput(input: PolicyProfileInput): Omit<PolicyProfilePayload, "createdAt" | "updatedAt"> {
  return {
    companyName: trimOrNull(input.companyName),
    supportEmail: trimOrNull(input.supportEmail),
    companyAddress: trimOrNull(input.companyAddress),
    dpoName: trimOrNull(input.dpoName),
    dpoTitle: trimOrNull(input.dpoTitle),
    dpoEmail: trimOrNull(input.dpoEmail),
    dpoPhone: trimOrNull(input.dpoPhone),
    jurisdictionCourt: trimOrNull(input.jurisdictionCourt),
    effectiveDate: trimOrNull(input.effectiveDate),
    revisionDate: trimOrNull(input.revisionDate),
  };
}

function renderPolicyContent(template: string, profile: PolicyProfilePayload): string {
  let content = template;
  const replacements: Array<[string, string]> = [
    [POLICY_TEMPLATE_TOKENS.companyName, profile.companyName ?? ""],
    [POLICY_TEMPLATE_TOKENS.supportEmail, profile.supportEmail ?? ""],
    [POLICY_TEMPLATE_TOKENS.companyAddress, profile.companyAddress ?? ""],
    [POLICY_TEMPLATE_TOKENS.dpoName, profile.dpoName ?? ""],
    [POLICY_TEMPLATE_TOKENS.dpoTitle, profile.dpoTitle ?? ""],
    [POLICY_TEMPLATE_TOKENS.dpoEmail, profile.dpoEmail ?? ""],
    [POLICY_TEMPLATE_TOKENS.dpoPhone, profile.dpoPhone ?? ""],
    [POLICY_TEMPLATE_TOKENS.jurisdictionCourt, profile.jurisdictionCourt ?? ""],
    [POLICY_TEMPLATE_TOKENS.effectiveDate, profile.effectiveDate ?? ""],
    [POLICY_TEMPLATE_TOKENS.revisionDate, profile.revisionDate ?? ""],
  ];

  for (const [token, value] of replacements) {
    content = content.split(token).join(value);
  }
  return content;
}

function toPolicyPayload(
  row: {
    type: PolicyDocumentType;
    version: number;
    content: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  options?: {
    profile?: PolicyProfilePayload;
    renderTemplate?: boolean;
  },
): PolicyDocumentPayload {
  const renderTemplate = options?.renderTemplate === true;
  const profile = options?.profile ?? emptyProfilePayload();

  return {
    type: row.type,
    title: policyTitle(row.type),
    version: row.version,
    content: renderTemplate ? renderPolicyContent(row.content, profile) : row.content,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getPolicyProfileRow() {
  return prisma.policyProfile.findUnique({
    where: { id: POLICY_PROFILE_ID },
    select: {
      companyName: true,
      supportEmail: true,
      companyAddress: true,
      dpoName: true,
      dpoTitle: true,
      dpoEmail: true,
      dpoPhone: true,
      jurisdictionCourt: true,
      effectiveDate: true,
      revisionDate: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getPolicyProfileForAdmin(): Promise<PolicyProfilePayload> {
  const row = await getPolicyProfileRow();
  return mapProfileRow(row);
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

  return rows.map((row) => toPolicyPayload(row));
}

export async function getActiveRequiredPolicies(): Promise<PolicyDocumentPayload[]> {
  const [rows, profile] = await Promise.all([
    prisma.policyDocument.findMany({
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
    }),
    getPolicyProfileForAdmin(),
  ]);

  return rows.map((row) => toPolicyPayload(row, { profile, renderTemplate: true }));
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

export async function upsertPolicyProfileByAdmin(
  actorUserId: string,
  input: PolicyProfileInput,
): Promise<PolicyProfilePayload> {
  const next = sanitizeProfileInput(input);

  await prisma.policyProfile.upsert({
    where: { id: POLICY_PROFILE_ID },
    create: {
      id: POLICY_PROFILE_ID,
      ...next,
      updatedByUserId: actorUserId,
    },
    update: {
      ...next,
      updatedByUserId: actorUserId,
    },
  });

  return getPolicyProfileForAdmin();
}