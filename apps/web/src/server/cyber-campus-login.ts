import { getEnv } from "@/lib/env";

interface HttpTextResponse {
  status: number;
  url: string;
  text: string;
}

export interface VerifyCyberCampusLoginInput {
  cu12Id: string;
  cu12Password: string;
}

export interface VerifyCyberCampusLoginResult {
  ok: boolean;
  message: string;
  messageCode?: string;
}

class CyberCampusSessionClient {
  private readonly cookieJar = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  async getText(path: string): Promise<HttpTextResponse> {
    return this.requestText(path, { method: "GET" });
  }

  async postForm(path: string, body: URLSearchParams): Promise<HttpTextResponse> {
    return this.requestText(path, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: body.toString(),
    });
  }

  private async requestText(
    path: string,
    init: {
      method: "GET" | "POST";
      headers?: Record<string, string>;
      body?: string;
    },
  ): Promise<HttpTextResponse> {
    const url = new URL(path, this.baseUrl).toString();
    const headers = new Headers(init.headers ?? {});
    const cookies = this.renderCookieHeader();
    if (cookies) {
      headers.set("cookie", cookies);
    }

    const response = await fetch(url, {
      method: init.method,
      headers,
      body: init.body,
      redirect: "follow",
      cache: "no-store",
    });

    this.captureCookies(response);
    return {
      status: response.status,
      url: response.url,
      text: await response.text(),
    };
  }

  private renderCookieHeader(): string {
    return Array.from(this.cookieJar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  private captureCookies(response: Response): void {
    const headersWithSetCookie = response.headers as unknown as {
      getSetCookie?: () => string[];
    };

    const rawCookies = headersWithSetCookie.getSetCookie?.()
      ?? splitSetCookieHeader(response.headers.get("set-cookie"));
    for (const rawCookie of rawCookies) {
      const cookiePart = rawCookie.split(";")[0]?.trim();
      if (!cookiePart) continue;
      const index = cookiePart.indexOf("=");
      if (index <= 0) continue;
      const name = cookiePart.slice(0, index).trim();
      const value = cookiePart.slice(index + 1).trim();
      if (!name) continue;
      this.cookieJar.set(name, value);
    }
  }
}

function splitSetCookieHeader(rawHeader: string | null): string[] {
  if (!rawHeader) return [];
  const values: string[] = [];
  let start = 0;
  let inExpires = false;

  for (let index = 0; index < rawHeader.length; index += 1) {
    const chunk = rawHeader.slice(index, index + 8).toLowerCase();
    if (chunk === "expires=") {
      inExpires = true;
      continue;
    }

    const char = rawHeader[index];
    if (inExpires && char === ";") {
      inExpires = false;
      continue;
    }

    if (!inExpires && char === ",") {
      const value = rawHeader.slice(start, index).trim();
      if (value) values.push(value);
      start = index + 1;
    }
  }

  const tail = rawHeader.slice(start).trim();
  if (tail) values.push(tail);
  return values;
}

function looksLikeLoginForm(html: string, responseUrl: string): boolean {
  return /\/ilos\/main\/member\/login_form\.acl/i.test(responseUrl)
    || (
      /(id|name)=["']usr_id["']/i.test(html)
      && /(id|name)=["']usr_pwd["']/i.test(html)
      && /(id|name)=["']login_btn["']/i.test(html)
    );
}

function looksAuthenticated(html: string, responseUrl: string): boolean {
  if (/\/ilos\/main\/main_form\.acl/i.test(responseUrl)) return true;
  return /\/ilos\/lo\/logout\.acl/i.test(html)
    || /popTodo\(/i.test(html)
    || /received_list_pop_form\.acl/i.test(html);
}

export function isCyberCampusUnavailableResult(result: VerifyCyberCampusLoginResult): boolean {
  return !result.ok && result.messageCode === "CYBER_CAMPUS_UNAVAILABLE";
}

export async function verifyCyberCampusLogin(
  input: VerifyCyberCampusLoginInput,
): Promise<VerifyCyberCampusLoginResult> {
  const client = new CyberCampusSessionClient(getEnv().CYBER_CAMPUS_BASE_URL);

  try {
    await client.getText("/ilos/main/member/login_form.acl");
    const response = await client.postForm("/ilos/lo/login.acl", new URLSearchParams({
      usr_id: input.cu12Id,
      usr_pwd: input.cu12Password,
      returnURL: "",
      challenge: "",
      response: "",
    }));

    if (response.status >= 400) {
      return {
        ok: false,
        message: `Cyber Campus login request failed (${response.status})`,
      };
    }

    if (looksAuthenticated(response.text, response.url) && !looksLikeLoginForm(response.text, response.url)) {
      return {
        ok: true,
        message: "OK",
      };
    }

    return {
      ok: false,
      message: "Invalid Cyber Campus credentials",
      messageCode: "AUTH_FAILED",
    };
  } catch {
    return {
      ok: false,
      message: "Cyber Campus login request failed",
      messageCode: "CYBER_CAMPUS_UNAVAILABLE",
    };
  }
}
