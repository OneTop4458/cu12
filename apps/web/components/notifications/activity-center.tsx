"use client";

import { useCallback, useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { NotificationCenter, type DashboardNotification } from "./notification-center";

type ActivityPayload = {
  activities: DashboardNotification[];
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

async function readActivity(url: string): Promise<DashboardNotification[]> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
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

export function ActivityCenter() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [historyNotifications, setHistoryNotifications] = useState<DashboardNotification[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [activeItem, setActiveItem] = useState<DashboardNotification | null>(null);

  const loadLatest = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const activities = await readActivity("/api/dashboard/activity?limit=80");
      setNotifications(activities);
    } catch (err) {
      if ((err as Error).message !== "Unauthorized") {
        setNotifications([]);
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const activities = await readActivity("/api/dashboard/activity?limit=100");
      setHistoryNotifications(activities);
    } catch (err) {
      if ((err as Error).message !== "Unauthorized") {
        setHistoryNotifications([]);
      }
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLatest(true);
  }, [loadLatest]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      void loadLatest(false);
      if (showHistory) void loadHistory();
    }
  }, [loadHistory, loadLatest, showHistory]);

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

  const clearAll = useCallback(async () => {
    if (clearing) return;
    setClearing(true);

    try {
      const response = await fetch("/api/dashboard/activity", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });

      if (!response.ok) {
        throw new Error("활동을 읽음 처리하지 못했습니다.");
      }
      await loadLatest(false);
      if (showHistory) void loadHistory();
    } catch {
      // A bulk read-marker failure should not close the activity center or clear local state.
    } finally {
      setClearing(false);
    }
  }, [clearing, loadHistory, loadLatest, showHistory]);

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
        onOpenChange={handleOpenChange}
        onRefresh={() => void (showHistory ? loadHistory() : loadLatest(true))}
        onToggleHistory={toggleHistory}
        onOpen={(item) => setActiveItem(item)}
        onMarkRead={(item) => void markRead(item)}
        onClearAll={() => void clearAll()}
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
