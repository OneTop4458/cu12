"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const LAST_ACTIVITY_KEY = "cu12:last-activity-at";
const IDLE_TIMEOUT_OVERRIDE_KEY = "cu12:session-idle-timeout-ms";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MS;
const REFRESH_MIN_INTERVAL_MS = 2 * 60 * 1000;
const COUNTDOWN_TICK_MS = 1000;
const WARNING_THRESHOLD_MS = 5 * 60 * 1000;
const ACTIVITY_APPLY_GAP_MS = 20 * 1000;
const MOUSE_MOVE_THRESHOLD_PX = 36;

function isProtectedPath(pathname: string): boolean {
  return pathname.startsWith("/dashboard") || pathname.startsWith("/admin");
}

function readStoredActivityAt(): number {
  if (typeof window === "undefined") return Date.now();
  try {
    const raw = window.localStorage.getItem(LAST_ACTIVITY_KEY);
    if (!raw) return Date.now();
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return Date.now();
    return parsed;
  } catch {
    return Date.now();
  }
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSeconds / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / 3600);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) {
    const dayMinutes = Math.floor((totalSeconds % (24 * 60 * 60)) / 60);
    return `${days}일 ${String(Math.floor(dayMinutes / 60)).padStart(2, "0")} : ${String(dayMinutes % 60).padStart(2, "0")}`;
  }
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")} : ${String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0")} : ${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")} : ${String(seconds).padStart(2, "0")}`;
}

function readStoredIdleTimeoutMs(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(IDLE_TIMEOUT_OVERRIDE_KEY);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.min(MAX_IDLE_TIMEOUT_MS, Math.max(1000, Math.trunc(parsed)));
}

function writeStoredIdleTimeoutMs(timeoutMs: number): void {
  if (typeof window === "undefined") return;
  const safe = Math.min(MAX_IDLE_TIMEOUT_MS, Math.max(1000, Math.trunc(timeoutMs)));
  try {
    window.localStorage.setItem(IDLE_TIMEOUT_OVERRIDE_KEY, String(safe));
  } catch {
    // Ignore storage failures.
  }
}

function getIdleTimeoutMs(): number {
  const stored = readStoredIdleTimeoutMs();
  return stored ?? IDLE_TIMEOUT_MS;
}

export function SessionActivityGuard() {
  const pathname = usePathname();
  const active = isProtectedPath(pathname);
  const lastActivityAtRef = useRef<number>(Date.now());
  const lastRefreshAtRef = useRef<number>(0);
  const lastActivityHandledAtRef = useRef<number>(0);
  const lastMousePositionRef = useRef<{ x: number; y: number } | null>(null);
  const loggingOutRef = useRef<boolean>(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => Math.ceil(getIdleTimeoutMs() / 1000));
  const [warningMode, setWarningMode] = useState<boolean>(false);

  const setActiveStateNow = (timestamp: number) => {
    lastActivityAtRef.current = timestamp;
    setRemainingSeconds(Math.ceil(getIdleTimeoutMs() / 1000));
    setWarningMode(false);
    try {
      window.localStorage.setItem(LAST_ACTIVITY_KEY, String(timestamp));
    } catch {
      // Ignore storage errors.
    }
  };

  const redirectToLogin = (reason: "session-timeout" | "session-expired") => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    const url = new URL("/login", window.location.origin);
    url.searchParams.set("reason", reason);
    window.location.assign(`${url.pathname}${url.search}`);
  };

  const tryRefresh = async (now: number) => {
    if (loggingOutRef.current) return;
    if (now - lastRefreshAtRef.current < REFRESH_MIN_INTERVAL_MS) return;
    lastRefreshAtRef.current = now;

    try {
      const response = await fetch("/api/auth/session/refresh", {
        method: "POST",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        redirectToLogin("session-expired");
        return;
      }
      if (!response.ok) return;

      const payload = (await response.json()) as { expiresInSeconds?: unknown };
      if (typeof payload.expiresInSeconds === "number" && Number.isFinite(payload.expiresInSeconds) && payload.expiresInSeconds > 0) {
        writeStoredIdleTimeoutMs(payload.expiresInSeconds * 1000);
      }
    } catch {
      // Ignore transient network failures.
    }
  };

  const registerActivity = (now: number) => {
    if (loggingOutRef.current) return;
    if (now - lastActivityHandledAtRef.current < ACTIVITY_APPLY_GAP_MS) return;
    lastActivityHandledAtRef.current = now;
    setActiveStateNow(now);
    void tryRefresh(now);
  };

  const extendSession = async () => {
    if (loggingOutRef.current) return;
    const now = Date.now();
    await tryRefresh(now);
    setActiveStateNow(now);
  };

  useEffect(() => {
    if (!active) return;

    const bootstrappedAt = Math.max(readStoredActivityAt(), Date.now());
    setActiveStateNow(bootstrappedAt);
    lastActivityHandledAtRef.current = bootstrappedAt;
    void tryRefresh(Date.now());

    const onMouseMove = (event: MouseEvent) => {
      const { clientX, clientY } = event;
      const last = lastMousePositionRef.current;
      if (!last) {
        lastMousePositionRef.current = { x: clientX, y: clientY };
        return;
      }

      const distanceSq = (clientX - last.x) ** 2 + (clientY - last.y) ** 2;
      lastMousePositionRef.current = { x: clientX, y: clientY };
      if (distanceSq < MOUSE_MOVE_THRESHOLD_PX ** 2) return;

      registerActivity(Date.now());
    };

    const onPointerAction = () => {
      registerActivity(Date.now());
    };

    const onStorage = (event: StorageEvent) => {
      if (loggingOutRef.current) return;
      if (event.key === LAST_ACTIVITY_KEY && event.newValue) {
        const parsed = Number(event.newValue);
        if (Number.isFinite(parsed) && parsed > lastActivityAtRef.current) {
          setActiveStateNow(parsed);
        }
        return;
      }

      if (event.key === IDLE_TIMEOUT_OVERRIDE_KEY && event.newValue) {
        const parsed = Number(event.newValue);
        if (Number.isFinite(parsed) && parsed > 0) {
          const timeoutMs = Math.max(1000, Math.trunc(parsed));
          const remaining = timeoutMs - (Date.now() - lastActivityAtRef.current);
          const warningThresholdMs = Math.min(WARNING_THRESHOLD_MS, Math.max(5000, timeoutMs * 0.2));
          setRemainingSeconds(Math.max(0, Math.ceil(remaining / 1000)));
          setWarningMode(remaining <= warningThresholdMs);
        }
      }
    };

    const checkIdle = async () => {
      if (loggingOutRef.current) return;
      const idleTimeoutMs = getIdleTimeoutMs();
      const remaining = idleTimeoutMs - (Date.now() - lastActivityAtRef.current);
      const warningThresholdMs = Math.min(WARNING_THRESHOLD_MS, Math.max(5000, idleTimeoutMs * 0.2));
      setRemainingSeconds(Math.max(0, Math.ceil(remaining / 1000)));
      setWarningMode(remaining <= warningThresholdMs);

      if (remaining > 0) return;

      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          keepalive: true,
        });
      } catch {
        // Logout endpoint failure should still redirect to login.
      } finally {
        redirectToLogin("session-timeout");
      }
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "F12" || event.key === "F5") return;
      onPointerAction();
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("mousedown", onPointerAction);
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("touchstart", onPointerAction);
    window.addEventListener("scroll", onPointerAction, { passive: true });
    window.addEventListener("storage", onStorage);

    const intervalId = window.setInterval(() => {
      void checkIdle();
    }, COUNTDOWN_TICK_MS);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onPointerAction);
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("touchstart", onPointerAction);
      window.removeEventListener("scroll", onPointerAction);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(intervalId);
    };
  }, [active]);

  if (!active) return null;

  const warningRatio = Math.min(1, remainingSeconds / (Math.max(1, getIdleTimeoutMs() / 1000)));

  return (
    <div
      role="status"
      aria-live="polite"
      className={`session-warning-bar ${warningMode ? "is-warning" : "is-active"}`}
    >
      <div className="session-warning-copy">
        <div className="session-warning-title">자동 로그아웃</div>
        <div className="session-warning-sub">
          남은 시간 {formatRemaining(remainingSeconds * 1000)} / {formatRemaining(getIdleTimeoutMs())}
        </div>
      </div>
      <div className="session-warning-progress-wrap">
        <div
          className={`session-warning-progress ${warningMode ? "is-warning" : ""}`}
          style={{ width: `${Math.max(2, warningRatio * 100)}%` }}
        />
      </div>
      <button
        type="button"
        onClick={() => {
          void extendSession();
        }}
        className="session-warning-button"
      >
        세션 연장
      </button>
    </div>
  );
}
