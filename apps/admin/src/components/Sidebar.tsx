"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logoutAction } from "@/lib/actions";
import { hasRole, type AdminSession } from "@/lib/roles";

interface NavLink { href: string; label: string; icon: string; }
interface NavGroup { title: string; links: NavLink[]; }

const GROUPS: NavGroup[] = [
  { title: "Dashboard", links: [
    { href: "/", label: "Overview", icon: "◈" },
    { href: "/activity", label: "Activity", icon: "◷" },
  ]},
  { title: "Trading", links: [
    { href: "/users", label: "Users & Wallets", icon: "◎" },
    { href: "/positions", label: "Positions & Trades", icon: "▣" },
    { href: "/performance", label: "Performance", icon: "↗" },
    { href: "/trade", label: "Manual Trade", icon: "⚡" },
    { href: "/rules", label: "Rules", icon: "◇" },
    { href: "/nudges", label: "Nudges", icon: "◉" },
  ]},
  { title: "System", links: [
    { href: "/guard-drift", label: "Guard Drift", icon: "◈" },
    { href: "/audit-log", label: "Audit Log", icon: "⌁" },
    { href: "/environment", label: "Environment", icon: "⌘" },
    { href: "/settings", label: "Settings", icon: "⚙" },
  ]},
];

const ROLE_LABEL: Record<AdminSession["role"], string> = {
  super_admin: "Super Admin", operator: "Operator", analyst: "Analyst",
};
const ROLE_BADGE: Record<AdminSession["role"], string> = {
  super_admin: "bg-accent/20 text-accent border-accent/20",
  operator: "bg-blue-500/15 text-blue-300 border-blue-400/20",
  analyst: "bg-white/10 text-white/60 border-white/10",
};

export function Sidebar({ session }: { session: AdminSession }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const groups = hasRole(session.role, "super_admin")
    ? [...GROUPS, { title: "Administration", links: [{ href: "/admins", label: "Admin Accounts", icon: "♙" }] }]
    : GROUPS;

  const navigation = (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-lg shadow-[0_0_30px_rgba(139,92,246,0.12)]">🦞</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold tracking-tight text-white">Clawd Agents</div>
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/35">Control Center</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
        {groups.map((group) => (
          <div key={group.title}>
            <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/30">{group.title}</div>
            <div className="space-y-1">
              {group.links.map((link) => {
                const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${
                      active ? "bg-accent/12 font-semibold text-white shadow-[inset_3px_0_0_#8b5cf6]" : "text-white/55 hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    <span className={`flex w-5 justify-center text-sm ${
                      active ? "text-accent" : "text-white/35 group-hover:text-white/70"
                    }`}>{link.icon}</span>
                    <span>{link.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border bg-black/10 px-4 py-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">
            {session.username.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-white/85">{session.username}</div>
            <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${ROLE_BADGE[session.role]}`}>
              {ROLE_LABEL[session.role]}
            </span>
          </div>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="btn btn-secondary w-full">Log out</button>
        </form>
      </div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-[#0c0912]/90 px-4 backdrop-blur-xl md:hidden">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15">🦞</div>
          <div>
            <div className="text-sm font-bold text-white">Clawd Agents</div>
            <div className="text-[9px] uppercase tracking-[0.14em] text-white/35">Admin</div>
          </div>
        </div>
        <button
          type="button"
          aria-label={open ? "Close navigation" : "Open navigation"}
          onClick={() => setOpen(!open)}
          className="rounded-lg border border-border bg-white/5 px-3 py-2 text-white/80"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {open ? <button aria-label="Close navigation" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/60 md:hidden" /> : null}
      <aside className={`fixed inset-y-0 left-0 z-50 w-[280px] border-r border-border bg-[#0e0a15] shadow-2xl transition-transform duration-200 md:sticky md:top-0 md:z-20 md:flex md:h-screen md:w-64 md:shrink-0 md:translate-x-0 md:shadow-none ${open ? "translate-x-0" : "-translate-x-full"}`}>
        {navigation}
      </aside>
    </>
  );
}
