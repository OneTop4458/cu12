"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";

type EffectiveTheme = "light" | "dark";

type TimedThemeResult = {
  theme: EffectiveTheme;
  nextSwitchAtMs: number;
};

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const MIN_RECHECK_DELAY_MS = 45 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SYSTEM_LIGHT_START_HOUR = 7;
const SYSTEM_DARK_START_HOUR = 19;

function resolveSystemThemeByTime(nowMs = Date.now()): TimedThemeResult {
  const nowKstMs = nowMs + KST_OFFSET_MS;
  const nowKst = new Date(nowKstMs);
  const year = nowKst.getUTCFullYear();
  const month = nowKst.getUTCMonth();
  const date = nowKst.getUTCDate();
  const lightStartKstMs = Date.UTC(year, month, date, SYSTEM_LIGHT_START_HOUR, 0, 0, 0);
  const darkStartKstMs = Date.UTC(year, month, date, SYSTEM_DARK_START_HOUR, 0, 0, 0);

  if (nowKstMs < lightStartKstMs) {
    return {
      theme: "dark",
      nextSwitchAtMs: lightStartKstMs - KST_OFFSET_MS + 1000,
    };
  }

  if (nowKstMs < darkStartKstMs) {
    return {
      theme: "light",
      nextSwitchAtMs: darkStartKstMs - KST_OFFSET_MS + 1000,
    };
  }

  return {
    theme: "dark",
    nextSwitchAtMs: lightStartKstMs + 24 * 60 * 60 * 1000 - KST_OFFSET_MS + 1000,
  };
}

function normalizeResolvedTheme(value: string | undefined): EffectiveTheme | null {
  if (value === "dark") return "dark";
  if (value === "light") return "light";
  return null;
}

function ThemeBridge() {
  const { theme, resolvedTheme } = useTheme();
  const [timedTheme, setTimedTheme] = useState<EffectiveTheme | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (theme !== "system") {
      setTimedTheme(null);
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const scheduleRefresh = (delayMs: number) => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        refreshTimedTheme();
      }, Math.max(MIN_RECHECK_DELAY_MS, delayMs));
    };

    const refreshTimedTheme = () => {
      const next = resolveSystemThemeByTime(Date.now());
      if (cancelled) return;
      setTimedTheme(next.theme);
      scheduleRefresh(next.nextSwitchAtMs - Date.now());
    };

    refreshTimedTheme();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [theme]);

  const fallbackTheme = normalizeResolvedTheme(resolvedTheme);
  const effectiveTheme = useMemo<EffectiveTheme | null>(() => {
    if (theme === "system") return timedTheme ?? fallbackTheme;
    return fallbackTheme;
  }, [fallbackTheme, timedTheme, theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system" && timedTheme) {
      root.classList.remove("light", "dark");
      root.classList.add(timedTheme);
      root.style.colorScheme = timedTheme;
      root.dataset.cu12SystemTheme = timedTheme;
      return;
    }

    delete root.dataset.cu12SystemTheme;
    root.style.colorScheme = "";
    if (theme === "system" && fallbackTheme) {
      root.classList.remove("light", "dark");
      root.classList.add(fallbackTheme);
    }
  }, [fallbackTheme, timedTheme, theme]);

  useEffect(() => {
    if (!effectiveTheme) return;
    document.cookie = `cu12-ui-theme=${effectiveTheme}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
  }, [effectiveTheme]);

  return null;
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      themes={["light", "dark", "system"]}
      storageKey="cu12-ui-theme"
      disableTransitionOnChange
    >
      <ThemeBridge />
      {children}
    </NextThemesProvider>
  );
}
