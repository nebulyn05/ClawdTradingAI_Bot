import Link from "next/link";
import { logoutAction } from "@/lib/actions";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/users", label: "Users & Wallets" },
  { href: "/positions", label: "Positions & Trades" },
  { href: "/trade", label: "Manual Trade" },
  { href: "/rules", label: "Rules" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  return (
    <nav className="flex items-center justify-between border-b border-border px-6 py-4">
      <div className="flex items-center gap-6">
        <span className="font-semibold tracking-tight text-white">Clawd Agents · Admin</span>
        <div className="flex gap-1">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
      <form action={logoutAction}>
        <button type="submit" className="btn btn-secondary">
          Log out
        </button>
      </form>
    </nav>
  );
}
