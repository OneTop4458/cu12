"use client";

import { useEffect, useRef } from "react";

function getConsoleStyles() {
  const isDark =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

  return isDark
    ? {
      title: "color:#f97316;font-size:34px;line-height:1.2;font-weight:800;font-family:ui-sans-serif,system-ui,sans-serif;",
      body: "color:#e2e8f0;font-size:14px;font-weight:600;line-height:1.5;font-family:ui-sans-serif,system-ui,sans-serif;",
    }
    : {
      title: "color:#b91c1c;font-size:34px;line-height:1.2;font-weight:800;font-family:ui-sans-serif,system-ui,sans-serif;",
      body: "color:#0f172a;font-size:14px;font-weight:600;line-height:1.5;font-family:ui-sans-serif,system-ui,sans-serif;",
    };
}

function printConsoleWarning() {
  const styles = getConsoleStyles();
  console.log("%c🚫 위험 경고", styles.title);
  console.log(
    "%c브라우저 개발자 도구는 시스템 접근 권한을 가진 민감한 환경입니다. 신뢰할 수 없는 코드나 스니펫을 붙여넣지 마세요.\nPaste only commands you wrote/understand.\nThis warning is displayed for security reasons and to prevent account/session token leakage.",
    styles.body,
  );
}

export function ConsoleSecurityWarning() {
  const devtoolsOpenRef = useRef(false);

  useEffect(() => {
    printConsoleWarning();

    const timerId = window.setInterval(() => {
      const widthGap = Math.abs(window.outerWidth - window.innerWidth);
      const heightGap = Math.abs(window.outerHeight - window.innerHeight);
      const nowOpen = widthGap > 160 || heightGap > 160;
      if (nowOpen && !devtoolsOpenRef.current) {
        printConsoleWarning();
      }
      devtoolsOpenRef.current = nowOpen;
    }, 2000);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F12") {
        printConsoleWarning();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearInterval(timerId);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
