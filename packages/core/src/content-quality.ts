function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeComparable(value: string | null | undefined): string {
  return normalizeWhitespace(value ?? "").toLowerCase();
}

function stripDateTimeFragments(value: string): string {
  return value
    .replace(/\d{4}[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}(?:\s*(?:AM|PM|오전|오후))?(?:\s+\d{1,2}(?::\d{2}){0,2})?/gi, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ");
}

export function cleanupNoticeBody(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^(?:공지내용\s*)+/i, "")
    .replace(/^해당\s*공지사항을\s*열람할\s*수\s*없습니다\.?\s*/i, "")
    .trim();
}

export function scoreNoticeBodyQuality(value: string): number {
  const text = cleanupNoticeBody(value);
  if (!text) return -2;

  let score = 0;
  if (text.length >= 40) score += 2;
  else if (text.length >= 15) score += 1;
  else score -= 1;

  const metaPatterns = [
    /조회수/i,
    /등록일/i,
    /작성일/i,
    /작성자/i,
    /공지\s*사항/i,
  ];
  const metaHits = metaPatterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  const hasDate = /\d{4}[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}/.test(text);

  if (metaHits >= 2 && text.length <= 220) score -= 3;
  if (hasDate && metaHits >= 1 && text.length <= 220) score -= 2;
  if (/조회수/i.test(text) && text.length <= 260) score -= 3;
  if (/^(?:공지|공지사항|사항|내용)$/i.test(text)) score -= 3;

  return score;
}

export function hasUsableNoticeBody(value: string | null | undefined): boolean {
  return scoreNoticeBodyQuality(value ?? "") > 0;
}

export function hasConfidentNoticeBody(value: string | null | undefined): boolean {
  return scoreNoticeBodyQuality(value ?? "") >= 2;
}

export function shouldResolveNoticeDetailBody(value: string | null | undefined): boolean {
  return !hasConfidentNoticeBody(value ?? "");
}

export function selectPreferredNoticeBody(
  currentValue: string | null | undefined,
  candidateValue: string | null | undefined,
): string {
  const current = cleanupNoticeBody(currentValue ?? "");
  const candidate = cleanupNoticeBody(candidateValue ?? "");

  const currentScore = scoreNoticeBodyQuality(current);
  const candidateScore = scoreNoticeBodyQuality(candidate);

  if (candidateScore > currentScore) {
    return candidate;
  }
  if (candidateScore === currentScore && candidate.length > current.length) {
    return candidate;
  }
  return current;
}

export function cleanupNotificationCategory(value: string | null | undefined): string {
  const cleaned = normalizeWhitespace(value ?? "")
    .replace(/^\[|\]$/g, "")
    .replace(/[_-]+/g, " ")
    .trim();

  if (!cleaned) return "";
  if (!/[가-힣A-Za-z]/.test(cleaned)) return "";

  const comparable = normalizeComparable(cleaned);
  if (new Set(["notification", "notice", "content", "item", "list", "new"]).has(comparable)) {
    return "";
  }

  return cleaned;
}

function stripNotificationAffixes(
  value: string,
  prefixes: Array<string | null | undefined>,
): string {
  let current = normalizeWhitespace(value);
  let changed = true;

  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      const cleanedPrefix = normalizeWhitespace(prefix ?? "");
      if (!cleanedPrefix) continue;
      const pattern = new RegExp(`^(?:\\[${escapeRegExp(cleanedPrefix)}\\]|${escapeRegExp(cleanedPrefix)})\\s*(?:[|:·\\-]\\s*)?`, "i");
      const next = current.replace(pattern, "").trim();
      if (next !== current) {
        current = next;
        changed = true;
      }
    }
  }

  return current;
}

export function cleanupNotificationMessage(
  value: string | null | undefined,
  input?: {
    subject?: string | null;
    category?: string | null;
    rawTime?: string | null;
  },
): string {
  let current = normalizeWhitespace(value ?? "");
  if (!current) return "";

  current = current
    .replace(/(?:미확인|읽지않음|읽음|not-read|not_checked|checked|new)/gi, " ")
    .replace(/(?:상세보기|바로가기|더보기|열기|이동|보기|go|open|view more|close)/gi, " ")
    .replace(/^[\s|:·\-]+|[\s|:·\-]+$/g, " ")
    .trim();

  current = stripNotificationAffixes(current, [
    input?.subject ?? "",
    input?.category ?? "",
    "알림",
    "공지",
  ]);

  if (input?.rawTime) {
    const cleanedTime = normalizeWhitespace(input.rawTime);
    if (cleanedTime) {
      current = current.replace(new RegExp(escapeRegExp(cleanedTime), "ig"), " ").trim();
    }
  }

  current = stripDateTimeFragments(current);
  current = current
    .replace(/(?:미확인|읽지않음|읽음|not-read|not_checked|checked|new)/gi, " ")
    .replace(/(?:상세보기|바로가기|더보기|열기|이동|보기|go|open|view more|close)/gi, " ")
    .replace(/\s*[|:·\-]\s*/g, " ")
    .replace(/\(\s*\)/g, " ")
    .trim();

  const comparable = normalizeComparable(current);
  const subjectComparable = normalizeComparable(input?.subject);
  const categoryComparable = normalizeComparable(input?.category);
  if (!current) return "";
  if (comparable === subjectComparable || comparable === categoryComparable) {
    return "";
  }
  if (new Set(["알림", "공지", "내용 없음", "미확인", "읽지않음"]).has(current)) {
    return "";
  }

  return current;
}

export function scoreNotificationMessageQuality(
  value: string | null | undefined,
  input?: {
    subject?: string | null;
    category?: string | null;
  },
): number {
  const text = cleanupNotificationMessage(value, input);
  if (!text) return -2;

  const comparable = normalizeComparable(text);
  const subjectComparable = normalizeComparable(input?.subject);
  const categoryComparable = normalizeComparable(input?.category);

  let score = 0;
  if (text.length >= 30) score += 2;
  else if (text.length >= 12) score += 1;
  else score -= 1;

  if (/[가-힣A-Za-z]/.test(text)) score += 1;
  if (/^\d+$/.test(text)) score -= 2;
  if (!/[가-힣A-Za-z]/.test(text)) score -= 1;
  if (comparable === subjectComparable || comparable === categoryComparable) score -= 2;
  if (/^(?:알림|공지|내용 없음|미확인|읽지않음)$/i.test(text)) score -= 3;
  if (/^(?:상세보기|바로가기|더보기|열기|이동|보기|go|open|view more|close)$/i.test(text)) score -= 3;
  if (/\d{4}[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}/.test(text)) score -= 2;

  return score;
}

export function hasUsableNotificationMessage(
  value: string | null | undefined,
  input?: {
    subject?: string | null;
    category?: string | null;
  },
): boolean {
  return scoreNotificationMessageQuality(value, input) > 0;
}

export function hasConfidentNotificationMessage(
  value: string | null | undefined,
  input?: {
    subject?: string | null;
    category?: string | null;
  },
): boolean {
  return scoreNotificationMessageQuality(value, input) >= 2;
}
