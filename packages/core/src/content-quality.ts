function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeComparable(value: string | null | undefined): string {
  return normalizeWhitespace(value ?? "").toLowerCase();
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function stripDateTimeFragments(value: string): string {
  return value
    .replace(/\d{4}[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}(?:\s*(?:AM|PM|\uC624\uC804|\uC624\uD6C4))?(?:\s+\d{1,2}(?::\d{2}){0,2})?/gi, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ");
}

export function cleanupNoticeBody(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^(?:\uACF5\uC9C0\uB0B4\uC6A9\s*)+/i, "")
    .replace(/^\uD574\uB2F9\s*\uACF5\uC9C0\uC0AC\uD56D\uC744\s*\uC5F4\uB78C\uD560\s*\uC218\s*\uC5C6\uC2B5\uB2C8\uB2E4\.?\s*/i, "")
    .trim();
}

export function scoreNoticeBodyQuality(value: string): number {
  const text = cleanupNoticeBody(value);
  if (!text) return -2;

  let score = 0;
  if (text.length >= 80) score += 3;
  else if (text.length >= 40) score += 2;
  else if (text.length >= 15) score += 1;
  else score -= 1;

  const metaPatterns = [
    /\uC870\uD68C\uC218/i,
    /\uB4F1\uB85D\uC77C/i,
    /\uC791\uC131\uC77C/i,
    /\uC791\uC131\uC790/i,
    /\uACF5\uC9C0\s*\uC0AC\uD56D/i,
  ];
  const navigationPatterns = [
    /\uBCF8\uBB38\uC73C\uB85C\s*\uC774\uB3D9/i,
    /\uAC15\uC758\uC2E4\uBA54\uB274\uB85C\s*\uC774\uB3D9/i,
    /\uAC00\uD1A8\uB9AD\uACF5\uC720\uB300\uD559\s*\uBA54\uC778\uD654\uBA74/i,
    /\uB098\uC758\uACFC\uC815/i,
    /\uC218\uAC15\uC2E0\uCCAD\uB0B4\uC5ED/i,
    /\uC218\uAC15\uC2DC\uAC04\uD45C/i,
    /\uACF5\uACB0\uC2E0\uCCAD/i,
    /\uC774\uC218\uC99D\s*\uCD9C\uB825/i,
    /\uD504\uB85C\uD544\s*\uC124\uC815/i,
    /\uB85C\uADF8\uC544\uC6C3/i,
    /\uC5B8\uC5B4\s*KOR\s*ENG/i,
    /\uBA54\uB274\uB2EB\uAE30/i,
    /\uBAA8\uBC14\uC77C\s*\uBA54\uB274/i,
  ];
  const metaHits = countMatches(text, metaPatterns);
  const navigationHits = countMatches(text, navigationPatterns);
  const hasDate = /\d{4}[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}/.test(text);

  if (metaHits >= 2 && text.length <= 220) score -= 3;
  if (hasDate && metaHits >= 1 && text.length <= 220) score -= 2;
  if (/\uC870\uD68C\uC218/i.test(text) && text.length <= 260) score -= 3;
  if (/^(?:\uACF5\uC9C0|\uACF5\uC9C0\uC0AC\uD56D|\uC0AC\uD56D|\uB0B4\uC6A9)$/i.test(text)) score -= 3;
  if (navigationHits >= 2 && text.length <= 1200) score -= 8;
  if (navigationHits >= 4) score -= 12;
  if (/^(?:\uBCF8\uBB38\uC73C\uB85C\s*\uC774\uB3D9|\uAC15\uC758\uC2E4\uBA54\uB274\uB85C\s*\uC774\uB3D9)/i.test(text)) {
    score -= 6;
  }

  return score;
}

export function hasUsableNoticeBody(value: string | null | undefined): boolean {
  return scoreNoticeBodyQuality(value ?? "") > 0;
}

export function hasConfidentNoticeBody(value: string | null | undefined): boolean {
  return scoreNoticeBodyQuality(value ?? "") >= 3;
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
  const currentConfident = hasConfidentNoticeBody(current);

  if (candidateScore > currentScore) {
    return candidate;
  }
  if (candidateScore === currentScore && !currentConfident && candidate.length > 0) {
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
  if (!/[\uAC00-\uD7A3A-Za-z]/.test(cleaned)) return "";

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
      const pattern = new RegExp(`^(?:\\[${escapeRegExp(cleanedPrefix)}\\]|${escapeRegExp(cleanedPrefix)})\\s*(?:[|:\\u00b7\\-]\\s*)?`, "i");
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
    .replace(/(?:\uBBF8\uD655\uC778|\uC77D\uC9C0\uC54A\uC74C|\uC77D\uC74C|not-read|not_checked|checked|new)/gi, " ")
    .replace(/(?:\uC0C1\uC138\uBCF4\uAE30|\uBC14\uB85C\uAC00\uAE30|\uB354\uBCF4\uAE30|\uC5F4\uAE30|\uC774\uB3D9|\uBCF4\uAE30|go|open|view more|close)/gi, " ")
    .replace(/^[\s|:\u00b7\-]+|[\s|:\u00b7\-]+$/g, " ")
    .trim();

  current = stripNotificationAffixes(current, [
    input?.subject ?? "",
    input?.category ?? "",
    "\uC54C\uB9BC",
    "\uACF5\uC9C0",
  ]);

  if (input?.rawTime) {
    const cleanedTime = normalizeWhitespace(input.rawTime);
    if (cleanedTime) {
      current = current.replace(new RegExp(escapeRegExp(cleanedTime), "ig"), " ").trim();
    }
  }

  current = stripDateTimeFragments(current);
  current = current
    .replace(/(?:\uBBF8\uD655\uC778|\uC77D\uC9C0\uC54A\uC74C|\uC77D\uC74C|not-read|not_checked|checked|new)/gi, " ")
    .replace(/(?:\uC0C1\uC138\uBCF4\uAE30|\uBC14\uB85C\uAC00\uAE30|\uB354\uBCF4\uAE30|\uC5F4\uAE30|\uC774\uB3D9|\uBCF4\uAE30|go|open|view more|close)/gi, " ")
    .replace(/\s*[|:\u00b7\-]\s*/g, " ")
    .replace(/\(\s*\)/g, " ")
    .trim();

  const comparable = normalizeComparable(current);
  const subjectComparable = normalizeComparable(input?.subject);
  const categoryComparable = normalizeComparable(input?.category);
  if (!current) return "";
  if (comparable === subjectComparable || comparable === categoryComparable) {
    return "";
  }
  if (new Set(["\uC54C\uB9BC", "\uACF5\uC9C0", "\uB0B4\uC6A9 \uC5C6\uC74C", "\uBBF8\uD655\uC778", "\uC77D\uC9C0\uC54A\uC74C"]).has(current)) {
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

  if (/[\uAC00-\uD7A3A-Za-z]/.test(text)) score += 1;
  if (/^\d+$/.test(text)) score -= 2;
  if (!/[\uAC00-\uD7A3A-Za-z]/.test(text)) score -= 1;
  if (comparable === subjectComparable || comparable === categoryComparable) score -= 2;
  if (/^(?:\uC54C\uB9BC|\uACF5\uC9C0|\uB0B4\uC6A9 \uC5C6\uC74C|\uBBF8\uD655\uC778|\uC77D\uC9C0\uC54A\uC74C)$/i.test(text)) score -= 3;
  if (/^(?:\uC0C1\uC138\uBCF4\uAE30|\uBC14\uB85C\uAC00\uAE30|\uB354\uBCF4\uAE30|\uC5F4\uAE30|\uC774\uB3D9|\uBCF4\uAE30|go|open|view more|close)$/i.test(text)) score -= 3;
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
