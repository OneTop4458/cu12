"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

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
  const resolvedLabel = ariaLabel ?? `${label} 테마 설정`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? "secondary" : "ghost"}
          size="sm"
          className={`theme-toggle-item ${active ? "active" : ""}`}
          aria-pressed={active}
          aria-label={resolvedLabel}
          onClick={onClick}
          data-theme-option={value}
        >
          <Icon className="theme-toggle-icon" size={14} strokeWidth={2.2} />
          <span>{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{resolvedLabel}</TooltipContent>
    </Tooltip>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = (mounted && theme ? theme : "system") as "light" | "dark" | "system";

  return (
    <div className="theme-toggle" role="group" aria-label="테마 설정">
      <ThemeOptionButton
        active={mounted && current === "light"}
        onClick={() => setTheme("light")}
        icon={Sun}
        label="라이트"
        value="light"
      />
      <ThemeOptionButton
        active={mounted && current === "dark"}
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
        ariaLabel="시스템 설정에 맞춰 테마 자동 선택"
        value="system"
      />
    </div>
  );
}
