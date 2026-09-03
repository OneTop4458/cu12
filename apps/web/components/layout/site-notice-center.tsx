"use client";

import { AlertTriangle, Megaphone, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { selectHighestPrioritySiteNotice } from "@/lib/site-notice-display";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";

type SiteNotice = {
  id: string;
  title: string;
  message: string;
  type: "BROADCAST" | "MAINTENANCE";
  isActive: boolean;
  priority: number;
};

type SiteNoticePayload = {
  siteNotices: SiteNotice[];
};

const DISMISSED_NOTICE_KEY = "cu12:topbar-dismissed-notice-ids:v1";
const TOPBAR_NOTICE_TITLE = "\uC0C1\uB2E8 \uACF5\uC9C0";
const TOPBAR_NOTICE_DESCRIPTION = "\uC11C\uBE44\uC2A4 \uACF5\uC9C0\uC640 \uC810\uAC80 \uC548\uB0B4\uB97C \uD655\uC778\uD569\uB2C8\uB2E4.";
const NOTICE_LOAD_ERROR = "\uACF5\uC9C0 \uC815\uBCF4\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
const NOTICE_LOADING = "\uACF5\uC9C0\uB97C \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4.";
const NOTICE_EMPTY = "\uD604\uC7AC \uC0C1\uB2E8 \uACF5\uC9C0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.";
const NOTICE_EMPTY_MESSAGE = "\uACF5\uC9C0 \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.";
const NOTICE_REFRESH = "\uC0C8\uB85C\uACE0\uCE68";
const NOTICE_CLOSE = "\uB2EB\uAE30";
const NOTICE_DETAILS = "\uC790\uC138\uD788";
const NOTICE_ARCHIVE = "\uC804\uCCB4 \uACF5\uC9C0";
const NOTICE_BANNER_LABEL = "\uC11C\uBE44\uC2A4 \uACF5\uC9C0";
const MAINTENANCE_LABEL = "\uC810\uAC80";
const BROADCAST_LABEL = "\uACF5\uC9C0";
const COUNT_UNIT = "\uAC74";

function readDismissedNoticeIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(DISMISSED_NOTICE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0));
  } catch {
    return new Set();
  }
}

function writeDismissedNoticeIds(ids: Set<string>) {
  try {
    window.sessionStorage.setItem(DISMISSED_NOTICE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Session-only dismiss state is best effort.
  }
}

function getNoticeTypeLabel(type: SiteNotice["type"]) {
  return type === "MAINTENANCE" ? MAINTENANCE_LABEL : BROADCAST_LABEL;
}

async function fetchTopbarNotices(): Promise<SiteNotice[]> {
  const response = await fetch("/api/site-notices?surface=TOPBAR", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(NOTICE_LOAD_ERROR);
  }
  const payload = (await response.json()) as SiteNoticePayload;
  return Array.isArray(payload.siteNotices) ? payload.siteNotices : [];
}

export function SiteNoticeCenter() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState<SiteNotice[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNotices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setNotices(await fetchTopbarNotices());
    } catch (err) {
      setNotices([]);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setDismissedIds(readDismissedNoticeIds());
    void loadNotices();
  }, [loadNotices]);

  const visibleNotices = useMemo(
    () => notices.filter((notice) => notice.type === "MAINTENANCE" || !dismissedIds.has(notice.id)),
    [dismissedIds, notices],
  );
  const maintenanceCount = visibleNotices.filter((notice) => notice.type === "MAINTENANCE").length;

  const dismissNotice = useCallback((noticeId: string) => {
    setDismissedIds((previous) => {
      const next = new Set(previous);
      next.add(noticeId);
      writeDismissedNoticeIds(next);
      return next;
    });
  }, []);

  const maintenanceNotices = visibleNotices.filter((notice) => notice.type === "MAINTENANCE");
  const primaryNotice = selectHighestPrioritySiteNotice(
    maintenanceNotices.length > 0 ? maintenanceNotices : visibleNotices,
  );
  const archiveLabel = visibleNotices.length > 0 ? `${NOTICE_ARCHIVE} ${visibleNotices.length}${COUNT_UNIT}` : NOTICE_ARCHIVE;

  const inlineNotice = primaryNotice ? (
    <div
      className={`site-notice-inline ${primaryNotice.type === "MAINTENANCE" ? "is-maintenance" : ""}`}
      aria-atomic="true"
      aria-label={NOTICE_BANNER_LABEL}
      aria-live={primaryNotice.type === "MAINTENANCE" ? "assertive" : "polite"}
      role={primaryNotice.type === "MAINTENANCE" ? "alert" : "status"}
    >
      <span className="site-notice-inline-icon" aria-hidden="true">
        {primaryNotice.type === "MAINTENANCE" ? <AlertTriangle size={17} /> : <Megaphone size={17} />}
      </span>
      <div className="site-notice-inline-copy">
        <span className="site-notice-inline-type">{getNoticeTypeLabel(primaryNotice.type)}</span>
        <p className="site-notice-inline-title">{primaryNotice.title}</p>
      </div>
      <Button
        className="site-notice-inline-details"
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      >
        {NOTICE_DETAILS}
      </Button>
      {primaryNotice.type === "BROADCAST" ? (
        <button
          className="site-notice-inline-dismiss"
          type="button"
          onClick={() => dismissNotice(primaryNotice.id)}
          aria-label={`${primaryNotice.title} ${NOTICE_CLOSE}`}
        >
          <X size={15} />
        </button>
      ) : null}
    </div>
  ) : null;

  function renderPanel() {
    return (
      <div className="site-notice-panel">
        <div className="site-notice-panel-head">
          <div>
            <p className="site-notice-panel-kicker">NOTICE</p>
            <h2 className="site-notice-panel-title">{TOPBAR_NOTICE_TITLE}</h2>
          </div>
          <Button
            className="site-notice-refresh"
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadNotices()}
            disabled={loading}
            aria-label={NOTICE_REFRESH}
          >
            {NOTICE_REFRESH}
          </Button>
        </div>
        {loading ? <p className="site-notice-empty">{NOTICE_LOADING}</p> : null}
        {!loading && error ? <p className="site-notice-empty">{error}</p> : null}
        {!loading && !error && visibleNotices.length === 0 ? <p className="site-notice-empty">{NOTICE_EMPTY}</p> : null}
        {!loading && !error && visibleNotices.length > 0 ? (
          <ul className="site-notice-list">
            {visibleNotices.map((notice) => (
              <li key={notice.id} className={`site-notice-item ${notice.type === "MAINTENANCE" ? "is-maintenance" : ""}`}>
                <div className="site-notice-item-head">
                  <Badge
                    className={`site-notice-type ${notice.type === "MAINTENANCE" ? "is-maintenance" : ""}`}
                    variant="outline"
                  >
                    {getNoticeTypeLabel(notice.type)}
                  </Badge>
                  <div className="site-notice-copy">
                    <h3 className="site-notice-title">{notice.title}</h3>
                    <p className="site-notice-body">{notice.message || NOTICE_EMPTY_MESSAGE}</p>
                  </div>
                  {notice.type === "BROADCAST" ? (
                    <button
                      className="site-notice-dismiss"
                      type="button"
                      onClick={() => dismissNotice(notice.id)}
                      aria-label={`${notice.title} ${NOTICE_CLOSE}`}
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  const trigger = (
    <Button
      className={`site-notice-trigger ${maintenanceCount > 0 ? "is-warning" : ""}`}
      type="button"
      variant="outline"
      size="icon"
      aria-label={archiveLabel}
      title={archiveLabel}
    >
      {maintenanceCount > 0 ? <AlertTriangle size={16} /> : <Megaphone size={16} />}
      {visibleNotices.length > 0 ? <Badge className="site-notice-badge">{visibleNotices.length}</Badge> : null}
    </Button>
  );

  const center = (
    <div className={`site-notice-center ${primaryNotice ? "has-inline-notice" : ""}`}>
      {inlineNotice}
      <div className="site-notice-archive">
        <span className="site-notice-archive-label">{NOTICE_ARCHIVE}</span>
        {isMobile ? (
          <SheetTrigger asChild>{trigger}</SheetTrigger>
        ) : (
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        )}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        {center}
        <SheetContent side="right" className="site-notice-sheet">
          <SheetHeader className="site-notice-sheet-head">
            <SheetTitle>{TOPBAR_NOTICE_TITLE}</SheetTitle>
            <SheetDescription>{TOPBAR_NOTICE_DESCRIPTION}</SheetDescription>
          </SheetHeader>
          {renderPanel()}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {center}
      <PopoverContent className="site-notice-popover" align="end" sideOffset={10} collisionPadding={8} avoidCollisions>
        {renderPanel()}
      </PopoverContent>
    </Popover>
  );
}
