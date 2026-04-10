import {
  parseCyberCampusSecondaryAuthMethods,
  type CyberCampusSecondaryAuthMethod,
} from "@cu12/core";
import { getEnv } from "@/lib/env";

export interface CyberCampusCredentials {
  cu12Id: string;
  cu12Password: string;
}

export interface CookieStateEntry {
  name: string;
  value: string;
}

export type SecondaryAuthMethod = CyberCampusSecondaryAuthMethod;

interface HttpTextResponse {
  status: number;
  url: string;
  text: string;
}

interface SecondaryAuthJsonResponse {
  isError?: boolean;
  message?: string;
  messageCode?: string;
  [key: string]: unknown;
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

function toExpiresAt(currentTime: unknown, expireTime: unknown): Date | null {
  const current = Number(currentTime);
  const expire = Number(expireTime);
  if (!Number.isFinite(expire)) return null;
  if (expire > 1_000_000_000_000) return new Date(expire);
  if (Number.isFinite(current) && current > 1_000_000_000_000 && expire > current) {
    return new Date(expire);
  }
  if (expire > 1_000_000_000) return new Date(expire * 1000);
  return null;
}

export class CyberCampusSessionClient {
  private readonly cookieJar = new Map<string, string>();
  private readonly baseUrl: string;

  constructor(options?: {
    baseUrl?: string;
    cookieState?: CookieStateEntry[];
  }) {
    this.baseUrl = options?.baseUrl ?? getEnv().CYBER_CAMPUS_BASE_URL;
    for (const cookie of options?.cookieState ?? []) {
      if (!cookie?.name) continue;
      this.cookieJar.set(cookie.name, cookie.value ?? "");
    }
  }

  exportCookieState(): CookieStateEntry[] {
    return Array.from(this.cookieJar.entries()).map(([name, value]) => ({ name, value }));
  }

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

  async postJson(path: string, body: URLSearchParams): Promise<SecondaryAuthJsonResponse> {
    const response = await this.postForm(path, body);
    try {
      return JSON.parse(response.text) as SecondaryAuthJsonResponse;
    } catch {
      throw new Error(`CYBER_CAMPUS_INVALID_JSON:${path}`);
    }
  }

  async login(creds: CyberCampusCredentials): Promise<boolean> {
    await this.getText("/ilos/main/member/login_form.acl");
    const response = await this.postForm("/ilos/lo/login.acl", new URLSearchParams({
      usr_id: creds.cu12Id,
      usr_pwd: creds.cu12Password,
      returnURL: "",
      challenge: "",
      response: "",
    }));
    return looksAuthenticated(response.text, response.url) && !looksLikeLoginForm(response.text, response.url);
  }

  async ensureAuthenticated(creds: CyberCampusCredentials): Promise<boolean> {
    if (await this.isAuthenticated()) return true;
    return this.login(creds);
  }

  async isAuthenticated(): Promise<boolean> {
    const response = await this.getText("/ilos/main/main_form.acl");
    return looksAuthenticated(response.text, response.url) && !looksLikeLoginForm(response.text, response.url);
  }

  async checkSecondaryAuth(): Promise<{
    ready: boolean;
    message?: string;
    messageCode?: string;
  }> {
    const data = await this.postJson("/ilos/secondauth/session_secondary_auth_check.acl", new URLSearchParams({
      returnData: "json",
      AUTH_DIV: "1",
      encoding: "utf-8",
    }));
    if (data.isError) {
      return {
        ready: false,
        message: typeof data.message === "string" ? data.message : undefined,
        messageCode: typeof data.messageCode === "string" ? data.messageCode : undefined,
      };
    }
    return { ready: true };
  }

  async getSecondaryAuthWayInfo(): Promise<{
    methods: SecondaryAuthMethod[];
    userName: string | null;
    userEmail: string | null;
  }> {
    const data = await this.postJson("/ilos/secondauth/secondary_auth_way_info.acl", new URLSearchParams({
      AUTH_DIV: "1",
      returnData: "json",
      encoding: "utf-8",
    }));
    if (data.isError) {
      throw new Error(typeof data.message === "string" ? data.message : "CYBER_CAMPUS_SECONDARY_AUTH_METHODS_FAILED");
    }

    return {
      methods: parseCyberCampusSecondaryAuthMethods(data),
      userName: typeof data.USER_NAME === "string" ? data.USER_NAME : null,
      userEmail: typeof data.USER_EMAIL === "string" ? data.USER_EMAIL : null,
    };
  }

  async startSecondaryAuth(input: {
    way: number;
    param: string;
    target: string;
  }): Promise<{
    authSeq: string;
    way: number;
    param: string;
    target: string;
    requestCode: string | null;
    displayCode: string | null;
    requiresCode: boolean;
    expiresAt: Date | null;
  }> {
    const data = await this.postJson("/ilos/secondauth/secondary_auth_start.acl", new URLSearchParams({
      AUTH_DIV: "1",
      AUTH_WAY: String(input.way),
      AUTH_PARAM: input.param,
      returnData: "json",
      encoding: "utf-8",
    }));
    if (data.isError) {
      throw new Error(typeof data.message === "string" ? data.message : "CYBER_CAMPUS_SECONDARY_AUTH_START_FAILED");
    }

    return {
      authSeq: String(data.AUTH_SEQ ?? ""),
      way: input.way,
      param: input.param,
      target: input.target,
      requestCode: typeof data.REQUEST_CODE === "string" ? data.REQUEST_CODE : null,
      displayCode: typeof data.AUTH_CODE === "string" ? data.AUTH_CODE : null,
      requiresCode: input.way !== 5,
      expiresAt: toExpiresAt(data.CURRENT_TIME, data.EXPIRE_TIME),
    };
  }

  async confirmSecondaryAuth(input: {
    authSeq: string;
    way: number;
    param: string;
    code?: string | null;
  }): Promise<{
    completed: boolean;
    pending: boolean;
    message?: string;
    messageCode?: string;
  }> {
    const data = await this.postJson("/ilos/secondauth/secondary_auth_confirm.acl", new URLSearchParams({
      AUTH_SEQ: input.authSeq,
      AUTH_DIV: "1",
      AUTH_WAY: String(input.way),
      AUTH_CODE: input.code ?? "",
      AUTH_PARAM: input.param,
      returnData: "json",
      encoding: "utf-8",
    }));
    if (data.isError) {
      const messageCode = typeof data.messageCode === "string" ? data.messageCode : undefined;
      return {
        completed: false,
        pending: messageCode === "E_CONFIRMED_SECONDARY_AUTH",
        message: typeof data.message === "string" ? data.message : undefined,
        messageCode,
      };
    }
    return { completed: true, pending: false };
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
