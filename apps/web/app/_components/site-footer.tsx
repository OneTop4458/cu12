import Link from "next/link";
import type { Route } from "next";
import { getPolicyProfileForAdmin } from "@/server/policy";

function normalizeValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function SiteFooter() {
  const profile = process.env.DATABASE_URL
    ? await getPolicyProfileForAdmin().catch(() => null)
    : null;
  const companyName = normalizeValue(profile?.companyName) ?? "CU12 AUTO";
  const supportEmail = normalizeValue(profile?.supportEmail);
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer" role="contentinfo">
      <div className="site-footer-inner">
        <p className="site-footer-copy">&copy; {year} {companyName}. All rights reserved.</p>
        <div className="site-footer-meta">
          <span>운영주체: {companyName}</span>
          {supportEmail ? (
            <a href={`mailto:${supportEmail}`}>문의: {supportEmail}</a>
          ) : (
            <span>문의: 관리자에게 문의해 주세요.</span>
          )}
        </div>
        <nav className="site-footer-links" aria-label="정책 문서">
          <Link href={"/privacy" as Route}>개인정보처리방침</Link>
          <span aria-hidden="true">|</span>
          <Link href={"/terms" as Route}>이용약관</Link>
        </nav>
      </div>
    </footer>
  );
}
