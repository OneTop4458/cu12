import type { PortalCampus, PortalProvider } from "@cu12/core";
import {
  isCu12UnavailableResult,
  verifyCu12Login,
  type VerifyCu12LoginResult,
} from "@/server/cu12-login";
import {
  isCyberCampusUnavailableResult,
  verifyCyberCampusLogin,
} from "@/server/cyber-campus-login";
import { normalizePortalProvider } from "@/server/portal-provider";

export interface VerifyPortalLoginInput {
  provider?: PortalProvider;
  cu12Id: string;
  cu12Password: string;
  campus?: PortalCampus | null;
}

export type VerifyPortalLoginResult = VerifyCu12LoginResult;

export function isPortalUnavailableResult(result: VerifyPortalLoginResult): boolean {
  return isCu12UnavailableResult(result) || isCyberCampusUnavailableResult(result);
}

export async function verifyPortalLogin(input: VerifyPortalLoginInput): Promise<VerifyPortalLoginResult> {
  const provider = normalizePortalProvider(input.provider);
  if (provider === "CYBER_CAMPUS") {
    return verifyCyberCampusLogin({
      cu12Id: input.cu12Id,
      cu12Password: input.cu12Password,
    });
  }

  return verifyCu12Login({
    cu12Id: input.cu12Id,
    cu12Password: input.cu12Password,
    campus: input.campus === "SONGSIN" ? "SONGSIN" : "SONGSIM",
  });
}
