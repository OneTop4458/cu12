"use client";

import type { Route } from "next";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "../ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";

type AppMobileNavProps = {
  mode: "dashboard" | "admin";
  includeAdmin?: boolean;
};

const dashboardItems: Array<{ href: string; label: string }> = [
  { href: "/dashboard#overview", label: "개요" },
  { href: "/dashboard#sync", label: "동기화" },
  { href: "/dashboard#jobs", label: "작업 상태" },
  { href: "/dashboard#deadlines", label: "마감" },
  { href: "/dashboard#courses", label: "강좌" },
  { href: "/notices", label: "공지" },
  { href: "/maintenance", label: "점검 안내" },
];

const adminItems: Array<{ href: string; label: string }> = [
  { href: "/admin", label: "운영 관리센터" },
  { href: "/admin/site-notices", label: "공지/점검 관리" },
  { href: "/admin/system", label: "시스템 상태" },
  { href: "/admin/operations", label: "운영 도구" },
  { href: "/dashboard", label: "대시보드" },
];

export function AppMobileNav({ mode, includeAdmin = false }: AppMobileNavProps) {
  const items = mode === "admin" ? adminItems : dashboardItems;
  const title = mode === "admin" ? "관리자 메뉴" : "대시보드 메뉴";

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button className="mobile-nav-trigger" type="button" variant="outline" size="icon" aria-label={title}>
          <Menu size={17} />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="app-mobile-sheet">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>필요한 화면으로 바로 이동합니다.</SheetDescription>
        </SheetHeader>
        <nav className="app-mobile-nav-list" aria-label={title}>
          {items.map((item) => (
            <SheetClose asChild key={item.href}>
              <Link href={item.href as Route} className="app-mobile-nav-link">
                {item.label}
              </Link>
            </SheetClose>
          ))}
          {mode === "dashboard" && includeAdmin ? (
            <SheetClose asChild>
              <Link href={"/admin" as Route} className="app-mobile-nav-link">
                관리자
              </Link>
            </SheetClose>
          ) : null}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
