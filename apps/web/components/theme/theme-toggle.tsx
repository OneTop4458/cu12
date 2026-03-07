"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

function ThemeOptionButton({
  active,
  onClick,
  icon: Icon,
  label,
  ariaLabel,
  value,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Sun;
  label: string;
  ariaLabel?: string;
  value: "light" | "dark" | "system";
}) {
  return (
    <button
      type="button"
      className={`theme-toggle-item ${active ? "active" : ""}`}
      aria-pressed={active}
      aria-label={ariaLabel ?? `${label} 테마 설정`}
      onClick={onClick}
      data-theme-option={value}
    >
      <Icon className="theme-toggle-icon" size={14} strokeWidth={2.2} />
      <span>{label}</span>
    </button>
  );
}

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = (mounted && theme ? theme : "system") as "light" | "dark" | "system";
  const visibleTheme = resolvedTheme ?? current;

  return (
    <div className="theme-toggle" role="group" aria-label="테마 설정">
      <ThemeOptionButton
        active={mounted && visibleTheme === "light"}
        onClick={() => setTheme("light")}
        icon={Sun}
        label="라이트"
        value="light"
      />
      <ThemeOptionButton
        active={mounted && visibleTheme === "dark"}
        onClick={() => setTheme("dark")}
        icon={Moon}
        label="다크"
        value="dark"
      />
      <ThemeOptionButton
        active={mounted && current === "system"}
        onClick={() => setTheme("system")}
        icon={Monitor}
        label="시스템"
        ariaLabel="시스템(시간 자동) 테마 설정"
        value="system"
      />
    </div>
  );
}
