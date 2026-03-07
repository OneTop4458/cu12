"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";

type EffectiveTheme = "light" | "dark";

type SunTimesPayload = {
  daily?: {
    sunrise?: string[];
    sunset?: string[];
  };
};

type SunThemeResult = {
  theme: EffectiveTheme;
  nextSwitchAtMs: number;
};

const SEOUL_LOCATION = {
  latitude: 37.4201,
  longitude: 127.1262,
  timezone: "Asia/Seoul",
} as const;

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const SUN_REFRESH_FALLBACK_MS = 30 * 60 * 1000;
const MIN_RECHECK_DELAY_MS = 45 * 1000;
const KST_OFFSET = "+09:00";

function parseKstDateTime(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) {
    const direct = Date.parse(value);
    return Number.isFinite(direct) ? direct : null;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    const withOffset = Date.parse(`${value}:00${KST_OFFSET}`);
    return Number.isFinite(withOffset) ? withOffset : null;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    const withOffset = Date.parse(`${value}${KST_OFFSET}`);
    return Number.isFinite(withOffset) ? withOffset : null;
  }

  return null;
}

function computeSunTheme(nowMs: number, sunriseTodayMs: number, sunsetTodayMs: number, sunriseTomorrowMs: number | null): SunThemeResult | null {
  if (!Number.isFinite(sunriseTodayMs) || !Number.isFinite(sunsetTodayMs)) return null;
  if (sunriseTodayMs >= sunsetTodayMs) return null;

  if (nowMs < sunriseTodayMs) {
    return {
      theme: "dark",
      nextSwitchAtMs: sunriseTodayMs + 1000,
    };
  }

  if (nowMs < sunsetTodayMs) {
    return {
      theme: "light",
      nextSwitchAtMs: sunsetTodayMs + 1000,
    };
  }

  return {
    theme: "dark",
    nextSwitchAtMs: (sunriseTomorrowMs ?? sunriseTodayMs + 24 * 60 * 60 * 1000) + 1000,
  };
}

async function fetchSunTheme(now = new Date()): Promise<SunThemeResult | null> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(SEOUL_LOCATION.latitude));
  url.searchParams.set("longitude", String(SEOUL_LOCATION.longitude));
  url.searchParams.set("daily", "sunrise,sunset");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("timezone", SEOUL_LOCATION.timezone);

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as SunTimesPayload;
  const sunriseTodayMs = parseKstDateTime(payload.daily?.sunrise?.[0]);
  const sunsetTodayMs = parseKstDateTime(payload.daily?.sunset?.[0]);
  const sunriseTomorrowMs = parseKstDateTime(payload.daily?.sunrise?.[1]);
  if (sunriseTodayMs === null || sunsetTodayMs === null) return null;
  return computeSunTheme(now.getTime(), sunriseTodayMs, sunsetTodayMs, sunriseTomorrowMs);
}

function normalizeResolvedTheme(value: string | undefined): EffectiveTheme | null {
  if (value === "dark") return "dark";
  if (value === "light") return "light";
  return null;
}

function ThemeBridge() {
  const { theme, resolvedTheme } = useTheme();
  const [sunTheme, setSunTheme] = useState<EffectiveTheme | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (theme !== "system") {
      setSunTheme(null);
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
        void refreshSunTheme();
      }, Math.max(MIN_RECHECK_DELAY_MS, delayMs));
    };

    const refreshSunTheme = async () => {
      try {
        const result = await fetchSunTheme();
        if (cancelled) return;
        if (!result) {
          setSunTheme(null);
          scheduleRefresh(SUN_REFRESH_FALLBACK_MS);
          return;
        }
        setSunTheme(result.theme);
        scheduleRefresh(result.nextSwitchAtMs - Date.now());
      } catch {
        if (cancelled) return;
        setSunTheme(null);
        scheduleRefresh(SUN_REFRESH_FALLBACK_MS);
      }
    };

    void refreshSunTheme();

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
    if (theme === "system") return sunTheme ?? fallbackTheme;
    return fallbackTheme;
  }, [fallbackTheme, sunTheme, theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system" && sunTheme) {
      root.classList.remove("light", "dark");
      root.classList.add(sunTheme);
      root.style.colorScheme = sunTheme;
      root.dataset.cu12SystemTheme = sunTheme;
      return;
    }

    delete root.dataset.cu12SystemTheme;
    root.style.colorScheme = "";
    if (theme === "system" && fallbackTheme) {
      root.classList.remove("light", "dark");
      root.classList.add(fallbackTheme);
    }
  }, [fallbackTheme, sunTheme, theme]);

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
