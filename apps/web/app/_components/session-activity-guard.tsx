"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const LAST_ACTIVITY_KEY = "cu12:last-activity-at";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const REFRESH_MIN_INTERVAL_MS = 2 * 60 * 1000;
const COUNTDOWN_TICK_MS = 1000;
const WARNING_THRESHOLD_MS = 5 * 60 * 1000;

function isProtectedPath(pathname: string): boolean {
  return pathname.startsWith("/dashboard") || pathname.startsWith("/admin");
}

function readStoredActivityAt(): number {
  if (typeof window === "undefined") return Date.now();
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LAST_ACTIVITY_KEY);
  } catch {
    return Date.now();
  }
  if (!raw) return Date.now();
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return Date.now();
  return parsed;
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function SessionActivityGuard() {
  const pathname = usePathname();
  const active = isProtectedPath(pathname);
  const lastActivityAtRef = useRef<number>(Date.now());
  const lastRefreshAtRef = useRef<number>(0);
  const loggingOutRef = useRef<boolean>(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(Math.ceil(IDLE_TIMEOUT_MS / 1000));
  const [warningMode, setWarningMode] = useState<boolean>(false);

  const setActiveStateNow = (timestamp: number) => {
    lastActivityAtRef.current = timestamp;
    setRemainingSeconds(Math.ceil(IDLE_TIMEOUT_MS / 1000));
    setWarningMode(false);
    try {
      window.localStorage.setItem(LAST_ACTIVITY_KEY, String(timestamp));
    } catch {
      // Ignore storage errors; keep component local state in fallback mode.
    }
  };

  const extendSession = async () => {
    if (loggingOutRef.current) return;
    const now = Date.now();
    try {
      const response = await fetch("/api/auth/session/refresh", {
        method: "POST",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        loggingOutRef.current = true;
        window.location.assign("/login");
        return;
      }
      setActiveStateNow(now);
    } catch {
      // Ignore transient network failures.
    }
  };

  useEffect(() => {
    if (!active) return;

    const bootstrappedAt = Math.max(readStoredActivityAt(), Date.now());
    setActiveStateNow(bootstrappedAt);

    const onActivity = () => {
      const now = Date.now();
      setActiveStateNow(now);
      void tryRefresh(now);
    };

    const tryRefresh = async (now: number) => {
      if (now - lastRefreshAtRef.current < REFRESH_MIN_INTERVAL_MS) return;
      lastRefreshAtRef.current = now;

      try {
        const response = await fetch("/api/auth/session/refresh", {
          method: "POST",
          credentials: "same-origin",
        });
        if (response.status === 401) {
          loggingOutRef.current = true;
          window.location.assign("/login");
        }
      } catch {
        // Ignore transient network failures.
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== LAST_ACTIVITY_KEY || !event.newValue) return;
      const parsed = Number(event.newValue);
      if (Number.isFinite(parsed) && parsed > lastActivityAtRef.current) {
        setActiveStateNow(parsed);
      }
    };

    const checkIdle = async () => {
      if (loggingOutRef.current) return;
      const remaining = IDLE_TIMEOUT_MS - (Date.now() - lastActivityAtRef.current);
      setRemainingSeconds(Math.max(0, Math.ceil(remaining / 1000)));
      setWarningMode(remaining <= WARNING_THRESHOLD_MS);

      if (remaining > 0) return;

      loggingOutRef.current = true;
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          keepalive: true,
        });
      } catch {
        // Logout endpoint failure should still redirect to login.
      } finally {
        window.location.assign("/login");
      }
    };

    const events: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "keydown", "touchstart"];
    events.forEach((name) => window.addEventListener(name, onActivity, { passive: true }));
    window.addEventListener("storage", onStorage);

    const intervalId = window.setInterval(() => {
      void checkIdle();
    }, COUNTDOWN_TICK_MS);

    return () => {
      events.forEach((name) => window.removeEventListener(name, onActivity));
      window.removeEventListener("storage", onStorage);
      window.clearInterval(intervalId);
    };
  }, [active]);

  if (!active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        right: 16,
        top: 16,
        zIndex: 1000,
        minWidth: 180,
        backgroundColor: warningMode ? "#7f1d1d" : "#065f46",
        color: "white",
        padding: "8px 12px",
        borderRadius: 10,
        fontSize: 12,
        lineHeight: 1.35,
        fontFamily: "ui-sans-serif,system-ui,sans-serif",
        boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
        border: "1px solid rgba(255,255,255,0.2)",
      }}
    >
      <div style={{ fontWeight: 700 }}>자동 로그아웃</div>
      <div>남은 시간: {formatRemaining(remainingSeconds * 1000)}</div>
      {warningMode ? <div style={{ color: "#fed7aa" }}>5분 이내입니다.</div> : null}
      <div style={{ marginTop: 4 }}>
        <button
          type="button"
          onClick={() => {
            void extendSession();
          }}
          style={{
            border: "1px solid rgba(255,255,255,0.45)",
            borderRadius: 6,
            background: "rgba(255,255,255,0.15)",
            color: "white",
            padding: "4px 8px",
            fontSize: 11,
            fontFamily: "inherit",
          }}
        >
          세션 연장
        </button>
      </div>
    </div>
  );
}
