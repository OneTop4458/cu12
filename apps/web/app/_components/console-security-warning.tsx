"use client";

import { useEffect, useRef } from "react";

function printConsoleWarning() {
  console.log(
    "%cStop!",
    "color:#d10000;font-size:48px;font-weight:800;line-height:1.2;font-family:ui-sans-serif,system-ui,sans-serif;",
  );
  console.log(
    "%c이 콘솔에 코드를 붙여넣으라는 요청은 계정 탈취(Self-XSS) 시도일 수 있습니다. Never paste code you don't understand.",
    "color:#111827;font-size:14px;font-weight:600;font-family:ui-sans-serif,system-ui,sans-serif;",
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

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  return null;
}
