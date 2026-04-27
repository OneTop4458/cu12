import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { ThemeToggle } from "../../components/theme/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { getServerActiveSession } from "@/lib/session-user";
import { LoginForm } from "./login-form";
import { LoginNotices } from "./login-notices";

const COPY = {
  brandMark: "시스템 문의 : byungjun4458@catholic.ac.kr",
  title: "\uAC00\uD1A8\uB9AD\uB300\uD559\uAD50 \uC218\uAC15 \uC9C0\uC6D0 \uC194\uB8E8\uC158",
  subtitle: "Catholic University Automation \uB85C\uADF8\uC778 \uD398\uC774\uC9C0\uC785\uB2C8\uB2E4.",
  loginTitle: "\uB85C\uADF8\uC778",
  loginIntro: "\uAC00\uD1A8\uB9AD\uB300\uD559\uAD50 \uD3EC\uD138(\uD2B8\uB9AC\uB2C8\uD2F0) \uACC4\uC815\uC73C\uB85C \uB85C\uADF8\uC778\uD558\uC138\uC694.",
} as const;

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ reason?: string | string[] }> | { reason?: string | string[] };
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const reasonRaw = resolvedSearchParams?.reason;
  const reason = Array.isArray(reasonRaw) ? reasonRaw[0] : reasonRaw;
  const sessionExpiredReason =
    reason === "session-timeout" || reason === "session-expired" ? reason : undefined;

  const session = await getServerActiveSession();
  if (session && !sessionExpiredReason) {
    redirect("/dashboard");
  }

  return (
    <main className="auth-main">
      <div className="auth-toolbar">
        <ThemeToggle />
      </div>
      <section className="auth-stage">
        <section className="auth-brand">
          <img
            src="/brand/catholic/logo-wordmark.png"
            alt="Catholic University logo"
            className="brand-wordmark"
          />
          <h1>{COPY.title}</h1>
          <p className="muted">{COPY.subtitle}</p>
          <p className="brand-mark">{COPY.brandMark}</p>
        </section>

        <Card className="auth-card brand-login">
          <div className="brand-ribbon" />
          <CardHeader className="auth-card-header">
            <CardTitle>{COPY.loginTitle}</CardTitle>
            <CardDescription>{COPY.loginIntro}</CardDescription>
          </CardHeader>
          <CardContent className="auth-card-content">
            <Suspense fallback={null}>
              <LoginNotices />
            </Suspense>
            <LoginForm sessionExpiredReason={sessionExpiredReason} />
            <div className="auth-card-links" aria-label="로그인 도움말">
              <Link href={"/faq" as Route} className="auth-card-link">
                서비스 FAQ 보기
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
