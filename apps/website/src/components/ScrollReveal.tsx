"use client";

import { useEffect, useRef } from "react";

/**
 * The original site gated section reveals on a splash intro's state machine
 * that never resolves without a live Next.js server (see CLAUDE.md) — some
 * via the Tailwind `.opacity-0` class, others via an inline
 * `style="opacity:0"` set directly by React state. This replaces both with
 * a plain, real IntersectionObserver: anything still hidden (checked via
 * actual computed opacity, not just class/inline-style presence, so it
 * catches either mechanism) gets faded/slid in the first time it enters the
 * viewport, then stays revealed.
 */
export function ScrollReveal({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const candidates = root.querySelectorAll<HTMLElement>(
      '.opacity-0, [style*="opacity:0"], [style*="opacity: 0"]'
    );
    const targets = Array.from(candidates).filter(
      (el) => getComputedStyle(el).opacity === "0"
    );

    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            el.style.transition = el.style.transition || "opacity 640ms ease-out, transform 640ms ease-out";
            el.style.opacity = "1";
            el.style.transform = "none";
            observer.unobserve(el);
          }
        }
      },
      { threshold: 0, rootMargin: "150px 0px 150px 0px" }
    );

    for (const el of targets) observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return <div ref={containerRef}>{children}</div>;
}
