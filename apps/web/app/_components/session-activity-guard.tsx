"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const LAST_ACTIVITY_KEY = "cu12:last-activity-at";
const SESSION_EXPIRED_STATE_KEY = "cu12:session-timeout-state";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_FUTURE_ACTIVITY_SKEW_MS = 60 * 1000;
const REFRESH_MIN_INTERVAL_MS = 2 * 60 * 1000;
const COUNTDOWN_TICK_MS = 1000;
const WARNING_THRESHOLD_MS = 5 * 60 * 1000;
const ACTIVITY_APPLY_GAP_MS = 20 * 1000;
const MOUSE_MOVE_THRESHOLD_PX = 36;
type SessionExpiredReason = "session-timeout" | "session-expired";

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
    const now = Date.now();
    if (parsed > now + MAX_FUTURE_ACTIVITY_SKEW_MS) return now;
    return parsed;
  } catch {
    return Date.now();
  }
}

function readSessionExpiredState(): SessionExpiredReason | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_EXPIRED_STATE_KEY);
    return raw === "session-timeout" || raw === "session-expired" ? raw : null;
  } catch {
    return null;
  }
}

function writeSessionExpiredState(reason: SessionExpiredReason | null) {
  if (typeof window === "undefined") return;
  try {
    if (!reason) {
      window.localStorage.removeItem(SESSION_EXPIRED_STATE_KEY);
      return;
    }
    window.localStorage.setItem(SESSION_EXPIRED_STATE_KEY, reason);
  } catch {
    // Ignore storage errors.
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

function getIdleTimeoutMs(): number {
  return IDLE_TIMEOUT_MS;
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
  const [sessionExpiredReason, setSessionExpiredReason] = useState<SessionExpiredReason | null>(null);

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

  const navigateToLogin = (reason: SessionExpiredReason) => {
    const url = new URL("/login", window.location.origin);
    url.searchParams.set("reason", reason);
    window.location.assign(`${url.pathname}${url.search}`);
  };

  const markSessionExpired = async (reason: SessionExpiredReason) => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    setSessionExpiredReason(reason);
    setRemainingSeconds(0);
    setWarningMode(false);
    writeSessionExpiredState(reason);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        keepalive: true,
      });
    } catch {
      // Ignore logout endpoint failures.
    }
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
        void markSessionExpired("session-expired");
        return;
      }
      if (!response.ok) return;
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
    if (sessionExpiredReason) return;
    if (loggingOutRef.current) return;
    const now = Date.now();
    await tryRefresh(now);
    setActiveStateNow(now);
  };

  useEffect(() => {
    if (!active) return;

    const persistedExpiredReason = readSessionExpiredState();
    if (persistedExpiredReason) {
      setSessionExpiredReason(persistedExpiredReason);
      setRemainingSeconds(0);
      setWarningMode(false);
      loggingOutRef.current = true;
      return;
    }

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
        if (Number.isFinite(parsed) && parsed > 0) {
          const now = Date.now();
          const safe = parsed > now + MAX_FUTURE_ACTIVITY_SKEW_MS ? now : parsed;
          if (safe > lastActivityAtRef.current) {
            setActiveStateNow(safe);
          }
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

      await markSessionExpired("session-timeout");
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
  const timeoutMessage =
    sessionExpiredReason === "session-timeout"
      ? "자동 로그아웃: 30분 이상 활동이 없어 세션이 만료되어 로그아웃되었습니다."
      : "세션이 만료되어 로그아웃되었습니다. 다시 로그인해 주세요.";

  if (sessionExpiredReason) {
    return (
      <div className="modal-overlay">
        <section className="modal-card" role="dialog" aria-modal="true" aria-label="세션 만료 안내">
          <h2>세션 만료</h2>
          <p className="muted">{timeoutMessage}</p>
          <p className="session-warning-sub">
            화면을 새로고침하거나 아래 버튼으로 로그인 화면으로 이동해 다시 로그인해 주세요.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                window.location.reload();
              }}
            >
              새로고침
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                navigateToLogin(sessionExpiredReason);
              }}
            >
              로그인 페이지로 이동
            </button>
          </div>
        </section>
      </div>
    );
  }

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
