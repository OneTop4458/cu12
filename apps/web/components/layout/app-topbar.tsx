"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import { ActivityCenter } from "../notifications/activity-center";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { AppMobileNav } from "./app-mobile-nav";
import { UserMenu } from "./user-menu";

type RoleType = "ADMIN" | "USER";

export type AppTopbarLink = {
  href: string;
  label: string;
};

type AppTopbarProps = {
  id?: string;
  mode: "dashboard" | "admin";
  title: string;
  kicker?: string;
  includeAdmin?: boolean;
  navLinks?: AppTopbarLink[];
  email: string;
  role: RoleType;
  impersonating?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onDashboard?: () => void;
  onGoAdmin?: () => void;
  onOpenSettings?: () => void;
  onLogout: () => void;
};

export function AppTopbar({
  id,
  mode,
  title,
  kicker = "Catholic University Automation",
  includeAdmin = false,
  navLinks = [],
  email,
  role,
  impersonating = false,
  refreshing = false,
  onRefresh,
  onDashboard,
  onGoAdmin,
  onOpenSettings,
  onLogout,
}: AppTopbarProps) {
  return (
    <header className="topbar" id={id}>
      <div className="topbar-main">
        <div className="topbar-brand">
          <Image
            src="/brand/catholic/crest-mark.png"
            alt="Catholic University crest"
            width={34}
            height={34}
            loading="lazy"
          />
          <div>
            <p className="brand-kicker">{kicker}</p>
            <h1>{title}</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <AppMobileNav mode={mode} includeAdmin={includeAdmin} />
          {onRefresh ? (
            <Button
              className="icon-btn"
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              title="새로고침"
              aria-label="새로고침"
              variant="outline"
              size="icon"
            >
              <RefreshCw size={16} />
            </Button>
          ) : null}
          {navLinks.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="topbar-menu-trigger"
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="화면 이동"
                >
                  <MoreHorizontal size={17} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="topbar-menu-content" align="end" sideOffset={10} collisionPadding={8}>
                <DropdownMenuLabel className="topbar-menu-label">화면 이동</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {navLinks.map((link) => (
                  <DropdownMenuItem asChild className="topbar-menu-item" key={link.href}>
                    <Link href={link.href as Route}>{link.label}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <ActivityCenter />
          <UserMenu
            email={email}
            role={role}
            impersonating={impersonating}
            onDashboard={onDashboard}
            onGoAdmin={onGoAdmin}
            onOpenSettings={onOpenSettings}
            onLogout={onLogout}
          />
        </div>
      </div>
    </header>
  );
}
