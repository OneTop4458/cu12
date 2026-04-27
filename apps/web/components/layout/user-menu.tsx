import { ChevronDown, LayoutDashboard, LogOut, Settings, ShieldCheck, UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="user-menu-trigger" type="button" variant="outline" size="lg">
          <Avatar size="sm" className="user-menu-avatar" aria-hidden="true">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="user-menu-meta">
            <span className="user-menu-email">{email}</span>
            <span className="user-menu-role">
              <ShieldCheck size={12} />
              <span>
                {role === "ADMIN" ? "관리자" : "일반 사용자"}
                {impersonating ? " (대리 접속)" : ""}
              </span>
            </span>
          </span>
          <ChevronDown size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="user-menu-content w-64"
        align="end"
        sideOffset={10}
        collisionPadding={8}
        avoidCollisions
      >
        <DropdownMenuLabel className="user-menu-label">
          <UserRound size={16} />
          <span>사용자 메뉴</span>
        </DropdownMenuLabel>
        {onDashboard ? (
          <DropdownMenuItem className="user-menu-item" onSelect={onDashboard}>
            <LayoutDashboard size={16} />
            <span>대시보드</span>
          </DropdownMenuItem>
        ) : null}
        {role === "ADMIN" && onGoAdmin ? (
          <DropdownMenuItem className="user-menu-item" onSelect={onGoAdmin}>
            <ShieldCheck size={16} />
            <span>관리자 화면</span>
          </DropdownMenuItem>
        ) : null}
        {onOpenSettings ? (
          <DropdownMenuItem className="user-menu-item" onSelect={onOpenSettings}>
            <Settings size={16} />
            <span>설정</span>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator className="user-menu-separator" />
        <DropdownMenuItem className="user-menu-item danger" onSelect={onLogout} variant="destructive">
          <LogOut size={16} />
          <span>로그아웃</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
