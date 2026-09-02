"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { NotificationCenter, type DashboardNotification } from "./notification-center";

type ActivityPayload = {
  activities: DashboardNotification[];
};

type ActivityCenterProps = {
  initialUnreadCount?: number;
};

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

async function readActivity(url: string, signal?: AbortSignal): Promise<DashboardNotification[]> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
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

  const payload = (await response.json()) as ActivityPayload;
  return Array.isArray(payload.activities) ? payload.activities : [];
}

export function ActivityCenter({ initialUnreadCount = 0 }: ActivityCenterProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [historyNotifications, setHistoryNotifications] = useState<DashboardNotification[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [activeItem, setActiveItem] = useState<DashboardNotification | null>(null);
  const [latestLoaded, setLatestLoaded] = useState(false);
  const latestRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const latestAbortRef = useRef<AbortController | null>(null);
  const historyAbortRef = useRef<AbortController | null>(null);

  const loadLatest = useCallback(async (showLoading = true) => {
    latestAbortRef.current?.abort();
    const controller = new AbortController();
    latestAbortRef.current = controller;
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    if (showLoading) setLoading(true);
    try {
      const activities = await readActivity("/api/dashboard/activity?limit=80", controller.signal);
      if (controller.signal.aborted || requestId !== latestRequestRef.current) return;
      setNotifications(activities);
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
      const activities = await readActivity("/api/dashboard/activity?limit=100", controller.signal);
      if (controller.signal.aborted || requestId !== historyRequestRef.current) return;
      setHistoryNotifications(activities);
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
    return () => {
      latestAbortRef.current?.abort();
      historyAbortRef.current?.abort();
    };
  }, []);

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
      await fetch("/api/dashboard/activity", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [{ kind: item.kind, id: item.sourceId, provider: item.provider }],
        }),
      });
      setNotifications((previous) =>
        previous.map((row) => (row.id === item.id ? { ...row, isUnread: false, needsAttention: false } : row)),
      );
      if (showHistory) void loadHistory();
    } catch {
      // A read marker failure should not block viewing the activity detail.
    }
  }, [loadHistory, showHistory]);

  const clearVisible = useCallback(async (ids: string[]) => {
    if (ids.length === 0 || clearing) return;
    setClearing(true);

    const targetIds = new Set(ids);
    const targetItems = notifications
      .filter((item) => targetIds.has(item.id) && item.kind && item.kind !== "SYSTEM" && item.provider && item.sourceId)
      .map((item) => ({ kind: item.kind!, id: item.sourceId!, provider: item.provider! }));

    try {
      if (targetItems.length > 0) {
        await fetch("/api/dashboard/activity", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: targetItems }),
        });
      }
      setNotifications((previous) =>
        previous.map((item) => (targetIds.has(item.id) ? { ...item, isUnread: false, needsAttention: false } : item)),
      );
      if (showHistory) void loadHistory();
    } finally {
      setClearing(false);
    }
  }, [clearing, loadHistory, notifications, showHistory]);

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
        unreadCount={latestLoaded ? undefined : Math.max(0, initialUnreadCount)}
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
