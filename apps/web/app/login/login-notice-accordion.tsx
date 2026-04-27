"use client";

import { useState } from "react";

interface LoginNotice {
  id: string;
  title: string;
  message: string;
  type: "BROADCAST" | "MAINTENANCE";
}

interface LoginNoticeAccordionProps {
  notices: LoginNotice[];
}

export function LoginNoticeAccordion({ notices }: LoginNoticeAccordionProps) {
  const [expandedNoticeId, setExpandedNoticeId] = useState<string | null>(null);

  return (
    <ul className="login-notice-list">
      {notices.map((notice) => {
        const expanded = expandedNoticeId === notice.id;
        const noticeLabel = notice.type === "MAINTENANCE" ? "점검" : "공지";

        return (
          <li key={notice.id} className={`login-notice-item ${expanded ? "is-expanded" : ""}`}>
            <button
              type="button"
              className="login-notice-trigger"
              aria-expanded={expanded}
              onClick={() => setExpandedNoticeId((prev) => (prev === notice.id ? null : notice.id))}
            >
              <span className="login-notice-trigger-copy">
                <span className={`login-notice-badge ${notice.type === "MAINTENANCE" ? "is-maintenance" : "is-broadcast"}`}>
                  {noticeLabel}
                </span>
                <span className="login-notice-trigger-title">{notice.title}</span>
              </span>
              <span className="login-notice-trigger-meta">{expanded ? "접기" : "자세히"}</span>
            </button>
            {expanded ? (
              <div className="login-notice-body">
                {notice.message || "공지 내용이 없습니다."}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
