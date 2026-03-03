"use client";

import { useEffect, useRef } from "react";

function printConsoleWarning() {
  console.log(
    "%c⚠️  STOP",
    "color:#d10000;font-size:48px;font-weight:800;line-height:1.2;font-family:ui-sans-serif,system-ui,sans-serif;",
  );
  console.log(
    "%cThis is the browser console. If someone asks you to copy-paste code here, it can steal your account or run malware.",
    "color:#111827;font-size:14px;font-weight:600;font-family:ui-sans-serif,system-ui,sans-serif;",
  );
  console.log(
    "%c브라우저 콘솔은 개발자 도구 용도로만 사용하세요. 직접 내용이 명확한 코드만 입력하세요.",
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
