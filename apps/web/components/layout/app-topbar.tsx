"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ActivityCenter } from "../notifications/activity-center";
import { SessionActivityGuard } from "../../app/_components/session-activity-guard";
import { SiteNoticeCenter } from "./site-notice-center";
import { UserMenu } from "./user-menu";

type RoleType = "ADMIN" | "USER";

const ADMIN_TOPBAR_LINKS = [
  { href: "/admin", label: "관리센터" },
  { href: "/admin/system", label: "시스템 상태" },
  { href: "/admin/system/policies", label: "약관/고지" },
  { href: "/admin/site-notices", label: "공지/점검" },
  { href: "/admin/operations", label: "운영 작업" },
  { href: "/admin/operations/jobs", label: "작업 목록" },
  { href: "/admin/operations/workers", label: "워커 목록" },
  { href: "/admin/operations/reconcile", label: "정합성 점검" },
  { href: "/admin/operations/cleanup", label: "작업 정리" },
] as const;

type AppTopbarProps = {
  id?: string;
  title: string;
  kicker?: string;
  email: string;
  role: RoleType;
  impersonating?: boolean;
  showAdminNav?: boolean;
  adminNavActivePath?: string;
  onDashboard?: () => void;
  onGoAdmin?: () => void;
  onOpenSettings?: () => void;
  onLogout: () => void;
};

function resolveActiveAdminHref(pathname: string, override?: string): string | undefined {
  if (override) return override;
  return ADMIN_TOPBAR_LINKS
    .filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function AppTopbar({
  id,
  title,
  kicker = "Catholic University Automation",
  email,
  role,
  impersonating = false,
  showAdminNav = false,
  adminNavActivePath,
  onDashboard,
  onGoAdmin,
  onOpenSettings,
  onLogout,
}: AppTopbarProps) {
  const pathname = usePathname();
  const activeAdminHref = showAdminNav ? resolveActiveAdminHref(pathname, adminNavActivePath) : undefined;

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
          <SessionActivityGuard variant="chip" />
          <SiteNoticeCenter />
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
      {showAdminNav ? (
        <nav className="topbar-admin-nav" aria-label="관리자 하위 메뉴">
          {ADMIN_TOPBAR_LINKS.map((link) => {
            const active = activeAdminHref === link.href;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`topbar-admin-link ${active ? "is-active" : ""}`}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </header>
  );
}
