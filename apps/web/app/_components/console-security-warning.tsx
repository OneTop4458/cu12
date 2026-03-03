"use client";

import { useEffect, useRef } from "react";

const ALERT_BANNER = "%c[SECURITY ALERT]";

const ALERT_MESSAGE =
  "%cThis browser console is a privileged security surface.\n\n" +
  "Pasting or running unknown commands here can cause full account compromise.\n\n" +
  "Do not paste code from unknown sources.\n" +
  "If someone asks you to run a command here, stop and verify it in a trusted location first.\n\n" +
  "Keep this strict: only execute what you wrote and understand.";

function getConsoleStyles() {
  const isDark =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

  return isDark
    ? {
        title:
          "color:#f97316;font-size:36px;line-height:1.2;font-weight:800;font-family:ui-sans-serif,system-ui,sans-serif;letter-spacing:-0.02em;",
        body:
          "color:#f2f7ff;font-size:14px;font-weight:600;line-height:1.55;font-family:ui-sans-serif,system-ui,sans-serif;",
      }
    : {
        title:
          "color:#b91c1c;font-size:36px;line-height:1.2;font-weight:800;font-family:ui-sans-serif,system-ui,sans-serif;letter-spacing:-0.02em;",
        body:
          "color:#1f2937;font-size:14px;font-weight:500;line-height:1.5;font-family:ui-sans-serif,system-ui,sans-serif;max-width:70ch;",
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
