"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { NotificationCenter, type DashboardNotification } from "./notification-center";

type ActivityPayload = {
  activities: DashboardNotification[];
  attentionCount: number;
};

type AttentionCountPayload = {
  attentionCount: number;
};

const ACTIVITY_READ_ERROR = "읽음 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.";

function toDisplayTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR");
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/^(?:\s*\[[^\]]+\]\s*)?/, "")
    .replace(/\s*(아직|미확인|읽지않음|not-read|not_checked)\s*$/gi, "")
    .trim();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function readActivityJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (response.status === 401) {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!response.ok) {
    throw new Error("활동을 불러오지 못했습니다.");
  }

  return response.json() as Promise<T>;
}

async function readActivity(url: string, signal?: AbortSignal): Promise<ActivityPayload> {
  const payload = await readActivityJson<ActivityPayload>(url, signal);
  return {
    activities: Array.isArray(payload.activities) ? payload.activities : [],
    attentionCount: Number.isFinite(payload.attentionCount) ? Math.max(0, payload.attentionCount) : 0,
  };
}

async function readAttentionCount(signal?: AbortSignal): Promise<number> {
  const payload = await readActivityJson<AttentionCountPayload>("/api/dashboard/activity/attention-count", signal);
  return Number.isFinite(payload.attentionCount) ? Math.max(0, payload.attentionCount) : 0;
}

async function markActivityRead(body: unknown): Promise<void> {
  const response = await fetch("/api/dashboard/activity", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return;

  let message = ACTIVITY_READ_ERROR;
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === "string" && /[가-힣]/.test(payload.error)) {
      message = payload.error.trim();
    }
  } catch {
    // Keep the actionable fallback when the error response is not JSON.
  }
  throw new Error(message);
}

export function ActivityCenter() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [historyNotifications, setHistoryNotifications] = useState<DashboardNotification[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [activeItem, setActiveItem] = useState<DashboardNotification | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [latestLoaded, setLatestLoaded] = useState(false);
  const [attentionCount, setAttentionCount] = useState(0);
  const latestRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const countRequestRef = useRef(0);
  const latestAbortRef = useRef<AbortController | null>(null);
  const historyAbortRef = useRef<AbortController | null>(null);
  const countAbortRef = useRef<AbortController | null>(null);

  const loadAttentionCount = useCallback(async () => {
    countAbortRef.current?.abort();
    const controller = new AbortController();
    countAbortRef.current = controller;
    const requestId = countRequestRef.current + 1;
    countRequestRef.current = requestId;
    try {
      const nextCount = await readAttentionCount(controller.signal);
      if (controller.signal.aborted || requestId !== countRequestRef.current) return;
      setAttentionCount(nextCount);
    } catch (err) {
      if (!isAbortError(err) && (err as Error).message === "Unauthorized") return;
    } finally {
      if (!controller.signal.aborted && requestId === countRequestRef.current) {
        countAbortRef.current = null;
      }
    }
  }, []);

  const loadLatest = useCallback(async (showLoading = true) => {
    latestAbortRef.current?.abort();
    const controller = new AbortController();
    latestAbortRef.current = controller;
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    if (showLoading) setLoading(true);
    try {
      const payload = await readActivity("/api/dashboard/activity?limit=80", controller.signal);
      if (controller.signal.aborted || requestId !== latestRequestRef.current) return;
      setNotifications(payload.activities);
      setAttentionCount(payload.attentionCount);
      setLatestLoaded(true);
    } catch (err) {
      if (!isAbortError(err) && requestId === latestRequestRef.current && (err as Error).message !== "Unauthorized") {
        setNotifications([]);
      }
    } finally {
      if (!controller.signal.aborted && requestId === latestRequestRef.current) {
        setLoading(false);
        latestAbortRef.current = null;
      }
    }
  }, []);

  const loadHistory = useCallback(async () => {
    historyAbortRef.current?.abort();
    const controller = new AbortController();
    historyAbortRef.current = controller;
    const requestId = historyRequestRef.current + 1;
    historyRequestRef.current = requestId;
    setHistoryLoading(true);
    try {
      const payload = await readActivity("/api/dashboard/activity?limit=100", controller.signal);
      if (controller.signal.aborted || requestId !== historyRequestRef.current) return;
      setHistoryNotifications(payload.activities);
      setAttentionCount(payload.attentionCount);
    } catch (err) {
      if (!isAbortError(err) && requestId === historyRequestRef.current && (err as Error).message !== "Unauthorized") {
        setHistoryNotifications([]);
      }
    } finally {
      if (!controller.signal.aborted && requestId === historyRequestRef.current) {
        setHistoryLoading(false);
        historyAbortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    void loadAttentionCount();
    return () => {
      latestAbortRef.current?.abort();
      historyAbortRef.current?.abort();
      countAbortRef.current?.abort();
    };
  }, [loadAttentionCount]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      void loadLatest(!latestLoaded);
      if (showHistory) void loadHistory();
    }
  }, [latestLoaded, loadHistory, loadLatest, showHistory]);

  const toggleHistory = useCallback(() => {
    setShowHistory((previous) => {
      const next = !previous;
      if (next) void loadHistory();
      return next;
    });
  }, [loadHistory]);

  const markRead = useCallback(async (item: DashboardNotification) => {
    setActiveItem(item);
    if (!item.isUnread || !item.kind || !item.provider || !item.sourceId || item.kind === "SYSTEM") return;

    try {
      setActionError(null);
      await markActivityRead({
        items: [{ kind: item.kind, id: item.sourceId, provider: item.provider }],
      });
      setNotifications((previous) =>
        previous.map((row) => (row.id === item.id ? { ...row, isUnread: false, needsAttention: false } : row)),
      );
      setHistoryNotifications((previous) =>
        previous.map((row) => (row.id === item.id ? { ...row, isUnread: false, needsAttention: false } : row)),
      );
      await loadAttentionCount();
      if (showHistory) void loadHistory();
    } catch (error) {
      if (!isAbortError(error)) {
        setActionError(error instanceof Error ? error.message : ACTIVITY_READ_ERROR);
      }
    }
  }, [loadAttentionCount, loadHistory, showHistory]);

  const clearVisible = useCallback(async (ids: string[]) => {
    if (ids.length === 0 || clearing) return;
    setClearing(true);

    try {
      setActionError(null);
      await markActivityRead({ all: true });
      const targetIds = new Set(ids);
      setNotifications((previous) =>
        previous.map((item) => (targetIds.has(item.id) ? { ...item, isUnread: false, needsAttention: false } : item)),
      );
      setHistoryNotifications((previous) =>
        previous.map((item) => (targetIds.has(item.id) ? { ...item, isUnread: false, needsAttention: false } : item)),
      );
      await loadAttentionCount();
      await loadLatest(false);
      if (showHistory) void loadHistory();
    } catch (error) {
      if (!isAbortError(error)) {
        setActionError(error instanceof Error ? error.message : ACTIVITY_READ_ERROR);
      }
    } finally {
      setClearing(false);
    }
  }, [clearing, loadAttentionCount, loadHistory, loadLatest, showHistory]);

  return (
    <>
      <NotificationCenter
        notifications={notifications}
        historyNotifications={historyNotifications}
        showHistory={showHistory}
        mode={isMobile ? "sheet" : "popover"}
        open={open}
        loading={loading}
        historyLoading={historyLoading}
        unreadCount={attentionCount}
        actionError={actionError}
        onOpenChange={handleOpenChange}
        onRefresh={() => void (showHistory ? loadHistory() : loadLatest(true))}
        onToggleHistory={toggleHistory}
        onOpen={(item) => setActiveItem(item)}
        onMarkRead={(item) => void markRead(item)}
        onClearVisible={(ids) => void clearVisible(ids)}
        clearing={clearing}
      />

      {activeItem ? (
        <div className="modal-overlay" onClick={() => setActiveItem(null)}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h2>{activeItem.title || activeItem.courseTitle || "활동"}</h2>
            <p className="muted">{toDisplayTime(activeItem.occurredAt ?? activeItem.createdAt)}</p>
            <p>{sanitizeMessage(activeItem.message)}</p>
            <button className="ghost-btn" type="button" onClick={() => setActiveItem(null)}>
              닫기
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
