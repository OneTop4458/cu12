"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { UserMenu } from "../../../components/layout/user-menu";
import { ThemeToggle } from "../../../components/theme/theme-toggle";
import { readJsonBody, resolveClientResponseError } from "../../../src/lib/client-response";
import { formatSiteNoticeDisplayTargetLabel } from "@/lib/site-notice-display";

type RoleType = "ADMIN" | "USER";
type NoticeType = "BROADCAST" | "MAINTENANCE";
type NoticeDisplayTarget = "LOGIN" | "TOPBAR" | "BOTH";

interface AdminSiteNoticeClientProps {
  initialUser: {
    email: string;
    role: RoleType;
  };
}

interface SiteNotice {
  id: string;
  title: string;
  message: string;
  type: NoticeType;
  displayTarget: NoticeDisplayTarget;
  isActive: boolean;
  priority: number;
  visibleFrom: string | null;
  visibleTo: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SiteNoticeListPayload {
  siteNotices: SiteNotice[];
}

interface NoticeResponse {
  notice: SiteNotice;
  created?: boolean;
  updated?: boolean;
  deleted?: boolean;
  noticeId?: string;
}

interface ApiErrorPayload {
  error?: string;
  errorCode?: string;
}

type VisibilityStatus = "active" | "scheduled" | "expired" | "inactive";

const NOTICE_TYPE_OPTIONS: { value: NoticeType; label: string }[] = [
  { value: "BROADCAST", label: "전체 공지" },
  { value: "MAINTENANCE", label: "시스템 점검" },
];

const DISPLAY_TARGET_OPTIONS: { value: NoticeDisplayTarget; label: string }[] = [
  { value: "LOGIN", label: "로그인만" },
  { value: "TOPBAR", label: "상단만" },
  { value: "BOTH", label: "로그인+상단" },
];

function parseError(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const maybeError = (payload as ApiErrorPayload).error;
    if (typeof maybeError === "string" && maybeError.trim()) {
      return maybeError.trim();
    }
  }

  return "요청을 처리하는 중 알 수 없는 오류가 발생했습니다.";
}

function toDateTimeInput(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 16);
}

function toUtcIso(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function resolveVisibilityStatus(notice: SiteNotice, now: Date): VisibilityStatus {
  if (!notice.isActive) {
    return "inactive";
  }

  if (notice.visibleFrom) {
    const from = new Date(notice.visibleFrom);
    if (!Number.isNaN(from.getTime()) && now.getTime() < from.getTime()) {
      return "scheduled";
    }
  }

  if (notice.visibleTo) {
    const to = new Date(notice.visibleTo);
    if (!Number.isNaN(to.getTime()) && now.getTime() > to.getTime()) {
      return "expired";
    }
  }

  return "active";
}

function formatVisibilityStatus(status: VisibilityStatus): string {
  switch (status) {
    case "active":
      return "현재 노출";
    case "scheduled":
      return "예약";
    case "expired":
      return "만료";
    case "inactive":
    default:
      return "비활성";
  }
}

function formatVisibilityStatusClass(status: VisibilityStatus): string {
  switch (status) {
    case "active":
      return "status-active";
    case "scheduled":
      return "status-pending";
    case "expired":
      return "status-failed";
    case "inactive":
    default:
      return "status-failed";
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR");
}

function formatNoticeTypeLabel(type: NoticeType): string {
  return type === "MAINTENANCE" ? "시스템 점검" : "전체 공지";
}

export function SiteNoticesAdminClient({ initialUser }: AdminSiteNoticeClientProps) {
  const router = useRouter();

  const [notices, setNotices] = useState<SiteNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editingNotice, setEditingNotice] = useState<SiteNotice | null>(null);

  const [formNoticeType, setFormNoticeType] = useState<NoticeType>("BROADCAST");
  const [formDisplayTarget, setFormDisplayTarget] = useState<NoticeDisplayTarget>("BOTH");
  const [formTitle, setFormTitle] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [formPriority, setFormPriority] = useState(0);
  const [formIsActive, setFormIsActive] = useState(true);
  const [formVisibleFrom, setFormVisibleFrom] = useState("");
  const [formVisibleTo, setFormVisibleTo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [busyNoticeId, setBusyNoticeId] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);
  const hasNoticeDraft = useMemo(() => Boolean(formTitle.trim()), [formTitle]);
  const totalCount = notices.length;
  const activeCount = notices.filter((notice) => notice.isActive).length;
  const inactiveCount = notices.length - activeCount;
  const broadcastCount = notices.filter((notice) => notice.type === "BROADCAST").length;
  const maintenanceCount = notices.filter((notice) => notice.type === "MAINTENANCE").length;

  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, init);
    if (response.status === 401) {
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
      router.push("/login" as Route);
      throw new Error("Unauthorized");
    }

    let payload: (T & ApiErrorPayload) | null = null;
    try {
      payload = await readJsonBody<T & ApiErrorPayload>(response);
    } catch {
      throw new Error("Server returned an invalid response.");
    }

    if (!response.ok) {
      throw new Error(
        parseError(payload ?? { error: resolveClientResponseError(response, payload, "Request failed.") }),
      );
    }

    if (!payload) {
      throw new Error("Server returned an empty response.");
    }

    return payload;
  }, [router]);

  const loadNotices = useCallback(async (includeInactiveValue = includeInactive) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJson<SiteNoticeListPayload>(
        `/api/admin/site-notices?includeInactive=${includeInactiveValue ? "1" : "0"}`,
      );
      setNotices(Array.isArray(payload.siteNotices) ? payload.siteNotices : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "공지 목록을 불러오는 중 오류가 발생했습니다.");
      setNotices([]);
    } finally {
      setLoading(false);
    }
  }, [fetchJson, includeInactive]);

  useEffect(() => {
    void loadNotices();
  }, [loadNotices]);

  useEffect(() => {
    if (!message) return;
    toast.success(message, {
      duration: 2800,
      closeButton: true,
    });
    setMessage(null);
  }, [message]);

  const resetForm = useCallback(() => {
    setEditingNotice(null);
    setFormNoticeType("BROADCAST");
    setFormDisplayTarget("BOTH");
    setFormTitle("");
    setFormMessage("");
    setFormPriority(0);
    setFormIsActive(true);
    setFormVisibleFrom("");
    setFormVisibleTo("");
  }, []);

  const selectEditNotice = useCallback((notice: SiteNotice) => {
    setEditingNotice(notice);
    setFormNoticeType(notice.type);
    setFormDisplayTarget(notice.displayTarget);
    setFormTitle(notice.title);
    setFormMessage(notice.message);
    setFormPriority(notice.priority);
    setFormIsActive(notice.isActive);
    setFormVisibleFrom(toDateTimeInput(notice.visibleFrom));
    setFormVisibleTo(toDateTimeInput(notice.visibleTo));
    setMessage(`"${notice.title}" 공지를 편집합니다.`);
  }, []);

  const onSubmitNotice = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    if (!formTitle.trim()) {
      setError("제목을 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    const payload = {
      type: formNoticeType,
      title: formTitle.trim(),
      message: formMessage.trim(),
      displayTarget: formNoticeType === "MAINTENANCE" ? "TOPBAR" : formDisplayTarget,
      isActive: formIsActive,
      priority: formPriority,
      visibleFrom: toUtcIso(formVisibleFrom),
      visibleTo: toUtcIso(formVisibleTo),
    };

    try {
      if (editingNotice) {
        await fetchJson<NoticeResponse>(`/api/admin/site-notices/${editingNotice.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        setMessage("공지 내용을 수정했습니다.");
      } else {
        await fetchJson<NoticeResponse>("/api/admin/site-notices", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        setMessage("공지 항목을 생성했습니다.");
      }

      resetForm();
      await loadNotices(includeInactive);
    } catch (err) {
      setError(err instanceof Error ? err.message : "공지 저장에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }, [
    editingNotice,
    fetchJson,
    formDisplayTarget,
    formIsActive,
    formMessage,
    formNoticeType,
    formPriority,
    formTitle,
    formVisibleFrom,
    formVisibleTo,
    includeInactive,
    loadNotices,
    resetForm,
    submitting,
  ]);

  const toggleNoticeActive = useCallback((notice: SiteNotice) => {
    if (busyNoticeId) return;
    setBusyNoticeId(notice.id);
    const next = !notice.isActive;
    void (async () => {
      try {
        await fetchJson<NoticeResponse>(`/api/admin/site-notices/${notice.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isActive: next }),
        });
        setMessage(`공지 상태를 ${next ? "활성" : "비활성"}으로 변경했습니다.`);
        await loadNotices(includeInactive);
      } catch (err) {
        setError(err instanceof Error ? err.message : "공지 상태 변경에 실패했습니다.");
      } finally {
        setBusyNoticeId(null);
      }
    })();
  }, [busyNoticeId, fetchJson, includeInactive, loadNotices]);

  const deleteNotice = useCallback((notice: SiteNotice) => {
    if (busyNoticeId) return;
    if (!window.confirm(`"${notice.title}" 공지를 삭제할까요?`)) return;

    setBusyNoticeId(notice.id);
    void (async () => {
      try {
        await fetchJson<NoticeResponse>(`/api/admin/site-notices/${notice.id}`, {
          method: "DELETE",
        });
        setMessage("공지 항목을 삭제했습니다.");
        await loadNotices(includeInactive);
      } catch (err) {
        setError(err instanceof Error ? err.message : "공지 삭제에 실패했습니다.");
      } finally {
        setBusyNoticeId(null);
      }
    })();
  }, [busyNoticeId, fetchJson, includeInactive, loadNotices]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-brand">
            <div>
              <p className="brand-kicker">운영자 공지 페이지 설정</p>
              <h1>전체 공지 / 점검 관리</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="icon-btn" type="button" onClick={() => void loadNotices()} disabled={loading}>
              <RefreshCw size={16} />
            </button>
            <ThemeToggle />
            <Link className="ghost-btn" href={"/admin/operations" as Route}>
              작업 운영
            </Link>
            <Link className="ghost-btn" href={"/admin/system" as Route}>
              시스템 상태
            </Link>
            <button type="button" className="ghost-btn" onClick={() => router.push("/admin" as Route)}>
              <ChevronLeft size={16} />
              운영 홈
            </button>
            <UserMenu
              email={initialUser.email}
              role={initialUser.role}
              impersonating={false}
              onDashboard={() => router.push("/dashboard" as Route)}
              onGoAdmin={() => router.push("/admin" as Route)}
              onLogout={() => {
                void fetchJson("/api/auth/logout", { method: "POST" }).then(() => {
                  router.push("/login" as Route);
                  router.refresh();
                });
              }}
            />
          </div>
        </div>
      </header>

      <section className="admin-stats">
        <article className="admin-stat card">
          <h2>전체 공지</h2>
          <p className="metric">{totalCount}</p>
          <p className="muted">
            전체 {broadcastCount}건 / 점검 {maintenanceCount}건
          </p>
        </article>
        <article className="admin-stat card">
          <h2>활성 / 비활성</h2>
          <p className="metric">{activeCount} / {inactiveCount}</p>
          <p className="muted">활성 기준으로 즉시 노출되는 공지 수를 확인합니다.</p>
        </article>
        <article className="admin-stat card">
          <h2>노출 범위 보기</h2>
          <label className="check-field" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => {
                setIncludeInactive(event.target.checked);
                void loadNotices(event.target.checked);
              }}
            />
            <span>비활성 / 만료 공지도 함께 보기</span>
          </label>
        </article>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="card">
        <div className="table-toolbar">
          <h2>{editingNotice ? "공지 수정" : "새 공지 등록"}</h2>
          <button type="button" className="ghost-btn" onClick={resetForm} disabled={submitting}>
            <Plus size={14} />
            새로 작성
          </button>
        </div>

        <form className="form-grid top-gap" onSubmit={onSubmitNotice}>
          <label className="field">
            <span>공지 타입</span>
            <select
              value={formNoticeType}
              onChange={(event) => {
                const nextType = event.target.value as NoticeType;
                setFormNoticeType(nextType);
                if (nextType === "MAINTENANCE") {
                  setFormDisplayTarget("TOPBAR");
                }
              }}
            >
              {NOTICE_TYPE_OPTIONS.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>노출 위치</span>
            {formNoticeType === "BROADCAST" ? (
              <select
                value={formDisplayTarget}
                onChange={(event) => setFormDisplayTarget(event.target.value as NoticeDisplayTarget)}
              >
                {DISPLAY_TARGET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="pill-note">대시보드 상단 고정 노출</div>
            )}
          </label>

          <label className="field">
            <span>제목</span>
            <input
              value={formTitle}
              onChange={(event) => setFormTitle(event.target.value)}
              required
              maxLength={120}
              placeholder="공지 제목을 입력하세요"
            />
          </label>

          <label className="field">
            <span>우선순위</span>
            <input
              type="number"
              value={formPriority}
              onChange={(event) => setFormPriority(Number(event.target.value))}
              required
              min={-999}
              max={999}
            />
          </label>

          <label className="field">
            <span>활성 상태</span>
            <select
              value={formIsActive ? "true" : "false"}
              onChange={(event) => setFormIsActive(event.target.value === "true")}
            >
              <option value="true">활성</option>
              <option value="false">비활성</option>
            </select>
          </label>

          <label className="field">
            <span>시작 시각 (선택)</span>
            <input
              type="datetime-local"
              value={formVisibleFrom}
              onChange={(event) => setFormVisibleFrom(event.target.value)}
            />
          </label>

          <label className="field">
            <span>종료 시각 (선택)</span>
            <input
              type="datetime-local"
              value={formVisibleTo}
              onChange={(event) => setFormVisibleTo(event.target.value)}
            />
          </label>

          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>내용</span>
            <textarea
              value={formMessage}
              onChange={(event) => setFormMessage(event.target.value)}
              rows={8}
              maxLength={3000}
              placeholder="공지 내용을 입력하세요"
            />
          </label>

          <div className="align-end" style={{ gridColumn: "1 / -1" }}>
            <button className="btn-success" type="submit" disabled={submitting || !hasNoticeDraft}>
              {submitting ? <><Save size={16} /> 저장 중...</> : editingNotice ? "수정" : "등록"}
            </button>
            {editingNotice ? (
              <button type="button" className="ghost-btn" onClick={resetForm} disabled={submitting}>
                취소
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="card">
        <h2>공지 목록</h2>
        <div className="table-wrap mobile-card-table">
          <table>
            <thead>
              <tr>
                <th>타입</th>
                <th>제목</th>
                <th>노출 위치</th>
                <th>우선순위</th>
                <th>상태</th>
                <th>노출 시점</th>
                <th>시작</th>
                <th>종료</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9}>공지 목록을 불러오는 중...</td>
                </tr>
              ) : notices.length === 0 ? (
                <tr>
                  <td colSpan={9}>등록된 공지가 없습니다.</td>
                </tr>
              ) : (
                notices.map((notice) => {
                  const visibility = resolveVisibilityStatus(notice, now);

                  return (
                    <tr key={notice.id}>
                      <td data-label="Type">{formatNoticeTypeLabel(notice.type)}</td>
                      <td data-label="Title">{notice.title}</td>
                      <td data-label="Display Target">
                        {formatSiteNoticeDisplayTargetLabel(notice.type, notice.displayTarget)}
                      </td>
                      <td data-label="Priority">{notice.priority}</td>
                      <td data-label="Active">{notice.isActive ? "활성" : "비활성"}</td>
                      <td data-label="Visibility">
                        <span className={`status-chip ${formatVisibilityStatusClass(visibility)}`}>
                          {formatVisibilityStatus(visibility)}
                        </span>
                      </td>
                      <td data-label="Visible From">{formatDateTime(notice.visibleFrom)}</td>
                      <td data-label="Visible To">{formatDateTime(notice.visibleTo)}</td>
                      <td data-label="Actions">
                        <div className="action-row">
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => selectEditNotice(notice)}
                            disabled={busyNoticeId === notice.id}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => toggleNoticeActive(notice)}
                            disabled={busyNoticeId === notice.id}
                          >
                            {notice.isActive ? "비활성" : "활성"}
                          </button>
                          <button
                            type="button"
                            className="btn-danger"
                            onClick={() => deleteNotice(notice)}
                            disabled={busyNoticeId === notice.id}
                          >
                            {busyNoticeId === notice.id ? "삭제 중..." : <><Trash2 size={14} /> 삭제</>}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
