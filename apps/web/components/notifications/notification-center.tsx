"use client";

import * as Popover from "@radix-ui/react-popover";
import { Bell } from "lucide-react";

interface DashboardNotification {
  id: string;
  courseTitle: string;
  message: string;
  occurredAt: string | null;
  createdAt: string;
  isUnread: boolean;
}

export function NotificationCenter({
  notifications,
  onOpen,
  onMarkRead,
}: {
  notifications: DashboardNotification[];
  onOpen: (item: DashboardNotification) => void;
  onMarkRead: (item: DashboardNotification) => void;
}) {
  const unreadCount = notifications.filter((item) => item.isUnread).length;
  const latest = [...notifications]
    .sort((a, b) => new Date(b.occurredAt ?? b.createdAt).getTime() - new Date(a.occurredAt ?? a.createdAt).getTime())
    .slice(0, 8);

  function formatDate(value: string | null) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("ko-KR");
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="notification-trigger" type="button" aria-label={`미확인 알림 ${unreadCount}건`}>
          <Bell size={17} />
          {unreadCount > 0 ? <span className="notification-badge">{unreadCount}</span> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="notification-panel" align="end" side="bottom" sideOffset={10}>
          <div className="notification-panel-head">
            <span>알림 센터</span>
            <span>{unreadCount}개 미확인</span>
          </div>
          <div className="notification-panel-list">
            {latest.length === 0 ? (
              <p className="notification-empty">표시할 알림이 없습니다.</p>
            ) : (
              latest.map((item) => (
                <button
                  key={item.id}
                  className={`notification-list-item ${item.isUnread ? "unread" : ""}`}
                  onClick={() => {
                    onOpen(item);
                    if (item.isUnread) {
                      onMarkRead(item);
                    }
                  }}
                  type="button"
                >
                  <span className="notification-list-title">{item.courseTitle || "시스템 알림"}</span>
                  <span className="notification-list-message">{item.message}</span>
                  <span className="notification-list-time">{formatDate(item.occurredAt ?? item.createdAt)}</span>
                </button>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
