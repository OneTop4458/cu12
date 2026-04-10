export interface CyberCampusTaskAccessSignal {
  ready: boolean;
  message: string | null;
  messageCode: string | null;
  secondaryAuthBlocked: boolean;
  pageUrl: string;
}

export type CyberCampusTaskAccessState = "READY" | "SECONDARY_AUTH_REQUIRED" | "ERROR";

function isSecondaryAuthMessage(message: string | null): boolean {
  if (!message) {
    return false;
  }

  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.includes("\uBCF8\uC778\uC778\uC99D")
    || normalized.includes("\uC778\uC99D \uD6C4\uC5D0 \uC774\uC6A9\uD558\uC2E4\uC218 \uC788\uC2B5\uB2C8\uB2E4");
}

export function interpretCyberCampusTaskAccessState(
  input: CyberCampusTaskAccessSignal,
): CyberCampusTaskAccessState {
  if (input.ready) {
    return "READY";
  }

  if (input.secondaryAuthBlocked) {
    return "SECONDARY_AUTH_REQUIRED";
  }

  if (/\/ilos\/st\/course\/submain_form\.acl/i.test(input.pageUrl)) {
    return "SECONDARY_AUTH_REQUIRED";
  }

  if (input.messageCode === "E_CONFIRMED_SECONDARY_AUTH") {
    return "SECONDARY_AUTH_REQUIRED";
  }

  if (isSecondaryAuthMessage(input.message)) {
    return "SECONDARY_AUTH_REQUIRED";
  }

  return "ERROR";
}
