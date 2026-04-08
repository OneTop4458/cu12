import "./globals.css";
import type { Metadata } from "next";
import { AppThemeProvider } from "../components/theme/theme-provider";
import { ConsoleSecurityWarning } from "./_components/console-security-warning";
import { SessionActivityGuard } from "./_components/session-activity-guard";
import { SiteFooter } from "./_components/site-footer";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "\uAC00\uD1A8\uB9AD\uB300\uD559\uAD50 \uC218\uAC15 \uC9C0\uC6D0 \uC194\uB8E8\uC158",
  description: "\uAC00\uD1A8\uB9AD\uB300\uD559\uAD50 \uC218\uAC15 \uC9C0\uC6D0 \uC194\uB8E8\uC158\uC758 \uB85C\uADF8\uC778, \uC6B4\uC601 \uB300\uC2DC\uBCF4\uB4DC, \uC791\uC5C5 \uB85C\uADF8\uB97C \uD55C \uACF3\uC5D0\uC11C \uAD00\uB9AC\uD569\uB2C8\uB2E4.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AppThemeProvider>
          <div className="session-banner-shell">
            <div className="session-banner-stack">
              <SessionActivityGuard />
              <div id="dashboard-site-notice-host" className="session-notice-host" />
            </div>
          </div>
          <ConsoleSecurityWarning />
          <div className="app-root">{children}</div>
          <SiteFooter />
          <Toaster richColors position="top-right" closeButton />
        </AppThemeProvider>
      </body>
    </html>
  );
}
