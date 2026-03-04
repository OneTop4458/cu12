import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, LayoutDashboard, LogOut, Settings, ShieldCheck, UserRound } from "lucide-react";

type RoleType = "ADMIN" | "USER";

type UserMenuProps = {
  email: string;
  role: RoleType;
  impersonating: boolean;
  onDashboard?: () => void;
  onGoAdmin?: () => void;
  onOpenSettings?: () => void;
  onLogout: () => void;
};

export function UserMenu({
  email,
  role,
  impersonating,
  onDashboard,
  onGoAdmin,
  onOpenSettings,
  onLogout,
}: UserMenuProps) {
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="user-menu-trigger" type="button">
          <span className="user-menu-avatar" aria-hidden="true">
            {initials}
          </span>
          <span className="user-menu-meta">
            <span className="user-menu-email">{email}</span>
            <span className="user-menu-role">
              <ShieldCheck size={12} />
              <span>
                {role === "ADMIN" ? "관리자" : "일반 사용자"}
                {impersonating ? " (대리접속)" : ""}
              </span>
            </span>
          </span>
          <ChevronDown size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="user-menu-content"
          align="end"
          sideOffset={10}
          collisionPadding={8}
          avoidCollisions
        >
          <DropdownMenu.Label className="user-menu-label">
            <UserRound size={16} />
            <span>사용자 메뉴</span>
          </DropdownMenu.Label>
          {onDashboard ? (
            <DropdownMenu.Item className="user-menu-item" onSelect={onDashboard}>
              <LayoutDashboard size={16} />
              <span>대시보드</span>
            </DropdownMenu.Item>
          ) : null}
          {role === "ADMIN" && onGoAdmin ? (
            <DropdownMenu.Item className="user-menu-item" onSelect={onGoAdmin}>
              <ShieldCheck size={16} />
              <span>관리자 센터</span>
            </DropdownMenu.Item>
          ) : null}
          {onOpenSettings ? (
            <DropdownMenu.Item className="user-menu-item" onSelect={onOpenSettings}>
              <Settings size={16} />
              <span>설정</span>
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Separator className="user-menu-separator" />
          <DropdownMenu.Item className="user-menu-item danger" onSelect={onLogout}>
            <LogOut size={16} />
            <span>로그아웃</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
