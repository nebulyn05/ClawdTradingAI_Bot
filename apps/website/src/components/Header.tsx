"use client";

import { useEffect, useState } from "react";

const NAV_LINKS: { href: string; label: string }[] = [
  { href: "#flow", label: "Workflow" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#faq", label: "FAQ" },
  { href: "/docs", label: "Docs" },
];

const TELEGRAM_URL = "https://t.me/ClawdTradingAI_Bot?start=r_website";

export function Header() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="fixed top-4 left-4 right-4 z-[70] flex items-center justify-between gap-4">
      <a href="/" className="flex items-center gap-2.5 rounded-full border border-white/10 bg-[#0e0b12]/80 pl-2 pr-4 py-1.5 text-sm font-semibold text-foreground backdrop-blur-md">
        <img src="/Cryptologos/clawd-logo.webp" alt="Clawd Agents" width={28} height={28} className="rounded-full" />
        Clawd Agents
      </a>

      <nav className="hidden md:flex items-center gap-1 rounded-full border border-white/10 bg-[#0e0b12]/80 px-2 py-1.5 backdrop-blur-md">
        {NAV_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="rounded-full px-3.5 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-white/10 hover:text-foreground"
          >
            {link.label}
          </a>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        <a
          href={TELEGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:inline-flex items-center gap-2 rounded-full bg-[#E8614D] px-4 py-2 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
        >
          Open Telegram bot
        </a>

        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
          className="md:hidden inline-flex items-center justify-center rounded-full border border-white/10 bg-[#0e0b12]/80 p-2.5 text-foreground backdrop-blur-md"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      {open && (
        <div className="md:hidden absolute top-14 right-0 w-56 rounded-2xl border border-white/10 bg-[#0e0b12]/95 p-2 backdrop-blur-md shadow-xl">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block rounded-xl px-3.5 py-2.5 text-sm text-foreground/80 transition-colors hover:bg-white/10 hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="mt-1 block rounded-xl bg-[#E8614D] px-3.5 py-2.5 text-center text-sm font-semibold text-white"
          >
            Open Telegram bot
          </a>
        </div>
      )}
    </div>
  );
}
