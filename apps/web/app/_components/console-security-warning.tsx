"use client";

import { useEffect, useRef } from "react";

const ALERT_BANNER = "%c[🚨 CRITICAL SECURITY WARNING]";

const ALERT_MESSAGE =
  "%c이 콘솔은 브라우저 권한으로 동작하며 세션·쿠키·토큰에 접근할 수 있습니다.\n" +
  "이곳에 익명 코드나 출처를 확인하지 않은 스니펫을 붙여 넣으면 계정 탈취, 데이터 변경/삭제, 명령 실행이 즉시 발생할 수 있습니다.\n\n" +
  "Paste only code you wrote and fully understand. Never execute unknown snippets.\n" +
  "신원 미확인 코드·크롬 콘솔 확장 기능·자동화 스크립트는 즉시 중단하고 브라우저를 닫아주세요.\n\n" +
  "If this message is unexpected, close this console now and contact platform admin/security immediately.";

function getConsoleStyles() {
  const isDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

  return {
    title:
      "color:#ff2f2f;font-size:38px;line-height:1.12;font-weight:900;letter-spacing:0.01em;font-family: ui-sans-serif,ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;text-shadow:0 10px 25px color-mix(in oklab, var(--danger, #ff2f2f) 45%, transparent);max-width:95ch;",
    body: isDark
      ? "color:#d9e2ff;font-size:14px;line-height:1.7;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:95ch;"
      : "color:#111827;font-size:14px;line-height:1.66;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:95ch;",
  };
}

function printConsoleWarning() {
  const styles = getConsoleStyles();
  console.log(ALERT_BANNER, styles.title);
  console.log(ALERT_MESSAGE, styles.body);
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
      if (
        event.key === "F12" ||
        ((event.ctrlKey || event.metaKey) && event.shiftKey && ["I", "J", "C", "K"].includes(event.key.toUpperCase()))
      ) {
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
