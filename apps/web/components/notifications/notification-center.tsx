"use client";

import { Bell } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { ScrollArea } from "../ui/scroll-area";

interface DashboardNotification {
  provider?: "CU12" | "CYBER_CAMPUS";
  id: string;
  courseTitle: string;
  message: string;
  occurredAt: string | null;
  createdAt: string;
  isUnread: boolean;
  isArchived?: boolean;
}

type NotificationCenterProps = {
  notifications: DashboardNotification[];
  historyNotifications: DashboardNotification[];
  showHistory: boolean;
  historyLoading?: boolean;
  onToggleHistory: () => void;
  onOpen: (item: DashboardNotification) => void;
  onMarkRead: (item: DashboardNotification) => void;
  onClearVisible?: (ids: string[]) => void;
  clearing?: boolean;
};

export function NotificationCenter({
  notifications,
  historyNotifications,
  showHistory,
  historyLoading = false,
  onToggleHistory,
  onOpen,
  onMarkRead,
  onClearVisible,
  clearing = false,
}: NotificationCenterProps) {
  const unreadCount = notifications.filter((item) => item.isUnread).length;
  const source = showHistory ? historyNotifications : notifications;
  const latest = [...source]
    .sort((a, b) => {
      const unreadDelta = Number(b.isUnread) - Number(a.isUnread);
      if (unreadDelta !== 0) return unreadDelta;
      return new Date(b.occurredAt ?? b.createdAt).getTime() - new Date(a.occurredAt ?? a.createdAt).getTime();
    })
    .slice(0, showHistory ? 20 : 8);

  function formatDate(value: string | null) {
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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className="notification-trigger" type="button" aria-label={`알림 ${unreadCount}건`} variant="outline" size="icon">
          <Bell size={17} />
          {unreadCount > 0 ? <Badge className="notification-badge">{unreadCount}</Badge> : null}
        </Button>
      </PopoverTrigger>
        <PopoverContent
          className="notification-panel"
          align="end"
          side="bottom"
          sideOffset={10}
          collisionPadding={8}
          avoidCollisions
        >
          <div className="notification-panel-head">
            <span className="notification-panel-head-copy">
              {showHistory ? `예전 알림 ${latest.length}건` : `알림 · 읽지 않음 ${unreadCount}건`}
            </span>
            <div className="notification-panel-actions">
              <Button
                type="button"
                className="notification-secondary-btn"
                onClick={onToggleHistory}
                disabled={historyLoading}
                variant="outline"
                size="sm"
              >
                {showHistory ? "최신 알림 보기" : "예전 알림 보기"}
              </Button>
              {!showHistory && onClearVisible && latest.length > 0 ? (
                <Button
                  type="button"
                  className="notification-clear-btn"
                  onClick={() => onClearVisible(latest.map((item) => item.id))}
                  disabled={clearing}
                  variant="destructive"
                  size="sm"
                >
                  {clearing ? "삭제 중..." : "현재 목록 삭제"}
                </Button>
              ) : null}
            </div>
          </div>
          <ScrollArea className="notification-panel-list">
            {historyLoading ? <p className="notification-empty">예전 알림을 불러오는 중...</p> : null}
            {latest.length === 0 ? (
              <p className="notification-empty">{showHistory ? "예전 알림이 없습니다." : "알림이 없습니다."}</p>
            ) : (
              latest.map((item) => (
                <Button
                  key={item.id}
                  className={`notification-list-item ${item.isUnread ? "unread" : ""} ${item.isArchived ? "archived" : ""}`}
                  onClick={() => {
                    onOpen(item);
                    if (item.isUnread) onMarkRead(item);
                  }}
                  type="button"
                  variant="ghost"
                >
                  <span className="notification-list-title">{item.courseTitle || "시스템 알림"}</span>
                  <span className="notification-list-message">{sanitizeMessage(item.message)}</span>
                  <span className="notification-list-time">{formatDate(item.occurredAt ?? item.createdAt)}</span>
                </Button>
              ))
            )}
          </ScrollArea>
        </PopoverContent>
    </Popover>
  );
}
