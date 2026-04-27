import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { getServerActiveSession } from "@/lib/session-user";
import { LoginForm } from "./login-form";
import { LoginNotices } from "./login-notices";

const COPY = {
  brandMark: "시스템 문의: byungjun4458@catholic.ac.kr",
  title: "가톨릭대학교 수강 지원 솔루션",
  subtitle: "가톨릭대학교 포털 기반 수강 정보와 학습 일정을 한곳에서 확인합니다.",
  loginTitle: "로그인",
  loginIntro: "가톨릭대학교 포털(트리니티) 계정으로 로그인하세요.",
  navNotice: "공지",
  navFaq: "FAQ",
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
      <header className="auth-public-topbar" aria-label="CU12">
        <Link href={"/login" as Route} className="auth-public-logo">
          <Image
            src="/brand/catholic/logo-wordmark-mobile.png"
            alt="Catholic University logo"
            width={168}
            height={34}
            priority
          />
          <span>CU12 AUTO</span>
        </Link>
        <nav className="auth-public-nav" aria-label="공개 메뉴">
          <Link href={"/notices" as Route}>{COPY.navNotice}</Link>
          <Link href={"/faq" as Route}>{COPY.navFaq}</Link>
        </nav>
      </header>
      <section className="auth-stage">
        <section className="auth-brand" aria-label="서비스 소개">
          <Image
            src="/brand/catholic/cuk-campus-hero.png"
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 58vw, 100vw"
            className="auth-brand-image"
          />
          <div className="auth-brand-copy">
            <Image
              src="/brand/catholic/logo-wordmark.png"
              alt="Catholic University logo"
              width={300}
              height={72}
              className="brand-wordmark"
            />
            <p className="brand-kicker">Catholic University Automation</p>
            <h1>{COPY.title}</h1>
            <p>{COPY.subtitle}</p>
            <p className="brand-mark">{COPY.brandMark}</p>
          </div>
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
