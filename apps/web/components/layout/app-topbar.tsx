"use client";

import Image from "next/image";
import { ActivityCenter } from "../notifications/activity-center";
import { SessionActivityGuard } from "../../app/_components/session-activity-guard";
import { SiteNoticeCenter } from "./site-notice-center";
import { UserMenu } from "./user-menu";

type RoleType = "ADMIN" | "USER";

type AppTopbarProps = {
  id?: string;
  title: string;
  kicker?: string;
  email: string;
  role: RoleType;
  impersonating?: boolean;
  onDashboard?: () => void;
  onGoAdmin?: () => void;
  onOpenSettings?: () => void;
  onLogout: () => void;
};

export function AppTopbar({
  id,
  title,
  kicker = "Catholic University Automation",
  email,
  role,
  impersonating = false,
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
    </header>
  );
}
