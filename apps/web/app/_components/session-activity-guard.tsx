"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const LAST_ACTIVITY_KEY = "cu12:last-activity-at";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const REFRESH_MIN_INTERVAL_MS = 2 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 15 * 1000;

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

export function SessionActivityGuard() {
  const pathname = usePathname();
  const active = isProtectedPath(pathname);
  const lastActivityAtRef = useRef<number>(Date.now());
  const lastRefreshAtRef = useRef<number>(0);
  const loggingOutRef = useRef<boolean>(false);

  useEffect(() => {
    if (!active) return;

    const bootstrappedAt = Math.max(readStoredActivityAt(), Date.now());
    lastActivityAtRef.current = bootstrappedAt;
    try {
      window.localStorage.setItem(LAST_ACTIVITY_KEY, String(bootstrappedAt));
    } catch {
      // Ignore storage errors; keep component local state in fallback mode.
    }

    const applyActivity = (timestamp: number) => {
      lastActivityAtRef.current = timestamp;
      try {
        window.localStorage.setItem(LAST_ACTIVITY_KEY, String(timestamp));
      } catch {
        // Ignore storage errors; same-tab behavior is enough.
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

    const onActivity = () => {
      const now = Date.now();
      applyActivity(now);
      void tryRefresh(now);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== LAST_ACTIVITY_KEY || !event.newValue) return;
      const parsed = Number(event.newValue);
      if (Number.isFinite(parsed) && parsed > lastActivityAtRef.current) {
        lastActivityAtRef.current = parsed;
      }
    };

    const checkIdle = async () => {
      if (loggingOutRef.current) return;
      if (Date.now() - lastActivityAtRef.current < IDLE_TIMEOUT_MS) return;

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
    }, IDLE_CHECK_INTERVAL_MS);

    return () => {
      events.forEach((name) => window.removeEventListener(name, onActivity));
      window.removeEventListener("storage", onStorage);
      window.clearInterval(intervalId);
    };
  }, [active]);

  return null;
}
