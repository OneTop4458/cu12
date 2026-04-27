"use client";

import { type ReactNode, useEffect } from "react";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function AppThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark");
    root.classList.add("light");
    root.style.colorScheme = "light";
    document.cookie = `cu12-ui-theme=light; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
  }, []);

  return <>{children}</>;
}
