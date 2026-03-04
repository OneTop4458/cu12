"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const LAST_ACTIVITY_KEY = "cu12:last-activity-at";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
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
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")} : ${String(seconds).padStart(2, "0")}`;
}

export function SessionActivityGuard() {
  const pathname = usePathname();
  const active = isProtectedPath(pathname);
  const lastActivityAtRef = useRef<number>(Date.now());
  const lastRefreshAtRef = useRef<number>(0);
  const lastActivityHandledAtRef = useRef<number>(0);
  const lastMousePositionRef = useRef<{ x: number; y: number } | null>(null);
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
      // Ignore storage errors.
    }
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

  const registerActivity = (now: number) => {
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

  const warningRatio = Math.min(1, remainingSeconds / (IDLE_TIMEOUT_MS / 1000));

  return (
    <div
      role="status"
      aria-live="polite"
      className="session-warning-bar"
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        alignItems: "center",
        gap: 14,
        padding: "10px 14px",
        boxSizing: "border-box",
        background: warningMode
          ? "linear-gradient(100deg, #7f1d1d 0%, #991b1b 55%, #b45309 100%)"
          : "linear-gradient(100deg, #0f766e 0%, #0d9488 52%, #14b8a6 100%)",
        color: "#ffffff",
        fontSize: 12,
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        borderBottom: "1px solid rgba(255,255,255,.28)",
        boxShadow: "0 10px 24px rgba(0,0,0,.2)",
      }}
    >
      <div>
        <div style={{ fontWeight: 800, letterSpacing: "0.2px", marginBottom: 2 }}>자동 로그아웃</div>
        <div style={{ opacity: 0.92 }}>
          남은 시간 {formatRemaining(remainingSeconds * 1000)} / 30:00
        </div>
      </div>
      <div
        style={{
          width: 220,
          background: "rgba(15, 23, 42, 0.35)",
          borderRadius: 999,
          height: 9,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.max(2, warningRatio * 100)}%`,
            background: warningMode
              ? "linear-gradient(90deg, #fecdd3, #fca5a5)"
              : "linear-gradient(90deg, #d1fae5, #bae6fd)",
            transition: "width 0.8s ease",
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => {
          void extendSession();
        }}
        style={{
          border: "1px solid rgba(255,255,255,0.45)",
          borderRadius: 8,
          background: "rgba(255,255,255,0.15)",
          color: "#ffffff",
          padding: "8px 12px",
          fontSize: 12,
          fontWeight: 700,
          fontFamily: "inherit",
          cursor: "pointer",
        }}
      >
        세션 연장
      </button>
    </div>
  );
}
