"use client";

import { type ReactNode, useEffect } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";

function ThemeCookieBridge() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!resolvedTheme) return;

    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `cu12-ui-theme=${resolvedTheme}; path=/; max-age=${maxAge}; SameSite=Lax`;
  }, [resolvedTheme]);

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
      <ThemeCookieBridge />
      {children}
    </NextThemesProvider>
  );
}
