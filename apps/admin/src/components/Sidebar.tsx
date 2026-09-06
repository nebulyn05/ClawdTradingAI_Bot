"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/lib/actions";
import { hasRole, type AdminSession } from "@/lib/roles";

interface NavLink {
  href: string;
  label: string;
  icon: string;
}

interface NavGroup {
  title: string;
  links: NavLink[];
}

const GROUPS: NavGroup[] = [
  {
    title: "Dashboard",
    links: [
      { href: "/", label: "Overview", icon: "📊" },
      { href: "/activity", label: "Activity", icon: "📈" },
    ],
  },
  {
    title: "Trading",
    links: [
      { href: "/users", label: "Users & Wallets", icon: "👤" },
      { href: "/positions", label: "Positions & Trades", icon: "📦" },
      { href: "/performance", label: "Performance", icon: "🏆" },
      { href: "/trade", label: "Manual Trade", icon: "⚡" },
      { href: "/rules", label: "Rules", icon: "⚙️" },
      { href: "/nudges", label: "Nudges", icon: "📣" },
    ],
  },
  {
    title: "System",
    links: [
      { href: "/guard-drift", label: "Guard Drift", icon: "🛡️" },
      { href: "/audit-log", label: "Audit Log", icon: "🔒" },
      { href: "/environment", label: "Environment", icon: "🌐" },
      { href: "/settings", label: "Settings", icon: "🎛️" },
    ],
  },
];

const ROLE_LABEL: Record<AdminSession["role"], string> = {
  super_admin: "Super Admin",
  operator: "Operator",
  analyst: "Analyst",
};

const ROLE_BADGE: Record<AdminSession["role"], string> = {
  super_admin: "bg-accent/20 text-accent",
  operator: "bg-blue-500/20 text-blue-300",
  analyst: "bg-white/10 text-white/60",
};

export function Sidebar({ session }: { session: AdminSession }) {
  const pathname = usePathname();
  const groups = hasRole(session.role, "super_admin")
    ? [...GROUPS, { title: "Admin", links: [{ href: "/admins", label: "Admins", icon: "🗝️" }] }]
    : GROUPS;

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-border bg-panel/60">
      <div className="border-b border-border px-5 py-5">
        <div className="text-sm font-semibold tracking-tight text-white">🦞 Clawd Agents</div>
        <div className="text-xs text-white/40">Admin</div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {groups.map((group) => (
          <div key={group.title}>
            <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
              {group.title}
            </div>
            <div className="space-y-0.5">
              {group.links.map((link) => {
                const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                      active ? "bg-accent/15 font-medium text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span className="text-base leading-none">{link.icon}</span>
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="truncate text-sm text-white/80">{session.username}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_BADGE[session.role]}`}>
            {ROLE_LABEL[session.role]}
          </span>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="btn btn-secondary w-full">
            Log out
          </button>
        </form>
      </div>
    </aside>
  );
}
