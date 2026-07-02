"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (production only, so it never interferes with
 * dev hot-reload). Renders nothing.
 */
export function PWARegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration is best-effort */
      });
    };
    // The effect usually runs after `load` has already fired, so register now;
    // only defer if the document is somehow still loading.
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
