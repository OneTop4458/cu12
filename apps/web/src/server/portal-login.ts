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
  providerHint?: PortalProvider;
  cu12Id: string;
  cu12Password: string;
  campus?: PortalCampus | null;
}

export type VerifyPortalLoginResult = VerifyCu12LoginResult & {
  verifiedProvider?: PortalProvider;
};

export function isPortalUnavailableResult(result: VerifyPortalLoginResult): boolean {
  return isCu12UnavailableResult(result) || isCyberCampusUnavailableResult(result);
}

export async function verifyPortalLogin(input: VerifyPortalLoginInput): Promise<VerifyPortalLoginResult> {
  const explicitProvider = input.provider ?? input.providerHint;
  const providers: PortalProvider[] = explicitProvider
    ? [normalizePortalProvider(explicitProvider)]
    : ["CU12"];

  let authFailure: VerifyPortalLoginResult | null = null;
  let unavailable: VerifyPortalLoginResult | null = null;

  for (const provider of providers) {
    const result = provider === "CYBER_CAMPUS"
      ? await verifyCyberCampusLogin({
        cu12Id: input.cu12Id,
        cu12Password: input.cu12Password,
      })
      : await verifyCu12Login({
        cu12Id: input.cu12Id,
        cu12Password: input.cu12Password,
        campus: input.campus === "SONGSIN" ? "SONGSIN" : "SONGSIM",
      });

    const resultWithProvider: VerifyPortalLoginResult = {
      ...result,
      verifiedProvider: provider,
    };

    if (result.ok) {
      return resultWithProvider;
    }

    if (isPortalUnavailableResult(resultWithProvider)) {
      unavailable = unavailable ?? resultWithProvider;
      continue;
    }

    authFailure = authFailure ?? resultWithProvider;
  }

  return authFailure ?? unavailable ?? {
    ok: false,
    message: "Portal login request failed",
    messageCode: "PORTAL_UNAVAILABLE",
  };
}
