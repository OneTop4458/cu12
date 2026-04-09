import { PolicyDocumentType } from "@prisma/client";
import { LegalDocumentPage } from "../_components/legal-document-page";
import {
  getActivePolicyDocument,
  getPolicyDocumentVersion,
  getPolicyHistoryForPublic,
  getPreviousPolicyDocument,
} from "@/server/policy";

function parsePositiveInt(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

export default async function PrivacyPolicyPage({
  searchParams,
}: {
  searchParams: Promise<{
    version?: string | string[];
    compareTo?: string | string[];
  }>;
}) {
  const resolvedSearchParams = await searchParams;
  const requestedVersion = parsePositiveInt(resolvedSearchParams.version);
  const compareToVersion = parsePositiveInt(resolvedSearchParams.compareTo);

  const policy = requestedVersion
    ? await getPolicyDocumentVersion(PolicyDocumentType.PRIVACY_POLICY, requestedVersion)
    : await getActivePolicyDocument(PolicyDocumentType.PRIVACY_POLICY);
  const comparePolicy = policy
    ? compareToVersion
      ? await getPolicyDocumentVersion(PolicyDocumentType.PRIVACY_POLICY, compareToVersion)
      : await getPreviousPolicyDocument(PolicyDocumentType.PRIVACY_POLICY, policy.version)
    : null;
  const history = await getPolicyHistoryForPublic(PolicyDocumentType.PRIVACY_POLICY);

  return (
    <LegalDocumentPage
      title="개인정보 처리 방침"
      emptyMessage="현재 등록된 개인정보 처리 방침이 없습니다."
      policy={policy}
      comparePolicy={comparePolicy}
      history={history}
    />
  );
}
