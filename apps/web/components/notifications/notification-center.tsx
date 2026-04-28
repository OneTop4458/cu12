"use client";

import { Bell } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { ScrollArea } from "../ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";

export interface DashboardNotification {
  provider?: "CU12" | "CYBER_CAMPUS";
  id: string;
  sourceId?: string;
  kind?: "NOTICE" | "NOTIFICATION" | "MESSAGE" | "SYSTEM";
  title?: string;
  courseTitle: string;
  message: string;
  occurredAt: string | null;
  createdAt: string;
  isUnread: boolean;
  isArchived?: boolean;
  needsAttention?: boolean;
}

type NotificationCenterProps = {
  notifications: DashboardNotification[];
  historyNotifications: DashboardNotification[];
  showHistory: boolean;
  open?: boolean;
  mode?: "popover" | "sheet";
  historyLoading?: boolean;
  loading?: boolean;
  onOpenChange?: (open: boolean) => void;
  onRefresh?: () => void;
  onToggleHistory: () => void;
  onOpen: (item: DashboardNotification) => void;
  onMarkRead: (item: DashboardNotification) => void;
  onClearAll?: () => void;
  clearing?: boolean;
};

export function NotificationCenter({
  notifications,
  historyNotifications,
  showHistory,
  open,
  mode = "popover",
  historyLoading = false,
  loading = false,
  onOpenChange,
  onRefresh,
  onToggleHistory,
  onOpen,
  onMarkRead,
  onClearAll,
  clearing = false,
}: NotificationCenterProps) {
  const unreadCount = notifications.filter((item) => item.needsAttention ?? item.isUnread).length;
  const clearableCount = notifications.filter((item) => item.kind !== "SYSTEM" && item.isUnread).length;
  const source = showHistory ? historyNotifications : notifications;
  const latest = [...source]
    .sort((a, b) => {
      const unreadDelta = Number(b.isUnread) - Number(a.isUnread);
      if (unreadDelta !== 0) return unreadDelta;
      return new Date(b.occurredAt ?? b.createdAt).getTime() - new Date(a.occurredAt ?? a.createdAt).getTime();
    })
    .slice(0, showHistory ? 20 : 8);
  const title = showHistory ? `지난 활동 ${latest.length}건` : `활동 · 주의 필요 ${unreadCount}건`;

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

  function renderPanel() {
    return (
      <>
        <div className="notification-panel-head">
          <span className="notification-panel-head-copy">{title}</span>
          <div className="notification-panel-actions">
            {onRefresh ? (
              <Button
                type="button"
                className="notification-secondary-btn"
                onClick={onRefresh}
                disabled={loading || historyLoading}
                variant="outline"
                size="sm"
              >
                새로고침
              </Button>
            ) : null}
            <Button
              type="button"
              className="notification-secondary-btn"
              onClick={onToggleHistory}
              disabled={historyLoading}
              variant="outline"
              size="sm"
            >
              {showHistory ? "최신 활동" : "지난 활동"}
            </Button>
            {!showHistory && onClearAll && clearableCount > 0 ? (
              <Button
                type="button"
                className="notification-clear-btn"
                onClick={onClearAll}
                disabled={clearing}
                variant="destructive"
                size="sm"
              >
                {clearing ? "정리 중..." : "모두 읽음"}
              </Button>
            ) : null}
          </div>
        </div>
        <ScrollArea className="notification-panel-list">
          {loading || historyLoading ? <p className="notification-empty">활동을 불러오는 중...</p> : null}
          {!loading && !historyLoading && latest.length === 0 ? (
            <p className="notification-empty">{showHistory ? "지난 활동이 없습니다." : "새 활동이 없습니다."}</p>
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
                <span className="notification-list-title">{item.title || item.courseTitle || "시스템 활동"}</span>
                <span className="notification-list-message">{sanitizeMessage(item.message)}</span>
                <span className="notification-list-time">{formatDate(item.occurredAt ?? item.createdAt)}</span>
              </Button>
            ))
          )}
        </ScrollArea>
      </>
    );
  }

  const trigger = (
    <Button className="notification-trigger" type="button" aria-label={`활동 ${unreadCount}건`} variant="outline" size="icon">
      <Bell size={17} />
      {unreadCount > 0 ? <Badge className="notification-badge">{unreadCount}</Badge> : null}
    </Button>
  );

  if (mode === "sheet") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="right" className="notification-sheet">
          <SheetHeader className="notification-sheet-head">
            <SheetTitle>활동 알림</SheetTitle>
            <SheetDescription>주의가 필요한 항목과 최근 활동을 확인합니다.</SheetDescription>
          </SheetHeader>
          <div className="notification-panel notification-panel-sheet">{renderPanel()}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="notification-panel"
        align="end"
        side="bottom"
        sideOffset={10}
        collisionPadding={8}
        avoidCollisions
      >
        {renderPanel()}
      </PopoverContent>
    </Popover>
  );
}
