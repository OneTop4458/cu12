import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CU12 Automation Console",
  description: "Catholic Shared University course monitor and auto-learning service",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
