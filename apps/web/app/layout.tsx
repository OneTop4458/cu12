import "./globals.css";
import type { Metadata } from "next";
import { ConsoleSecurityWarning } from "./_components/console-security-warning";
import { SessionActivityGuard } from "./_components/session-activity-guard";

export const metadata: Metadata = {
  title: "CU12 Automation",
  description: "가톨릭 공유대 수강 상태 확인 및 자동 수강 서비스",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <SessionActivityGuard />
        <ConsoleSecurityWarning />
        {children}
      </body>
    </html>
  );
}

