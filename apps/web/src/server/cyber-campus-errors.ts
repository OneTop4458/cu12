export const CYBER_CAMPUS_PORTAL_UNAVAILABLE_MESSAGE =
  "사이버캠퍼스 연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.";

export interface CyberCampusTransportErrorInfo {
  status: 503;
  errorCode: "PORTAL_UNAVAILABLE";
  message: string;
  details: {
    name: string | null;
    message: string | null;
    causeName: string | null;
    causeCode: string | null;
    causeMessage: string | null;
  };
}

function asError(value: unknown): Error | null {
  return value instanceof Error ? value : null;
}

function getCause(error: Error | null): Error | null {
  const cause = error && "cause" in error ? (error as Error & { cause?: unknown }).cause : null;
  return cause instanceof Error ? cause : null;
}

function toLower(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function hasTransportHint(value: string): boolean {
  return value.includes("fetch failed")
    || value.includes("etimedout")
    || value.includes("econnrefused")
    || value.includes("enotfound")
    || value.includes("eai_again")
    || value.includes("network")
    || value.includes("ssl")
    || value.includes("tls")
    || value.includes("legacy renegotiation");
}

export function normalizeCyberCampusTransportError(error: unknown): CyberCampusTransportErrorInfo | null {
  const root = asError(error);
  const cause = getCause(root);
  const message = toLower(root?.message);
  const causeCode = cause && "code" in cause ? String((cause as Error & { code?: unknown }).code ?? "") : "";
  const causeMessage = toLower(cause?.message);

  const isTransport =
    hasTransportHint(message)
    || hasTransportHint(causeMessage)
    || causeCode.toLowerCase().includes("ssl")
    || causeCode.toLowerCase().includes("tls")
    || causeCode === "ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED";

  if (!isTransport) {
    return null;
  }

  return {
    status: 503,
    errorCode: "PORTAL_UNAVAILABLE",
    message: CYBER_CAMPUS_PORTAL_UNAVAILABLE_MESSAGE,
    details: {
      name: root?.name ?? null,
      message: root?.message ?? null,
      causeName: cause?.name ?? null,
      causeCode: causeCode || null,
      causeMessage: cause?.message ?? null,
    },
  };
}
