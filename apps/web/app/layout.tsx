import "./globals.css";
import type { Metadata } from "next";
import { ConsoleSecurityWarning } from "./_components/console-security-warning";
import { SessionActivityGuard } from "./_components/session-activity-guard";

export const metadata: Metadata = {
  title: "가톨릭대학교 공유대학 수강 지원 솔루션",
  description: "가톨릭대학교 공유대학 수강 지원 솔루션의 로그인, 운영 대시보드, 작업 로그를 한 곳에서 관리합니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <SessionActivityGuard />
        <ConsoleSecurityWarning />
        <div className="app-root">{children}</div>
      </body>
    </html>
  );
}