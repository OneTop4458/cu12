"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { DEFAULT_MAIL_SETTINGS, MAIL_TEMPLATE_KINDS, publicMailSettings, renderMailTemplate, validateMailTemplate, type MailTemplateKind } from "@cu12/core";
import { AppTopbar } from "../../../components/layout/app-topbar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../../components/ui/dialog";
import styles from "./mail.module.css";

type SettingsView = ReturnType<typeof publicMailSettings>;
interface SettingsPayload { settings: SettingsView; environmentConfigured: boolean }
interface TemplateView { kind: MailTemplateKind; subject: string; body: string; customized: boolean; updatedAt: string | null }
interface Props { initialUser: { email: string; role: "ADMIN" | "USER" } }

const TEMPLATE_LABELS: Record<MailTemplateKind, string> = {
  DEADLINE: "차시 마감 임박", AUTOLEARN_RESULT: "자동 수강 결과", AUTOLEARN_TERMINAL: "자동 수강 종료",
  POLICY_UPDATE: "약관 변경 안내", ADMIN_APPROVAL_REQUEST: "관리자 승인 요청", TEST: "테스트 메일",
};
const SAMPLE_CONTENT: Record<MailTemplateKind, string> = {
  DEADLINE: "예시 강좌의 2주차 1차시가 1일 뒤 마감됩니다.\n실제 메일에는 마감 일시와 확인 링크가 포함됩니다.",
  AUTOLEARN_RESULT: "자동 수강 결과: 3개 차시 처리 완료.\n실제 메일에는 진행 결과와 남은 학습 정보가 포함됩니다.",
  AUTOLEARN_TERMINAL: "자동 수강 작업이 종료되었습니다.\n실제 메일에는 성공·실패·취소 상태와 필요한 후속 안내가 포함됩니다.",
  POLICY_UPDATE: "이용약관이 변경되었습니다.\n실제 메일에는 새 버전과 이전 버전 비교 링크가 포함됩니다.",
  ADMIN_APPROVAL_REQUEST: "새 회원이 관리자 승인을 요청했습니다.\n실제 메일에는 승인 요청 계정과 관리 화면 링크가 포함됩니다.",
  TEST: "CU12 관리자 메일 설정에서 요청한 테스트 메일입니다.",
};

function errorText(reason: string | undefined) {
  const messages: Record<string, string> = {
    MAIL_DISABLED: "전체 메일 발송이 꺼져 있습니다. 설정을 켜고 저장해 주세요.",
    SMTP_NOT_CONFIGURED: "SMTP 설정이 완성되지 않았습니다. 서버와 발신자 설정을 확인해 주세요.",
    SMTP_PASSWORD_REQUIRED: "SMTP 인증 비밀번호를 입력하고 저장해 주세요.",
    SMTP_PASSWORD_UNAVAILABLE: "저장된 SMTP 비밀번호를 사용할 수 없습니다. 다시 입력해 주세요.",
    "SMTP authentication failed": "SMTP 인증에 실패했습니다. 계정과 비밀번호를 확인해 주세요.",
    "SMTP connection timed out": "SMTP 서버 연결 시간이 초과되었습니다.",
    "SMTP server host DNS lookup failed": "SMTP 서버 주소를 확인할 수 없습니다.",
    "SMTP server connection refused": "SMTP 서버에 연결할 수 없습니다. 주소와 포트를 확인해 주세요.",
    "SMTP socket error": "SMTP 연결 또는 TLS 설정을 확인해 주세요.",
    "SMTP operation failed": "메일 작업에 실패했습니다. 저장된 설정과 서버 상태를 확인해 주세요.",
    "An enabled SMTP username requires a password.": "SMTP 인증을 사용하려면 비밀번호를 입력해야 합니다.",
    "Custom SMTP requires a host and sender email.": "SMTP 서버 주소와 발신 이메일을 입력해 주세요.",
    "Re-enter or clear the password when changing the SMTP host or username.": "서버 주소나 인증 계정을 바꾸면 비밀번호를 다시 입력하거나 삭제해야 합니다.",
    "Re-enter the SMTP password.": "SMTP 비밀번호를 다시 입력해 주세요.",
  };
  return messages[reason ?? ""] ?? "요청을 처리하지 못했습니다. 입력값과 연결 상태를 확인한 뒤 다시 시도해 주세요.";
}

export function AdminMailClient({ initialUser }: Props) {
  const router = useRouter();
  const [saved, setSaved] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<SettingsView>(publicMailSettings(DEFAULT_MAIL_SETTINGS));
  const [environmentConfigured, setEnvironmentConfigured] = useState(false);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [templateDrafts, setTemplateDrafts] = useState<TemplateView[]>([]);
  const [kind, setKind] = useState<MailTemplateKind>("DEADLINE");
  const [testRecipient, setTestRecipient] = useState("");
  const [busy, setBusy] = useState<string | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const kindSelectRef = useRef<HTMLSelectElement>(null);
  const template = templateDrafts.find((item) => item.kind === kind);
  const settingsDirty = JSON.stringify(saved) !== JSON.stringify(draft) || Boolean(password || clearPassword);
  const templateDirty = JSON.stringify(template) !== JSON.stringify(templates.find((item) => item.kind === kind));
  const templateError = template ? validateMailTemplate(template) : null;
  const preview = template && !templateError ? renderMailTemplate(template, {
    subject: `[CU12] ${TEMPLATE_LABELS[kind]}`, recipient: "member@example.test", date: "2026. 1. 1. 오전 9:00 (KST)", text: SAMPLE_CONTENT[kind],
  }) : null;

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json" } });
    if (response.status === 401 || response.status === 403) {
      router.refresh();
      throw new Error("관리자 로그인 상태를 확인한 뒤 다시 시도해 주세요.");
    }
    const data = await response.json() as T & { error?: string; reason?: string };
    if (!response.ok) throw new Error(errorText(data.reason ?? data.error));
    return data;
  }, [router]);

  const load = useCallback(async () => {
    setBusy("load"); setError(null);
    try {
      const [settings, items] = await Promise.all([
        request<SettingsPayload>("/api/admin/mail/settings"), request<{ templates: TemplateView[] }>("/api/admin/mail/templates"),
      ]);
      setSaved(settings.settings); setDraft(settings.settings); setEnvironmentConfigured(settings.environmentConfigured);
      setTemplates(items.templates); setTemplateDrafts(items.templates); setPassword(""); setClearPassword(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "메일 설정을 불러오지 못했습니다."); }
    finally { setBusy(null); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);

  async function saveSettings(event: FormEvent) {
    event.preventDefault(); setBusy("settings"); setError(null); setMessage(null);
    try {
      const { passwordConfigured: _passwordConfigured, ...settings } = draft;
      const result = await request<SettingsPayload>("/api/admin/mail/settings", { method: "PATCH", body: JSON.stringify({ ...settings, password, clearPassword }) });
      setSaved(result.settings); setDraft(result.settings); setEnvironmentConfigured(result.environmentConfigured);
      setPassword(""); setClearPassword(false); setMessage("메일 서버 설정을 저장했습니다. 이후 발송부터 적용됩니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "메일 설정 저장에 실패했습니다."); }
    finally { setBusy(null); }
  }

  async function runMailAction(action: "verify" | "test") {
    setBusy(action); setError(null); setMessage(null);
    try {
      await request(`/api/admin/mail/${action}`, { method: "POST", body: JSON.stringify(action === "test" ? { to: testRecipient } : {}) });
      setMessage(action === "verify" ? "SMTP 연결과 인증을 확인했습니다. 메일은 발송하지 않았습니다." : `${testRecipient} 주소로 테스트 메일을 발송했습니다.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "메일 작업에 실패했습니다."); }
    finally { setBusy(null); }
  }

  async function saveTemplate(reset = false) {
    if (!template) return;
    setBusy("template"); setError(null); setMessage(null);
    try {
      const result = await request<TemplateView>(`/api/admin/mail/templates/${kind}`, {
        method: reset ? "DELETE" : "PUT", ...(reset ? {} : { body: JSON.stringify({ subject: template.subject, body: template.body }) }),
      });
      setTemplates((items) => items.map((item) => item.kind === kind ? result : item));
      setTemplateDrafts((items) => items.map((item) => item.kind === kind ? result : item));
      setResetOpen(false); setMessage(reset ? "기본 메일 템플릿으로 복원했습니다." : "메일 템플릿을 저장했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "템플릿 저장에 실패했습니다."); }
    finally { setBusy(null); }
  }

  const editTemplate = (field: "subject" | "body", value: string) => setTemplateDrafts((items) => items.map((item) => item.kind === kind ? { ...item, [field]: value } : item));
  const custom = draft.source === "CUSTOM";

  return <>
    <AppTopbar title="메일 관리" email={initialUser.email} role={initialUser.role} showAdminNav
      onDashboard={() => router.push("/dashboard" as Route)} onLogout={async () => {
        await fetch("/api/auth/logout", { method: "POST" }); router.push("/login" as Route);
      }} />
    <section className="card"><h2>메일 서버와 공통 템플릿</h2><p className="muted">전체 발송 설정을 관리합니다. 회원별 수신 여부와 알림 종류는 회원 상세에서 수정할 수 있습니다.</p></section>
    {error ? <p className="error-text" role="alert">{error}</p> : null}
    {message ? <p className={styles.message} role="status">{message}</p> : null}
    {busy === "load" ? <p role="status">메일 설정을 불러오는 중입니다.</p> : null}
    {!saved && busy !== "load" ? <button type="button" onClick={() => void load()}>다시 불러오기</button> : null}
    {saved ? <>
      <section className={`card ${styles.section}`} aria-labelledby="mail-server-title">
        <h2 id="mail-server-title">발송 서버 설정</h2>
        <form onSubmit={saveSettings} className={styles.stack}>
          <fieldset disabled={Boolean(busy)} className={styles.stack}>
          <label className="check-field"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span>전체 메일 발송 사용</span></label>
          <p className="muted text-small">끄면 자동 알림과 테스트 메일 발송이 모두 중지됩니다.</p>
          <label className="field"><span>설정 방식</span><select value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })}>
            <option value="ENV">운영 환경 설정 사용</option><option value="CUSTOM">관리자 SMTP 설정 사용</option>
          </select></label>
          {!custom ? <p className="pill-note">운영 환경 SMTP 설정: {environmentConfigured ? "구성됨" : "미구성"}. 웹과 워커에 설정된 기존 서버·발신자 정보를 사용합니다.</p> : null}
          {custom ? <div className={styles.fields}>
            <label className="field"><span>SMTP 서버 주소</span><input value={draft.host} required maxLength={200} placeholder="smtp.example.com" onChange={(event) => setDraft({ ...draft, host: event.target.value })} /></label>
            <label className="field"><span>포트</span><input type="number" min={1} max={65535} required value={draft.port} onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) })} /></label>
            <label className="field"><span>연결 보안</span><select value={draft.tlsMode} onChange={(event) => setDraft({ ...draft, tlsMode: event.target.value })}>
              <option value="STARTTLS">STARTTLS (일반적으로 587)</option><option value="TLS">TLS (일반적으로 465)</option><option value="NONE">암호화 없음</option>
            </select></label>
            <label className="field"><span>SMTP 인증 계정 (선택)</span><input value={draft.username} maxLength={200} autoComplete="off" onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></label>
            <label className="field"><span>SMTP 비밀번호</span><input type="password" value={password} disabled={clearPassword} maxLength={2000} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} />
              <small>저장 상태: {draft.passwordConfigured ? "설정됨" : "없음"}. 비워 두면 기존 비밀번호를 유지합니다. 서버나 인증 계정을 바꾸면 다시 입력해 주세요.</small></label>
            <label className="check-field"><input type="checkbox" checked={clearPassword} onChange={(event) => { setClearPassword(event.target.checked); if (event.target.checked) setPassword(""); }} /><span>저장된 SMTP 비밀번호 삭제</span></label>
            <label className="field"><span>발신 이메일</span><input type="email" required maxLength={200} value={draft.fromEmail} onChange={(event) => setDraft({ ...draft, fromEmail: event.target.value })} /></label>
            <label className="field"><span>발신자 이름 (선택)</span><input maxLength={200} value={draft.fromName} onChange={(event) => setDraft({ ...draft, fromName: event.target.value })} /></label>
          </div> : null}
          <div className={styles.actions}><button type="submit" disabled={Boolean(busy) || !settingsDirty}>{busy === "settings" ? "저장 중..." : "서버 설정 저장"}</button>
            <span className="muted text-small">{settingsDirty ? "저장하지 않은 변경 사항이 있습니다." : "저장된 설정입니다."}</span></div>
          </fieldset>
        </form>
      </section>
      <section className={`card ${styles.section}`} aria-labelledby="mail-test-title">
        <h2 id="mail-test-title">연결 확인과 테스트 발송</h2><p className="muted">저장된 설정으로 실행됩니다. 연결 확인은 인증까지만 검사하며, 실제 수신 가능 여부는 테스트 메일로 확인할 수 있습니다.</p>
        <div className={styles.actions}><button type="button" className="ghost-btn" disabled={Boolean(busy) || settingsDirty || !saved.enabled} onClick={() => void runMailAction("verify")}>{busy === "verify" ? "연결 확인 중..." : "SMTP 연결 확인"}</button></div>
        <form className={styles.testForm} onSubmit={(event) => { event.preventDefault(); void runMailAction("test"); }}>
          <label className="field"><span>테스트 수신 이메일</span><input type="email" required maxLength={200} value={testRecipient} onChange={(event) => setTestRecipient(event.target.value)} placeholder="수신할 주소를 직접 입력하세요" /></label>
          <button type="submit" disabled={Boolean(busy) || settingsDirty || !saved.enabled}>{busy === "test" ? "발송 중..." : "테스트 메일 발송"}</button>
        </form><p className="muted text-small">테스트 발송은 입력한 주소로 실제 메일을 보냅니다. 아래의 저장된 테스트 메일 템플릿을 사용합니다.</p>
      </section>
      <section className={`card ${styles.section}`} aria-labelledby="mail-template-title">
        <h2 id="mail-template-title">공통 메일 템플릿</h2>
        <label className="field"><span>메일 종류</span><select ref={kindSelectRef} value={kind} disabled={busy === "template"} onChange={(event) => setKind(event.target.value as MailTemplateKind)}>
          {MAIL_TEMPLATE_KINDS.map((value) => <option key={value} value={value}>{TEMPLATE_LABELS[value]}</option>)}
        </select></label>
        <p className="muted text-small">제목·수신자·시각은 각각 {"{{subject}}, {{recipient}}, {{date}}"}로 넣습니다. 본문에는 {"{{content}}"}를 정확히 한 번 넣어야 합니다. 기존 알림의 상세 내용과 링크는 이 자리에 유지됩니다.</p>
        {template ? <div className={styles.editor}>
          <form className={styles.stack} onSubmit={(event) => { event.preventDefault(); void saveTemplate(); }}>
            <fieldset disabled={Boolean(busy)} className={styles.stack}>
            <label className="field"><span>제목</span><input value={template.subject} maxLength={200} required onChange={(event) => editTemplate("subject", event.target.value)} /></label>
            <label className="field"><span>본문 (일반 텍스트)</span><textarea value={template.body} rows={10} maxLength={20000} required onChange={(event) => editTemplate("body", event.target.value)} /></label>
            {templateError ? <p className="error-text" role="alert">제목과 본문을 확인해 주세요. 지원되는 치환값만 사용하고 본문에 {"{{content}}"}를 한 번 넣어야 합니다.</p> : null}
            <div className={styles.actions}><button type="submit" disabled={Boolean(busy) || Boolean(templateError) || !templateDirty}>{busy === "template" ? "저장 중..." : "템플릿 저장"}</button>
              <button ref={resetTriggerRef} type="button" className="ghost-btn" disabled={Boolean(busy) || (!template.customized && !templateDirty)} onClick={() => setResetOpen(true)}>기본값 복원</button></div>
            <p className="muted text-small">{templateDirty ? "저장하지 않은 템플릿 변경 사항이 있습니다." : template.customized ? "사용자 지정 템플릿을 사용 중입니다." : "기존 기본 메일 내용을 사용 중입니다."}</p>
            </fieldset>
          </form>
          <section className={styles.preview} aria-label="메일 미리보기"><h3>미리보기</h3><p className="muted text-small">예시 데이터입니다. 미리보기로 메일이 발송되지는 않습니다. 실제 알림의 표와 링크는 기존 형식을 유지합니다.</p>
            {preview ? <><p><strong>{preview.subject}</strong></p><pre>{preview.text}</pre></> : <p className="muted">올바른 템플릿을 입력하면 미리보기가 표시됩니다.</p>}</section>
        </div> : null}
      </section>
    </> : null}
    <Dialog open={resetOpen} onOpenChange={(open) => { if (!busy) setResetOpen(open); }}><DialogContent className={styles.resetDialog} showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); if (resetTriggerRef.current && !resetTriggerRef.current.disabled) resetTriggerRef.current.focus(); else kindSelectRef.current?.focus(); }}><DialogHeader><DialogTitle>기본 템플릿 복원</DialogTitle><DialogDescription>{TEMPLATE_LABELS[kind]} 메일을 기존 기본 내용으로 되돌립니다. 작성 중인 변경 사항도 사라집니다.</DialogDescription></DialogHeader>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      <div className={styles.actions}><button type="button" className="ghost-btn" disabled={Boolean(busy)} onClick={() => setResetOpen(false)}>취소</button><button type="button" disabled={Boolean(busy)} onClick={() => void saveTemplate(true)}>기본값 복원</button></div>
    </DialogContent></Dialog>
  </>;
}
