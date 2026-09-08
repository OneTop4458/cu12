export const MAIL_TEMPLATE_KINDS = [
  "DEADLINE", "AUTOLEARN_RESULT", "AUTOLEARN_TERMINAL", "POLICY_UPDATE", "ADMIN_APPROVAL_REQUEST", "TEST",
] as const;
export type MailTemplateKind = typeof MAIL_TEMPLATE_KINDS[number];
export type MailConfigSource = "ENV" | "CUSTOM";
export type MailTlsMode = "STARTTLS" | "TLS" | "NONE";

export interface MailTemplateInput { subject: string; body: string }
export const DEFAULT_MAIL_TEMPLATE: MailTemplateInput = { subject: "{{subject}}", body: "{{content}}" };

export interface StoredMailSettings {
  enabled: boolean;
  source: string;
  host: string;
  port: number;
  tlsMode: string;
  username: string;
  encryptedPassword: string | null;
  fromEmail: string;
  fromName: string;
}

export const DEFAULT_MAIL_SETTINGS: StoredMailSettings = {
  enabled: true, source: "ENV", host: "", port: 587, tlsMode: "STARTTLS", username: "",
  encryptedPassword: null, fromEmail: "", fromName: "",
};

export interface MailEnvironment {
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
}

export function hasEnvironmentMailConfig(env: MailEnvironment): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);
}

export function publicMailSettings(settings: StoredMailSettings | null) {
  const value = settings ?? DEFAULT_MAIL_SETTINGS;
  return {
    enabled: value.enabled, source: value.source, host: value.host, port: value.port,
    tlsMode: value.tlsMode, username: value.username, fromEmail: value.fromEmail,
    fromName: value.fromName, passwordConfigured: Boolean(value.encryptedPassword),
  };
}

export function resolveMailTransport(settings: StoredMailSettings | null, env: MailEnvironment, decrypt: (value: string) => string) {
  const value = settings ?? DEFAULT_MAIL_SETTINGS;
  if (!value.enabled) return { config: null, reason: "MAIL_DISABLED" } as const;
  const base = {
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000, dnsTimeout: 10000,
    disableFileAccess: true, disableUrlAccess: true, logger: false as const, debug: false,
  };
  if (value.source === "ENV") {
    if (!hasEnvironmentMailConfig(env)) return { config: null, reason: "SMTP_NOT_CONFIGURED" } as const;
    return { reason: null, config: {
      from: env.SMTP_FROM!,
      options: { ...base, host: env.SMTP_HOST!, port: env.SMTP_PORT!, secure: env.SMTP_PORT === 465,
        auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS! } },
    } } as const;
  }
  if (value.source !== "CUSTOM" || !value.host || !value.fromEmail || value.port < 1 || value.port > 65535
    || !["STARTTLS", "TLS", "NONE"].includes(value.tlsMode)) {
    return { config: null, reason: "SMTP_NOT_CONFIGURED" } as const;
  }
  let password = "";
  if (value.username) {
    if (!value.encryptedPassword) return { config: null, reason: "SMTP_PASSWORD_REQUIRED" } as const;
    try { password = decrypt(value.encryptedPassword); } catch {
      return { config: null, reason: "SMTP_PASSWORD_UNAVAILABLE" } as const;
    }
    if (!password) return { config: null, reason: "SMTP_PASSWORD_REQUIRED" } as const;
  }
  return { reason: null, config: {
    from: { name: value.fromName, address: value.fromEmail },
    options: { ...base, host: value.host, port: value.port,
      secure: value.tlsMode === "TLS", requireTLS: value.tlsMode === "STARTTLS", ignoreTLS: value.tlsMode === "NONE",
      auth: value.username ? { user: value.username, pass: password } : undefined },
  } } as const;
}

export function safeMailError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (["ENOTFOUND", "EAI_AGAIN", "EDNS"].includes(code)) return "SMTP server host DNS lookup failed";
  if (["ECONNREFUSED", "ECONNRESET", "ECONNECTION"].includes(code)) return "SMTP server connection refused";
  if (code === "ETIMEDOUT") return "SMTP connection timed out";
  if (code === "EAUTH") return "SMTP authentication failed";
  if (["ESOCKET", "ETLS"].includes(code)) return "SMTP socket error";
  return "SMTP operation failed";
}

export function validateMailTemplate(template: MailTemplateInput): string | null {
  if (!template.subject.trim() || template.subject.length > 200 || /[\r\n\u0000]/.test(template.subject)) {
    return "Subject must contain 1-200 characters without line breaks.";
  }
  if (!template.body.trim() || template.body.length > 20000 || template.body.includes("\u0000")) {
    return "Body must contain 1-20000 characters.";
  }
  if ((template.body.match(/\{\{content\}\}/g) ?? []).length !== 1) {
    return "Body must include {{content}} exactly once.";
  }
  for (const [value, allowed] of [
    [template.subject, ["subject", "recipient", "date"]],
    [template.body, ["subject", "recipient", "date", "content"]],
  ] as const) {
    const remaining = value.replace(/\{\{([^{}]+)\}\}/g, (token, key: string) => allowed.some((item) => item === key) ? "" : token);
    if (remaining.includes("{{") || remaining.includes("}}")) return "Unsupported or malformed template placeholder.";
  }
  return null;
}

function escapeMailHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function renderMailTemplate(template: MailTemplateInput | null, input: {
  subject: string; recipient: string; date: string; text?: string; html?: string;
}) {
  if (!template) return { subject: input.subject, text: input.text, html: input.html };
  const error = validateMailTemplate(template);
  if (error) throw new Error(error);
  const fields: Record<string, string> = { subject: input.subject, recipient: input.recipient, date: input.date };
  const subject = template.subject.replace(/\{\{(subject|recipient|date)\}\}/g, (_, key: string) => fields[key] ?? "")
    .replace(/[\r\n\u0000]/g, " ").slice(0, 998);
  const text = input.text === undefined ? undefined : template.body.replace(/\{\{(subject|recipient|date|content)\}\}/g,
    (_, key: string) => key === "content" ? input.text! : fields[key] ?? "");
  // Only the application's generated HTML can enter unescaped; template text is always plain text.
  const renderFragment = (value: string) => escapeMailHtml(value.replace(/\{\{(subject|recipient|date)\}\}/g,
    (_, key: string) => fields[key] ?? "")).replaceAll("\n", "<br>");
  const [before = "", after = ""] = template.body.split("{{content}}");
  const prefix = renderFragment(before);
  const suffix = renderFragment(after);
  const content = input.html ?? escapeMailHtml(input.text ?? "").replaceAll("\n", "<br>");
  const body = /(<body\b[^>]*>)([\s\S]*?)(<\/body>)/i;
  const html = body.test(content)
    ? content.replace(body, (_, open: string, inner: string, close: string) => `${open}${prefix}${inner}${suffix}${close}`)
    : `${prefix}${content}${suffix}`;
  return { subject, text, html };
}
