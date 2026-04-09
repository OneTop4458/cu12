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

export default async function TermsOfServicePage({
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
    ? await getPolicyDocumentVersion(PolicyDocumentType.TERMS_OF_SERVICE, requestedVersion)
    : await getActivePolicyDocument(PolicyDocumentType.TERMS_OF_SERVICE);
  const comparePolicy = policy
    ? compareToVersion
      ? await getPolicyDocumentVersion(PolicyDocumentType.TERMS_OF_SERVICE, compareToVersion)
      : await getPreviousPolicyDocument(PolicyDocumentType.TERMS_OF_SERVICE, policy.version)
    : null;
  const history = await getPolicyHistoryForPublic(PolicyDocumentType.TERMS_OF_SERVICE);

  return (
    <LegalDocumentPage
      title="이용약관"
      emptyMessage="현재 등록된 이용약관이 없습니다."
      policy={policy}
      comparePolicy={comparePolicy}
      history={history}
    />
  );
}
