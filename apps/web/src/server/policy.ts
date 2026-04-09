import { PolicyDocumentType, Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

export const REQUIRED_POLICY_TYPES: PolicyDocumentType[] = [
  PolicyDocumentType.PRIVACY_POLICY,
  PolicyDocumentType.TERMS_OF_SERVICE,
];

const POLICY_PROFILE_ID = "default";
export const PUBLIC_ACTIVE_POLICIES_TAG = "public-active-policies";

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

export type PolicyConsentMode = "INITIAL_REQUIRED" | "UPDATED_REQUIRED";

export class PolicyError extends Error {
  readonly code: PolicyErrorCode;

  constructor(code: PolicyErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface PolicyDocumentPayload {
  id: string;
  type: PolicyDocumentType;
  title: string;
  version: number;
  content: string;
  templateContent: string;
  publishedContent: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyHistoryPayload {
  type: PolicyDocumentType;
  title: string;
  documents: PolicyDocumentPayload[];
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

export interface PolicyChangePayload {
  type: PolicyDocumentType;
  title: string;
  currentVersion: number;
  previousVersion: number | null;
  currentPath: string;
  previousPath: string | null;
  diffPath: string | null;
}

export interface PolicyConsentRequirement {
  configured: boolean;
  required: boolean;
  policies: PolicyDocumentPayload[];
  pendingTypes: PolicyDocumentType[];
  consentMode: PolicyConsentMode | null;
  policyChanges: PolicyChangePayload[];
}

export interface PolicyPublishInput {
  policies?: Array<{
    type: PolicyDocumentType;
    content: string;
    isActive: boolean;
  }>;
  profile?: PolicyProfileInput;
}

export interface PolicyPublishResult {
  updated: boolean;
  policies: PolicyDocumentPayload[];
  history: PolicyHistoryPayload[];
  profile: PolicyProfilePayload;
  publishedChanges: PolicyChangePayload[];
}

type PolicyClient = typeof prisma | Prisma.TransactionClient;

const policyDocumentSelect = {
  id: true,
  type: true,
  version: true,
  content: true,
  templateContent: true,
  publishedContent: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PolicyDocumentRow = {
  id: string;
  type: PolicyDocumentType;
  version: number;
  content: string | null;
  templateContent: string | null;
  publishedContent: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  updatedByUserId?: string | null;
};

const policyProfileSelect = Prisma.validator<Prisma.PolicyProfileSelect>()({
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
});

let warnedLegacyPolicyDocumentSchema = false;
let warnedLegacyPolicyConsentSchema = false;

function getErrorColumn(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  const record = meta as Record<string, unknown>;
  const column = record.column;
  return typeof column === "string" ? column.toLowerCase() : "";
}

function isMissingPolicySnapshotColumnError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code !== "P2022") return false;
    const column = getErrorColumn(error.meta);
    if (column.includes("templatecontent") || column.includes("publishedcontent")) {
      return true;
    }
    return /templatecontent|publishedcontent/i.test(error.message);
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /templatecontent|publishedcontent/i.test(error.message);
  }

  if (error instanceof Error) {
    return /templatecontent|publishedcontent/i.test(error.message)
      && /(column|does not exist|unknown column)/i.test(error.message);
  }

  return false;
}

function warnLegacyPolicyDocumentSchema() {
  if (warnedLegacyPolicyDocumentSchema) return;
  warnedLegacyPolicyDocumentSchema = true;
  console.warn(
    "[policy] DB policy snapshot columns are missing. Falling back to legacy single-document compatibility mode. Run prisma db push.",
  );
}

function isPolicyConsentStorageError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2021" || error.code === "P2022";
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return true;
  }

  if (error instanceof Error) {
    return /(userpolicyconsent|policyversion|policytype)/i.test(error.message);
  }

  return false;
}

function warnLegacyPolicyConsentSchema() {
  if (warnedLegacyPolicyConsentSchema) return;
  warnedLegacyPolicyConsentSchema = true;
  console.warn(
    "[policy] User policy consent storage is unavailable or uses a legacy schema. Falling back to empty-consent compatibility mode.",
  );
}

function policyTitle(type: PolicyDocumentType): string {
  if (type === PolicyDocumentType.PRIVACY_POLICY) return "개인정보 처리 방침";
  return "이용약관";
}

function policyBasePath(type: PolicyDocumentType): string {
  return type === PolicyDocumentType.PRIVACY_POLICY ? "/privacy" : "/terms";
}

export function buildPolicyVersionPath(type: PolicyDocumentType, version?: number | null): string {
  const basePath = policyBasePath(type);
  if (!version || version < 1) return basePath;
  return `${basePath}?version=${version}`;
}

export function buildPolicyDiffPath(
  type: PolicyDocumentType,
  version: number,
  compareTo: number,
): string {
  return `${policyBasePath(type)}?version=${version}&compareTo=${compareTo}`;
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function mapProfileRow(
  row: Prisma.PolicyProfileGetPayload<{ select: typeof policyProfileSelect }> | null,
): PolicyProfilePayload {
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

function mergeProfileInput(current: PolicyProfilePayload, input: PolicyProfileInput | undefined) {
  if (!input) {
    return {
      companyName: current.companyName,
      supportEmail: current.supportEmail,
      companyAddress: current.companyAddress,
      dpoName: current.dpoName,
      dpoTitle: current.dpoTitle,
      dpoEmail: current.dpoEmail,
      dpoPhone: current.dpoPhone,
      jurisdictionCourt: current.jurisdictionCourt,
      effectiveDate: current.effectiveDate,
      revisionDate: current.revisionDate,
    };
  }

  return {
    companyName: Object.prototype.hasOwnProperty.call(input, "companyName")
      ? trimOrNull(input.companyName)
      : current.companyName,
    supportEmail: Object.prototype.hasOwnProperty.call(input, "supportEmail")
      ? trimOrNull(input.supportEmail)
      : current.supportEmail,
    companyAddress: Object.prototype.hasOwnProperty.call(input, "companyAddress")
      ? trimOrNull(input.companyAddress)
      : current.companyAddress,
    dpoName: Object.prototype.hasOwnProperty.call(input, "dpoName")
      ? trimOrNull(input.dpoName)
      : current.dpoName,
    dpoTitle: Object.prototype.hasOwnProperty.call(input, "dpoTitle")
      ? trimOrNull(input.dpoTitle)
      : current.dpoTitle,
    dpoEmail: Object.prototype.hasOwnProperty.call(input, "dpoEmail")
      ? trimOrNull(input.dpoEmail)
      : current.dpoEmail,
    dpoPhone: Object.prototype.hasOwnProperty.call(input, "dpoPhone")
      ? trimOrNull(input.dpoPhone)
      : current.dpoPhone,
    jurisdictionCourt: Object.prototype.hasOwnProperty.call(input, "jurisdictionCourt")
      ? trimOrNull(input.jurisdictionCourt)
      : current.jurisdictionCourt,
    effectiveDate: Object.prototype.hasOwnProperty.call(input, "effectiveDate")
      ? trimOrNull(input.effectiveDate)
      : current.effectiveDate,
    revisionDate: Object.prototype.hasOwnProperty.call(input, "revisionDate")
      ? trimOrNull(input.revisionDate)
      : current.revisionDate,
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

function toPolicyPayload(row: PolicyDocumentRow): PolicyDocumentPayload {
  const templateContent = row.templateContent ?? row.content ?? "";
  const publishedContent = row.publishedContent ?? row.content ?? templateContent;
  return {
    id: row.id,
    type: row.type,
    title: policyTitle(row.type),
    version: row.version,
    content: publishedContent,
    templateContent,
    publishedContent,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function groupLatestByType(rows: PolicyDocumentRow[]): Map<PolicyDocumentType, PolicyDocumentRow> {
  const byType = new Map<PolicyDocumentType, PolicyDocumentRow>();
  for (const row of rows) {
    if (!byType.has(row.type)) {
      byType.set(row.type, row);
    }
  }
  return byType;
}

function toPolicyChangePayload(
  policy: Pick<PolicyDocumentPayload, "type" | "title" | "version">,
  previousVersion: number | null,
): PolicyChangePayload {
  return {
    type: policy.type,
    title: policy.title,
    currentVersion: policy.version,
    previousVersion,
    currentPath: buildPolicyVersionPath(policy.type, policy.version),
    previousPath: previousVersion ? buildPolicyVersionPath(policy.type, previousVersion) : null,
    diffPath: previousVersion ? buildPolicyDiffPath(policy.type, policy.version, previousVersion) : null,
  };
}

async function getPolicyProfileRow(client: PolicyClient = prisma) {
  return client.policyProfile.findUnique({
    where: { id: POLICY_PROFILE_ID },
    select: policyProfileSelect,
  });
}

async function listPolicyRows(client: PolicyClient = prisma) {
  try {
      const rows = await client.policyDocument.findMany({
        where: { type: { in: REQUIRED_POLICY_TYPES } },
        orderBy: [{ type: "asc" }, { version: "desc" }],
        select: policyDocumentSelect as unknown as Prisma.PolicyDocumentSelect,
      });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      version: row.version,
      content: row.content,
      templateContent: row.templateContent,
      publishedContent: row.publishedContent,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  } catch (error) {
    if (!isMissingPolicySnapshotColumnError(error)) {
      throw error;
    }

    warnLegacyPolicyDocumentSchema();
    const rows = await client.$queryRaw<Array<{
      id: string;
      type: PolicyDocumentType;
      version: number;
      content: string;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
    }>>(Prisma.sql`
      SELECT "id", "type", "version", "content", "isActive", "createdAt", "updatedAt"
      FROM "PolicyDocument"
      WHERE "type" IN (${Prisma.join(REQUIRED_POLICY_TYPES)})
      ORDER BY "type" ASC, "version" DESC
    `);

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      version: row.version,
      content: row.content,
      templateContent: row.content,
      publishedContent: row.content,
      isActive: row.isActive,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    }));
  }
}

async function listActivePolicyRows(client: PolicyClient = prisma) {
  return [...groupLatestByType((await listPolicyRows(client)).filter((row) => row.isActive)).values()];
}

export async function getPolicyProfileForAdmin(): Promise<PolicyProfilePayload> {
  return mapProfileRow(await getPolicyProfileRow());
}

export async function listPoliciesForAdmin(): Promise<PolicyDocumentPayload[]> {
  const latestRows = [...groupLatestByType(await listPolicyRows()).values()];
  return latestRows.map(toPolicyPayload);
}

export async function listPolicyHistoryForAdmin(): Promise<PolicyHistoryPayload[]> {
  const rows = await listPolicyRows();
  return REQUIRED_POLICY_TYPES.map((type) => ({
    type,
    title: policyTitle(type),
    documents: rows.filter((row) => row.type === type).map(toPolicyPayload),
  }));
}

async function loadActiveRequiredPolicies(): Promise<PolicyDocumentPayload[]> {
  const activeRows = await listActivePolicyRows();
  return activeRows.map(toPolicyPayload);
}

const getCachedActiveRequiredPoliciesInner = unstable_cache(
  async () => {
    if (!process.env.DATABASE_URL) {
      return [] satisfies PolicyDocumentPayload[];
    }
    return loadActiveRequiredPolicies();
  },
  ["public-active-required-policies"],
  {
    revalidate: 60,
    tags: [PUBLIC_ACTIVE_POLICIES_TAG],
  },
);

export async function getActiveRequiredPolicies(): Promise<PolicyDocumentPayload[]> {
  return loadActiveRequiredPolicies();
}

export async function getCachedActiveRequiredPolicies(): Promise<PolicyDocumentPayload[]> {
  return getCachedActiveRequiredPoliciesInner();
}

export async function getPolicyDocumentVersion(
  type: PolicyDocumentType,
  version: number,
): Promise<PolicyDocumentPayload | null> {
  const rows = await listPolicyRows();
  const row = rows.find((item) => item.type === type && item.version === version) ?? null;
  return row ? toPolicyPayload(row) : null;
}

export async function getLatestPolicyDocument(
  type: PolicyDocumentType,
): Promise<PolicyDocumentPayload | null> {
  const row = (await listPolicyRows()).find((item) => item.type === type) ?? null;
  return row ? toPolicyPayload(row) : null;
}

export async function getActivePolicyDocument(
  type: PolicyDocumentType,
): Promise<PolicyDocumentPayload | null> {
  const row = (await listPolicyRows()).find((item) => item.type === type && item.isActive) ?? null;
  return row ? toPolicyPayload(row) : null;
}

export async function getPreviousPolicyDocument(
  type: PolicyDocumentType,
  version: number,
): Promise<PolicyDocumentPayload | null> {
  const row = (await listPolicyRows()).find((item) => item.type === type && item.version < version) ?? null;
  return row ? toPolicyPayload(row) : null;
}

export async function getPolicyHistoryForPublic(
  type: PolicyDocumentType,
): Promise<PolicyDocumentPayload[]> {
  return (await listPolicyRows())
    .filter((row) => row.type === type)
    .map(toPolicyPayload);
}

export async function listCurrentPolicyNotificationChanges(
  types: PolicyDocumentType[] = REQUIRED_POLICY_TYPES,
): Promise<PolicyChangePayload[]> {
  const rows = await listPolicyRows();

  return types.flatMap((type) => {
    const current = rows.find((row) => row.type === type && row.isActive) ?? null;
    if (!current) {
      return [];
    }

    const previous = rows.find((row) => row.type === type && row.version < current.version) ?? null;
    return [toPolicyChangePayload(toPolicyPayload(current), previous?.version ?? null)];
  });
}

export async function getPolicyConsentRequirement(userId: string): Promise<PolicyConsentRequirement> {
  const policies = await getActiveRequiredPolicies();
  const consents = await prisma.userPolicyConsent.findMany({
    where: {
      userId,
      policyType: { in: REQUIRED_POLICY_TYPES },
    },
    select: {
      policyType: true,
      policyVersion: true,
    },
    orderBy: [
      { policyType: "asc" },
      { policyVersion: "desc" },
    ],
  }).catch((error) => {
    if (!isPolicyConsentStorageError(error)) {
      throw error;
    }

    warnLegacyPolicyConsentSchema();
    return [];
  });

  const configured = policies.length === REQUIRED_POLICY_TYPES.length;
  if (!configured) {
    return {
      configured: false,
      required: true,
      policies: [],
      pendingTypes: [...REQUIRED_POLICY_TYPES],
      consentMode: null,
      policyChanges: [],
    };
  }

  const latestConsentByType = new Map<PolicyDocumentType, number>();
  for (const consent of consents) {
    if (!latestConsentByType.has(consent.policyType)) {
      latestConsentByType.set(consent.policyType, consent.policyVersion);
    }
  }

  const pendingPolicies = policies.filter((policy) => latestConsentByType.get(policy.type) !== policy.version);
  const hasPriorConsent = latestConsentByType.size > 0;
  const consentMode = pendingPolicies.length === 0
    ? null
    : hasPriorConsent
      ? "UPDATED_REQUIRED"
      : "INITIAL_REQUIRED";

  const policyChanges = pendingPolicies.map((policy) =>
    toPolicyChangePayload(
      policy,
      latestConsentByType.get(policy.type) ?? null,
    ));

  return {
    configured: true,
    required: pendingPolicies.length > 0,
    policies,
    pendingTypes: pendingPolicies.map((policy) => policy.type),
    consentMode,
    policyChanges,
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
      const existing = await tx.userPolicyConsent.findFirst({
        where: {
          userId,
          policyType: policy.type,
          policyVersion: policy.version,
        },
        select: {
          id: true,
        },
        orderBy: {
          consentedAt: "desc",
        },
      });

      if (existing) {
        await tx.userPolicyConsent.update({
          where: { id: existing.id },
          data: {
            consentedAt: now,
            consentIp,
          },
        });
        continue;
      }

      await tx.userPolicyConsent.create({
        data: {
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

export async function publishPoliciesByAdmin(
  actorUserId: string,
  input: PolicyPublishInput,
): Promise<PolicyPublishResult> {
  const publishedChanges = await prisma.$transaction(async (tx) => {
    const currentProfile = mapProfileRow(await getPolicyProfileRow(tx));
    const nextProfileCore = mergeProfileInput(currentProfile, input.profile);

    await tx.policyProfile.upsert({
      where: { id: POLICY_PROFILE_ID },
      create: {
        id: POLICY_PROFILE_ID,
        ...nextProfileCore,
        updatedByUserId: actorUserId,
      },
      update: {
        ...nextProfileCore,
        updatedByUserId: actorUserId,
      },
    });

    const nextProfile: PolicyProfilePayload = {
      ...nextProfileCore,
      createdAt: currentProfile.createdAt,
      updatedAt: currentProfile.updatedAt,
    };

    const existingRows = await listPolicyRows(tx);
    const latestByType = groupLatestByType(existingRows);
    const inputByType = new Map(
      (input.policies ?? []).map((policy) => [
        policy.type,
        {
          content: policy.content.trim(),
          isActive: policy.isActive,
        },
      ]),
    );

    const changes: PolicyChangePayload[] = [];

    for (const type of REQUIRED_POLICY_TYPES) {
      const currentRow = latestByType.get(type) ?? null;
      const currentPayload = currentRow ? toPolicyPayload(currentRow) : null;
      const nextTemplate = inputByType.get(type)?.content ?? currentRow?.templateContent ?? "";
      const nextIsActive = inputByType.get(type)?.isActive ?? currentRow?.isActive ?? false;
      const nextPublished = renderPolicyContent(nextTemplate, nextProfile);

      if (!currentRow) {
        if (!nextTemplate.trim()) continue;
        const created = await tx.policyDocument.create({
          data: {
            type,
            version: 1,
            content: nextPublished,
            templateContent: nextTemplate,
            publishedContent: nextPublished,
            isActive: nextIsActive,
            updatedByUserId: actorUserId,
          } as unknown as Prisma.PolicyDocumentCreateInput,
          select: policyDocumentSelect as unknown as Prisma.PolicyDocumentSelect,
        });
        changes.push(toPolicyChangePayload(toPolicyPayload(created), null));
        continue;
      }

      const contentChanged =
        currentRow.templateContent !== nextTemplate
        || currentRow.publishedContent !== nextPublished;

      if (contentChanged) {
        await tx.policyDocument.updateMany({
          where: {
            type,
            isActive: true,
          },
          data: {
            isActive: false,
          },
        });

        const created = await tx.policyDocument.create({
          data: {
            type,
            version: currentRow.version + 1,
            content: nextPublished,
            templateContent: nextTemplate,
            publishedContent: nextPublished,
            isActive: nextIsActive,
            updatedByUserId: actorUserId,
          } as unknown as Prisma.PolicyDocumentCreateInput,
          select: policyDocumentSelect as unknown as Prisma.PolicyDocumentSelect,
        });

        changes.push(
          toPolicyChangePayload(
            toPolicyPayload(created),
            currentPayload?.version ?? null,
          ),
        );
        continue;
      }

      if (currentRow.isActive !== nextIsActive) {
        if (nextIsActive) {
          await tx.policyDocument.updateMany({
            where: {
              type,
              isActive: true,
            },
            data: {
              isActive: false,
            },
          });
        }

        await tx.policyDocument.update({
          where: { id: currentRow.id },
          data: {
            isActive: nextIsActive,
            updatedByUserId: actorUserId,
          },
        });
      }
    }

    return changes;
  });

  const [policies, history, profile] = await Promise.all([
    listPoliciesForAdmin(),
    listPolicyHistoryForAdmin(),
    getPolicyProfileForAdmin(),
  ]);

  return {
    updated: Boolean(input.policies?.length || input.profile),
    policies,
    history,
    profile,
    publishedChanges,
  };
}
