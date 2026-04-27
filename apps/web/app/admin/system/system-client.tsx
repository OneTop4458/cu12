"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { readJsonBody, resolveClientResponseError } from "../../../src/lib/client-response";
import { ThemeToggle } from "../../../components/theme/theme-toggle";
import { UserMenu } from "../../../components/layout/user-menu";
import { AppMobileNav } from "../../../components/layout/app-mobile-nav";

type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
type NoticeType = "BROADCAST" | "MAINTENANCE";
type PolicyDocumentType = "PRIVACY_POLICY" | "TERMS_OF_SERVICE";

interface AdminSystemProps {
  initialUser: {
    email: string;
    role: "ADMIN" | "USER";
  };
  view?: "overview" | "policies";
}

interface ApiErrorPayload {
  error?: string;
}

interface WorkerHeartbeat {
  workerId: string;
  lastSeenAt: string;
}

interface WorkersPayload {
  workers: WorkerHeartbeat[];
  summary: {
    total: number;
    active: number;
    stale: number;
    staleMinutes: number;
    capturedAt: string;
    staleCutoff: string;
  };
}

interface AdminJobsPayload {
  pagination: {
    total: number;
  };
}

interface SiteNotice {
  id: string;
  title: string;
  message: string;
  type: NoticeType;
  isActive: boolean;
  priority: number;
  visibleFrom: string | null;
  visibleTo: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SiteNoticesPayload {
  siteNotices: SiteNotice[];
}

interface HealthPayload {
  ok: boolean;
}

interface PolicyDocumentPayload {
  id: string;
  type: PolicyDocumentType;
  title: string;
  version: number;
  content: string;
  templateContent: string;
  publishedContent: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PolicyHistoryPayload {
  type: PolicyDocumentType;
  title: string;
  documents: PolicyDocumentPayload[];
}

interface PolicyProfilePayload {
  companyName: string | null;
  supportEmail: string | null;
  companyAddress: string | null;
  dpoName: string | null;
  dpoTitle: string | null;
  dpoEmail: string | null;
  dpoPhone: string | null;
  jurisdictionCourt: string | null;
  effectiveDate: string | null;
  revisionDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface AdminPoliciesPayload {
  requiredTypes: PolicyDocumentType[];
  policies: PolicyDocumentPayload[];
  history: PolicyHistoryPayload[];
  profile: PolicyProfilePayload;
}

interface AdminPoliciesUpdatePayload extends AdminPoliciesPayload {
  updated: boolean;
  publishedChanges: Array<{
    type: PolicyDocumentType;
    title: string;
    currentVersion: number;
    previousVersion: number | null;
    currentPath: string;
    previousPath: string | null;
    diffPath: string | null;
  }>;
  mailQueue: {
    queued: number;
    skipped: number;
  };
}

interface AdminPolicyMailPayload {
  policyTypes: PolicyDocumentType[];
  publishedChanges: AdminPoliciesUpdatePayload["publishedChanges"];
  mailQueue: {
    queued: number;
    skipped: number;
  };
}

const JOB_STATUSES: JobStatus[] = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"];

const NOTICE_TYPE_LABEL: Record<NoticeType, string> = {
  BROADCAST: "전체 공지",
  MAINTENANCE: "점검 공지",
};

const POLICY_TYPE_LABEL: Record<PolicyDocumentType, string> = {
  PRIVACY_POLICY: "개인정보 처리 방침",
  TERMS_OF_SERVICE: "이용약관",
};

const POLICY_TYPES: PolicyDocumentType[] = ["PRIVACY_POLICY", "TERMS_OF_SERVICE"];

function parseError(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const maybeError = (payload as ApiErrorPayload).error;
    if (typeof maybeError === "string" && maybeError.trim()) {
      return maybeError.trim();
    }
  }
  return "요청 처리 중 오류가 발생했습니다.";
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR");
}

const EMPTY_COUNTS: Record<JobStatus, number> = {
  PENDING: 0,
  RUNNING: 0,
  SUCCEEDED: 0,
  FAILED: 0,
  CANCELED: 0,
};

function toPolicyMap(policies: PolicyDocumentPayload[]): Map<PolicyDocumentType, PolicyDocumentPayload> {
  return new Map(policies.map((policy) => [policy.type, policy]));
}

export function AdminSystemClient({ initialUser, view = "overview" }: AdminSystemProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [workers, setWorkers] = useState<WorkerHeartbeat[]>([]);
  const [workerSummary, setWorkerSummary] = useState<WorkersPayload["summary"] | null>(null);
  const [jobCounts, setJobCounts] = useState<Record<JobStatus, number>>(EMPTY_COUNTS);
  const [staleMinutes, setStaleMinutes] = useState(10);
  const [siteNotices, setSiteNotices] = useState<SiteNotice[]>([]);

  const [requiredPolicyTypes, setRequiredPolicyTypes] = useState<PolicyDocumentType[]>([]);
  const [policies, setPolicies] = useState<PolicyDocumentPayload[]>([]);
  const [policyHistory, setPolicyHistory] = useState<PolicyHistoryPayload[]>([]);
  const [privacyContent, setPrivacyContent] = useState("");
  const [privacyActive, setPrivacyActive] = useState(true);
  const [termsContent, setTermsContent] = useState("");
  const [termsActive, setTermsActive] = useState(true);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyMailSending, setPolicyMailSending] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policySavedAt, setPolicySavedAt] = useState<string | null>(null);
  const [policySaveSummary, setPolicySaveSummary] = useState<string | null>(null);
  const [policyMailSummary, setPolicyMailSummary] = useState<string | null>(null);
  const [profileCompanyName, setProfileCompanyName] = useState("");
  const [profileSupportEmail, setProfileSupportEmail] = useState("");
  const [profileCompanyAddress, setProfileCompanyAddress] = useState("");
  const [profileDpoName, setProfileDpoName] = useState("");
  const [profileDpoTitle, setProfileDpoTitle] = useState("");
  const [profileDpoEmail, setProfileDpoEmail] = useState("");
  const [profileDpoPhone, setProfileDpoPhone] = useState("");
  const [profileJurisdictionCourt, setProfileJurisdictionCourt] = useState("");
  const [profileEffectiveDate, setProfileEffectiveDate] = useState("");
  const [profileRevisionDate, setProfileRevisionDate] = useState("");

  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, init);
    let payload: T | ApiErrorPayload | null = null;
    try {
      payload = await readJsonBody<T | ApiErrorPayload>(response);
    } catch {
      throw new Error("Server returned an invalid response.");
    }
    if (!response.ok) {
      throw new Error(parseError(payload ?? { error: resolveClientResponseError(response, payload as ApiErrorPayload | null, "Request failed.") }));
    }
    if (!payload) {
      throw new Error("Server returned an empty response.");
    }
    return payload as T;
  }, []);

  const applyPolicies = useCallback((payload: AdminPoliciesPayload) => {
    const nextRequiredTypes = payload.requiredTypes ?? [];
    const nextPolicies = payload.policies ?? [];
    const profile = payload.profile;
    setRequiredPolicyTypes(nextRequiredTypes);
    setPolicies(nextPolicies);
    setPolicyHistory(payload.history ?? []);

    const byType = toPolicyMap(nextPolicies);
    const privacy = byType.get("PRIVACY_POLICY");
    const terms = byType.get("TERMS_OF_SERVICE");

    setPrivacyContent(privacy?.templateContent ?? privacy?.content ?? "");
    setPrivacyActive(privacy?.isActive ?? true);
    setTermsContent(terms?.templateContent ?? terms?.content ?? "");
    setTermsActive(terms?.isActive ?? true);

    setProfileCompanyName(profile?.companyName ?? "");
    setProfileSupportEmail(profile?.supportEmail ?? "");
    setProfileCompanyAddress(profile?.companyAddress ?? "");
    setProfileDpoName(profile?.dpoName ?? "");
    setProfileDpoTitle(profile?.dpoTitle ?? "");
    setProfileDpoEmail(profile?.dpoEmail ?? "");
    setProfileDpoPhone(profile?.dpoPhone ?? "");
    setProfileJurisdictionCourt(profile?.jurisdictionCourt ?? "");
    setProfileEffectiveDate(profile?.effectiveDate ?? "");
    setProfileRevisionDate(profile?.revisionDate ?? "");
  }, []);

  const fetchHealth = useCallback(async () => {
    const payload = await fetchJson<HealthPayload>("/api/health");
    setHealthOk(Boolean(payload.ok));
  }, [fetchJson]);

  const fetchWorkers = useCallback(async () => {
    const payload = await fetchJson<WorkersPayload>(
      `/api/admin/workers?staleMinutes=${Math.max(1, Math.trunc(staleMinutes))}`,
    );
    setWorkers(payload.workers ?? []);
    setWorkerSummary(payload.summary ?? null);
  }, [fetchJson, staleMinutes]);

  const fetchJobs = useCallback(async () => {
    const responses = await Promise.all(
      JOB_STATUSES.map((status) => fetchJson<AdminJobsPayload>(`/api/admin/jobs?status=${status}&limit=1`)),
    );

    const nextCounts = { ...EMPTY_COUNTS };
    responses.forEach((response, index) => {
      const status = JOB_STATUSES[index];
      if (status) {
        nextCounts[status] = response.pagination?.total ?? 0;
      }
    });
    setJobCounts(nextCounts);
  }, [fetchJson]);

  const fetchSiteNotices = useCallback(async () => {
    const payload = await fetchJson<SiteNoticesPayload>("/api/admin/site-notices?includeInactive=1");
    setSiteNotices(payload.siteNotices ?? []);
  }, [fetchJson]);

  const fetchPolicies = useCallback(async () => {
    const payload = await fetchJson<AdminPoliciesPayload>("/api/admin/policies");
    applyPolicies(payload);
  }, [applyPolicies, fetchJson]);

  const refreshAll = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      await Promise.all([fetchHealth(), fetchWorkers(), fetchJobs(), fetchSiteNotices(), fetchPolicies()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "시스템 상태를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchHealth, fetchJobs, fetchPolicies, fetchSiteNotices, fetchWorkers]);

  useEffect(() => {
    void refreshAll(false);
  }, [refreshAll]);

  const activeNotices = useMemo(() => siteNotices.filter((notice) => notice.isActive), [siteNotices]);
  const activeBroadcast = useMemo(
    () => activeNotices.filter((notice) => notice.type === "BROADCAST").length,
    [activeNotices],
  );
  const activeMaintenance = useMemo(
    () => activeNotices.filter((notice) => notice.type === "MAINTENANCE").length,
    [activeNotices],
  );
  const jobTotal = useMemo(() => Object.values(jobCounts).reduce((acc, value) => acc + value, 0), [jobCounts]);

  const sortedNotices = useMemo(() => {
    return [...siteNotices].sort((a, b) => {
      if (a.isActive !== b.isActive) {
        return a.isActive ? -1 : 1;
      }
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [siteNotices]);

  const policyByType = useMemo(() => toPolicyMap(policies), [policies]);
  const missingPolicyTypes = useMemo(() => {
    return requiredPolicyTypes.filter((type) => {
      const current = policyByType.get(type);
      return !current || !current.isActive || !current.content.trim();
    });
  }, [policyByType, requiredPolicyTypes]);
  const latestPolicyVersions = useMemo(() => {
    return POLICY_TYPES.map((type) => {
      const current = policyByType.get(type);
      return {
        type,
        title: POLICY_TYPE_LABEL[type],
        version: current?.version ?? 0,
        updatedAt: current?.updatedAt ?? null,
      };
    });
  }, [policyByType]);
  const hasMissingHistoricalVersions = useMemo(() => {
    return policyHistory.some((group) => {
      const current = policyByType.get(group.type);
      if (!current) return false;
      return current.version > group.documents.length;
    });
  }, [policyByType, policyHistory]);

  const handleSavePolicies = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (policySaving) return;

      if (!privacyContent.trim() || !termsContent.trim()) {
        setPolicyError("개인정보 처리 방침과 이용약관 내용을 모두 입력해 주세요.");
        return;
      }

      setPolicySaving(true);
      setPolicyError(null);
      setPolicyMailSummary(null);
      try {
        const payload = await fetchJson<AdminPoliciesUpdatePayload>("/api/admin/policies", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            policies: [
              {
                type: "PRIVACY_POLICY",
                content: privacyContent.trim(),
                isActive: privacyActive,
              },
              {
                type: "TERMS_OF_SERVICE",
                content: termsContent.trim(),
                isActive: termsActive,
              },
            ],
            profile: {
              companyName: profileCompanyName,
              supportEmail: profileSupportEmail,
              companyAddress: profileCompanyAddress,
              dpoName: profileDpoName,
              dpoTitle: profileDpoTitle,
              dpoEmail: profileDpoEmail,
              dpoPhone: profileDpoPhone,
              jurisdictionCourt: profileJurisdictionCourt,
              effectiveDate: profileEffectiveDate,
              revisionDate: profileRevisionDate,
            },
          }),
        });
        applyPolicies(payload);
        setPolicySavedAt(new Date().toISOString());
        setPolicySaveSummary(
          payload.publishedChanges.length > 0
            ? `버전 발행 ${payload.publishedChanges.length}건 / 메일 큐 ${payload.mailQueue.queued}건 / 스킵 ${payload.mailQueue.skipped}건`
            : "버전 발행 없이 설정만 저장되었습니다.",
        );
      } catch (err) {
        setPolicyError(err instanceof Error ? err.message : "약관 저장에 실패했습니다.");
      } finally {
        setPolicySaving(false);
      }
    },
    [
      applyPolicies,
      fetchJson,
      policySaving,
      privacyActive,
      privacyContent,
      termsActive,
      termsContent,
      profileCompanyName,
      profileSupportEmail,
      profileCompanyAddress,
      profileDpoName,
      profileDpoTitle,
      profileDpoEmail,
      profileDpoPhone,
      profileJurisdictionCourt,
      profileEffectiveDate,
      profileRevisionDate,
    ],
  );

  const handleResendPolicyMail = useCallback(async () => {
    if (policyMailSending) return;

    setPolicyMailSending(true);
    setPolicyError(null);
    try {
      const payload = await fetchJson<AdminPolicyMailPayload>("/api/admin/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          policyTypes: POLICY_TYPES,
        }),
      });
      setPolicyMailSummary(
        `약관 메일 재발송 큐 ${payload.mailQueue.queued}건 / 스킵 ${payload.mailQueue.skipped}건`,
      );
    } catch (err) {
      setPolicyError(err instanceof Error ? err.message : "약관 메일 재발송에 실패했습니다.");
    } finally {
      setPolicyMailSending(false);
    }
  }, [fetchJson, policyMailSending]);

  return (
    <main className="dashboard-main page-shell">
      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-brand">
            <img src="/brand/catholic/crest-mark.png" alt="Catholic University crest" loading="lazy" />
            <div>
              <p className="brand-kicker">Catholic University Automation</p>
              <h1>시스템 상태</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <AppMobileNav mode="admin" />
            <button
              className="icon-btn"
              type="button"
              onClick={() => void refreshAll(true)}
              disabled={loading || refreshing}
              title="새로고침"
            >
              <RefreshCw size={16} />
            </button>
            <Link className="ghost-btn" href="/admin/site-notices">
              공지/점검 설정
            </Link>
            <Link className="ghost-btn" href={"/admin/system/policies" as Route}>
              약관 관리
            </Link>
            <Link className="ghost-btn" href="/admin/operations">
              작업 운영
            </Link>
            <Link className="ghost-btn" href="/admin">
              관리자
            </Link>
            <ThemeToggle />
            <UserMenu
              email={initialUser.email}
              role={initialUser.role}
              impersonating={false}
              onDashboard={() => router.push("/dashboard")}
              onGoAdmin={() => router.push("/admin")}
              onLogout={() => {
                void fetch("/api/auth/logout", { method: "POST" }).then(() => {
                  router.push("/login");
                  router.refresh();
                });
              }}
            />
          </div>
        </div>
      </header>

      {loading ? <p className="muted">시스템 상태를 불러오는 중입니다...</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <section className="admin-stats">
        <article className="admin-stat card">
          <h2>헬스 체크</h2>
          <p className="metric">{healthOk === null ? "-" : healthOk ? "정상" : "비정상"}</p>
          <p className="muted">웹 서비스 상태</p>
        </article>
        <article className="admin-stat card">
          <h2>워커 상태</h2>
          <p className="metric">{workerSummary ? `${workerSummary.active}/${workerSummary.total}` : "0/0"}</p>
          <p className="muted">활성 / 전체</p>
        </article>
        <article className="admin-stat card">
          <h2>작업 수</h2>
          <p className="metric">{jobTotal}</p>
          <p className="muted">전체 작업 건수</p>
        </article>
        <article className="admin-stat card">
          <h2>활성 공지</h2>
          <p className="metric">{activeNotices.length}</p>
          <p className="muted">전체 {activeBroadcast} / 점검 {activeMaintenance}</p>
        </article>
      </section>

      <section className="card">
        <div className="button-row" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
          <Link className="ghost-btn" href="/admin/system">
            시스템 개요
          </Link>
          <Link className="ghost-btn" href={"/admin/system/policies" as Route}>
            약관 버전/고지 관리
          </Link>
          <Link className="ghost-btn" href="/admin/site-notices">
            공지/점검 관리
          </Link>
        </div>
      </section>

      {view === "overview" ? (
      <section className="card">
        <div className="table-toolbar">
          <h2>작업별 상태</h2>
          <span className="muted text-small">FAILED/CANCELED는 실패 또는 중단된 작업 수입니다.</span>
        </div>
        <div className="status-grid top-gap">
          {JOB_STATUSES.map((status) => (
            <article key={status} className="card admin-stat">
              <p className="muted">{status}</p>
              <p className="metric">{jobCounts[status] ?? 0}</p>
            </article>
          ))}
        </div>
      </section>
      ) : null}

      {view === "policies" ? (
      <section className="card">
        <div className="table-toolbar">
          <h2>개인정보 처리 방침/이용약관</h2>
          <span className="muted text-small">최초 로그인 전에 사용자가 필수 동의해야 하는 문서입니다.</span>
        </div>

        {missingPolicyTypes.length > 0 ? (
          <p className="error-text top-gap">
            필수 문서 미구성: {missingPolicyTypes.map((type) => POLICY_TYPE_LABEL[type]).join(", ")}
          </p>
        ) : null}
        {policyError ? <p className="error-text top-gap">{policyError}</p> : null}
        {!policyError && policySavedAt ? (
          <p className="ok-text top-gap">저장 완료: {formatDate(policySavedAt)}</p>
        ) : null}
        {!policyError && policySaveSummary ? (
          <p className="muted text-small top-gap">{policySaveSummary}</p>
        ) : null}
        {!policyError && policyMailSummary ? (
          <p className="muted text-small top-gap">{policyMailSummary}</p>
        ) : null}
        {hasMissingHistoricalVersions ? (
          <p className="error-text top-gap">
            일부 이전 약관 버전 데이터가 DB에 없습니다. 구조 개편 전 버전은 수동 복구 전까지 public 이력/비교 링크를 제공할 수 없습니다.
          </p>
        ) : null}

        <div className="status-grid top-gap">
          {latestPolicyVersions.map((policy) => (
            <article key={policy.type} className="card admin-stat">
              <p className="muted">{policy.title}</p>
              <p className="metric">v{policy.version}</p>
              <p className="muted">{formatDate(policy.updatedAt)}</p>
            </article>
          ))}
        </div>

        <section className="card top-gap">
          <h3>버전 이력</h3>
          <div className="button-row top-gap" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
            {policyHistory.flatMap((group) =>
              group.documents.map((document) => (
                <Link
                  key={document.id}
                  className="ghost-btn"
                  href={`${document.type === "PRIVACY_POLICY" ? "/privacy" : "/terms"}?version=${document.version}`}
                >
                  {group.title} v{document.version}
                </Link>
              )),
            )}
          </div>
        </section>

        <form className="form-grid top-gap" onSubmit={handleSavePolicies}>
          <article className="card" style={{ gridColumn: "1 / -1" }}>
            <h3>Policy Profile Variables</h3>
            <p className="muted text-small">
              These values are used to replace placeholders like <code>{"{{COMPANY_NAME}}"}</code> in policy templates.
            </p>
            <div className="form-grid top-gap">
              <label className="field">
                <span>Company Name</span>
                <input value={profileCompanyName} onChange={(event) => setProfileCompanyName(event.target.value)} />
              </label>
              <label className="field">
                <span>Support Email</span>
                <input value={profileSupportEmail} onChange={(event) => setProfileSupportEmail(event.target.value)} />
              </label>
              <label className="field">
                <span>Company Address</span>
                <input value={profileCompanyAddress} onChange={(event) => setProfileCompanyAddress(event.target.value)} />
              </label>
              <label className="field">
                <span>DPO Name</span>
                <input value={profileDpoName} onChange={(event) => setProfileDpoName(event.target.value)} />
              </label>
              <label className="field">
                <span>DPO Title</span>
                <input value={profileDpoTitle} onChange={(event) => setProfileDpoTitle(event.target.value)} />
              </label>
              <label className="field">
                <span>DPO Email</span>
                <input value={profileDpoEmail} onChange={(event) => setProfileDpoEmail(event.target.value)} />
              </label>
              <label className="field">
                <span>DPO Phone</span>
                <input value={profileDpoPhone} onChange={(event) => setProfileDpoPhone(event.target.value)} />
              </label>
              <label className="field">
                <span>Jurisdiction Court</span>
                <input
                  value={profileJurisdictionCourt}
                  onChange={(event) => setProfileJurisdictionCourt(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Effective Date</span>
                <input value={profileEffectiveDate} onChange={(event) => setProfileEffectiveDate(event.target.value)} />
              </label>
              <label className="field">
                <span>Revision Date</span>
                <input value={profileRevisionDate} onChange={(event) => setProfileRevisionDate(event.target.value)} />
              </label>
            </div>
          </article>

          <article className="card">
            <h3>{POLICY_TYPE_LABEL.PRIVACY_POLICY}</h3>
            <p className="muted text-small">
              현재 버전: v{policyByType.get("PRIVACY_POLICY")?.version ?? 0} | 마지막 수정: {" "}
              {formatDate(policyByType.get("PRIVACY_POLICY")?.updatedAt ?? null)}
            </p>
            <label className="field top-gap">
              <span>문서 내용</span>
              <textarea
                rows={10}
                value={privacyContent}
                onChange={(event) => setPrivacyContent(event.target.value)}
                placeholder="개인정보 처리 방침 내용을 입력하세요."
              />
            </label>
            <label className="check-field top-gap">
              <input
                type="checkbox"
                checked={privacyActive}
                onChange={(event) => setPrivacyActive(event.target.checked)}
              />
              <span>활성화 (로그인 시 동의 필수)</span>
            </label>
          </article>

          <article className="card">
            <h3>{POLICY_TYPE_LABEL.TERMS_OF_SERVICE}</h3>
            <p className="muted text-small">
              현재 버전: v{policyByType.get("TERMS_OF_SERVICE")?.version ?? 0} | 마지막 수정: {" "}
              {formatDate(policyByType.get("TERMS_OF_SERVICE")?.updatedAt ?? null)}
            </p>
            <label className="field top-gap">
              <span>문서 내용</span>
              <textarea
                rows={10}
                value={termsContent}
                onChange={(event) => setTermsContent(event.target.value)}
                placeholder="이용약관 내용을 입력하세요."
              />
            </label>
            <label className="check-field top-gap">
              <input
                type="checkbox"
                checked={termsActive}
                onChange={(event) => setTermsActive(event.target.checked)}
              />
              <span>활성화 (로그인 시 동의 필수)</span>
            </label>
          </article>

          <div className="button-row" style={{ gridColumn: "1 / -1" }}>
            <button className="btn-success" type="submit" disabled={policySaving}>
              {policySaving ? "저장 중..." : "약관 저장"}
            </button>
            <button className="ghost-btn" type="button" onClick={() => void handleResendPolicyMail()} disabled={policyMailSending}>
              {policyMailSending ? "메일 큐잉 중..." : "약관 메일 다시 발송"}
            </button>
          </div>
        </form>
      </section>
      ) : null}

      {view === "overview" ? (
      <section className="card">
        <div className="table-toolbar">
          <h2>워커 상태</h2>
          <label className="field">
            <span>비정상 판정 기준(분)</span>
            <input
              type="number"
              min={1}
              max={120}
              value={staleMinutes}
              onChange={(event) => setStaleMinutes(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
          <button
            type="button"
            className="btn-success"
            onClick={() => void refreshAll(true)}
            disabled={loading || refreshing}
          >
            {refreshing ? "갱신 중..." : "워커 다시 조회"}
          </button>
        </div>
        <div className="table-wrap top-gap mobile-card-table">
          <table>
            <thead>
              <tr>
                <th>Worker ID</th>
                <th>마지막 heartbeat</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {!workerSummary || workers.length === 0 ? (
                <tr>
                  <td colSpan={3}>등록된 워커가 없습니다.</td>
                </tr>
              ) : (
                workers.map((worker) => {
                  const isActive =
                    new Date(worker.lastSeenAt).getTime() >= new Date(workerSummary.staleCutoff).getTime();
                  return (
                    <tr key={worker.workerId}>
                      <td data-label="Worker ID">{worker.workerId}</td>
                      <td data-label="Last Heartbeat">{formatDate(worker.lastSeenAt)}</td>
                      <td data-label="Status">
                        <span className={`status-chip ${isActive ? "status-active" : "status-failed"}`}>
                          {isActive ? "정상" : "비정상"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

      {view === "overview" ? (
      <section className="card">
        <h2>현재 공지/점검 목록</h2>
        <div className="table-wrap top-gap mobile-card-table">
          <table>
            <thead>
              <tr>
                <th>유형</th>
                <th>제목</th>
                <th>우선순위</th>
                <th>상태</th>
                <th>시작</th>
                <th>종료</th>
              </tr>
            </thead>
            <tbody>
              {sortedNotices.length === 0 ? (
                <tr>
                  <td colSpan={6}>등록된 공지가 없습니다.</td>
                </tr>
              ) : (
                sortedNotices.slice(0, 30).map((notice) => (
                  <tr key={notice.id}>
                    <td data-label="Type">{NOTICE_TYPE_LABEL[notice.type]}</td>
                    <td data-label="Title">{notice.title}</td>
                    <td data-label="Priority">{notice.priority}</td>
                    <td data-label="Status">{notice.isActive ? "활성" : "비활성"}</td>
                    <td data-label="Visible From">{formatDate(notice.visibleFrom)}</td>
                    <td data-label="Visible To">{formatDate(notice.visibleTo)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}
    </main>
  );
}
