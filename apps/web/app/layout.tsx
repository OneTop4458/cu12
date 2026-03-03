import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CU12 자동화 콘솔",
  description: "가톨릭 공유대 수강 현황 모니터링 및 자동 수강 서비스",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}