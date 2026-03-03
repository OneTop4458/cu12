import { getEnv } from "@/lib/env";

export type Cu12Campus = "SONGSIM" | "SONGSIN";

interface Cu12LoginResponse {
  isError?: boolean;
  message?: string;
  messageCode?: string;
  usr_id?: string;
  univ_id?: string;
}

export interface VerifyCu12LoginInput {
  cu12Id: string;
  cu12Password: string;
  campus: Cu12Campus;
}

export interface VerifyCu12LoginResult {
  ok: boolean;
  message: string;
  messageCode?: string;
}

function toUnivId(campus: Cu12Campus): "catholic" | "songsin" {
  return campus === "SONGSIN" ? "songsin" : "catholic";
}

export async function verifyCu12Login(input: VerifyCu12LoginInput): Promise<VerifyCu12LoginResult> {
  const url = new URL("/el/lo/hak_login_proc.acl", getEnv().CU12_BASE_URL);
  const body = new URLSearchParams({
    univ_id: toUnivId(input.campus),
    usr_id: input.cu12Id,
    usr_pwd: input.cu12Password,
    se_flag: "",
    returnURL: "/el/main/main_form.acl",
    returnSNO: "",
    remember: "N",
    encoding: "utf-8",
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      ok: false,
      message: `CU12 login request failed (${response.status})`,
    };
  }

  const raw = await response.text();
  let parsed: Cu12LoginResponse;
  try {
    parsed = JSON.parse(raw) as Cu12LoginResponse;
  } catch {
    return {
      ok: false,
      message: "CU12 login response parse failed",
    };
  }

  if (parsed.isError) {
    return {
      ok: false,
      message: parsed.message ?? "Invalid CU12 credentials",
      messageCode: parsed.messageCode,
    };
  }

  return {
    ok: true,
    message: parsed.message ?? "OK",
    messageCode: parsed.messageCode,
  };
}
