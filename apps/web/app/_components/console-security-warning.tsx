"use client";

import { useEffect, useRef } from "react";

const ALERT_BANNER = "%c⚠ SECURITY ALERT";

const ALERT_MESSAGE =
  "%cThis console is a privileged debugging surface.\n" +
  "Pasting untrusted code here can leak your session, account credentials, or sensitive data.\n" +
  "Do not paste anything you did not write yourself.\n\n" +
  "PASTE ONLY what you wrote yourself and completely understand.\n" +
  "If someone told you to run a command, verify it before pasting.\n\n" +
  "Self-XSS protection may require confirmation before code paste.";

function getConsoleStyles() {
  const isDark =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

  return isDark
    ? {
      title:
        "color:#f97316;font-size:34px;line-height:1.2;font-weight:800;font-family:ui-sans-serif,system-ui,sans-serif;letter-spacing:-0.02em;",
      body:
        "color:#e2e8f0;font-size:14px;font-weight:600;line-height:1.55;font-family:ui-sans-serif,system-ui,sans-serif;",
    }
    : {
      title:
        "color:#dc2626;font-size:34px;line-height:1.2;font-weight:800;font-family:ui-sans-serif,system-ui,sans-serif;letter-spacing:-0.02em;",
      body:
        "color:#111827;font-size:14px;font-weight:600;line-height:1.55;font-family:ui-sans-serif,system-ui,sans-serif;",
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
