import { CyberCampusSessionClient } from "@/server/cyber-campus-session";
import {
  CYBER_CAMPUS_PORTAL_UNAVAILABLE_MESSAGE,
  normalizeCyberCampusTransportError,
} from "@/server/cyber-campus-errors";

export interface VerifyCyberCampusLoginInput {
  cu12Id: string;
  cu12Password: string;
}

export interface VerifyCyberCampusLoginResult {
  ok: boolean;
  message: string;
  messageCode?: string;
}

export function isCyberCampusUnavailableResult(result: VerifyCyberCampusLoginResult): boolean {
  return !result.ok && result.messageCode === "CYBER_CAMPUS_UNAVAILABLE";
}

export async function verifyCyberCampusLogin(
  input: VerifyCyberCampusLoginInput,
): Promise<VerifyCyberCampusLoginResult> {
  const client = new CyberCampusSessionClient();

  try {
    const ok = await client.login({
      cu12Id: input.cu12Id,
      cu12Password: input.cu12Password,
    });

    if (ok) {
      return {
        ok: true,
        message: "OK",
      };
    }

    return {
      ok: false,
      message: "\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uACC4\uC815 \uC815\uBCF4\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
      messageCode: "AUTH_FAILED",
    };
  } catch (error) {
    const normalized = normalizeCyberCampusTransportError(error);
    return {
      ok: false,
      message: normalized?.message ?? CYBER_CAMPUS_PORTAL_UNAVAILABLE_MESSAGE,
      messageCode: "CYBER_CAMPUS_UNAVAILABLE",
    };
  }
}
