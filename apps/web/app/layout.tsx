import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CU12 Automation",
  description: "CU12 course monitor and auto-learning service",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
