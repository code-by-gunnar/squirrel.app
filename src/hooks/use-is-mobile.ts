"use client";

import { useEffect, useState } from "react";

/**
 * True on viewports below Tailwind's `sm` breakpoint (640px). SSR-safe: returns
 * `false` on the server and until mounted, then reflects the live viewport.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isMobile;
}
