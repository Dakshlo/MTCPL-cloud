"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Language } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import type { AppRole, NavItem } from "@/lib/types";

const navItems: NavItem[] = [
  { href: "/dashboard", label: "dashboard", roles: ["owner", "planner"] },
  { href: "/blocks", label: "blocks", roles: ["owner", "planner", "block_entry"] },
  { href: "/slabs", label: "slabs", roles: ["owner", "planner", "slab_entry"] },
  { href: "/planning", label: "planning", roles: ["owner", "planner"] },
  { href: "/cutting", label: "cutting", roles: ["owner", "worker"] }
];

export function Sidebar({ role, displayName, lang }: { role: AppRole; displayName?: string; lang: Language }) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo-wrap">
          <Image src="/logo-light.png" alt="MTCPL" width={160} height={52} className="sidebar-logo" />
        </div>
        <p className="sidebar-caption">{displayName || "MTCPL User"}</p>
        <span className="sidebar-role">{t(lang, role)}</span>
      </div>

      <nav className="nav-stack">
        {navItems
          .filter((item) => item.roles.includes(role))
          .map((item) => (
            <Link
              className={`nav-link${pathname === item.href ? " nav-link-active" : ""}`}
              href={item.href}
              key={item.href}
            >
              {t(lang, item.label as keyof typeof LABELS)}
            </Link>
          ))}
      </nav>
    </aside>
  );
}

const LABELS = {
  dashboard: "",
  blocks: "",
  slabs: "",
  planning: "",
  cutting: ""
} as const;
