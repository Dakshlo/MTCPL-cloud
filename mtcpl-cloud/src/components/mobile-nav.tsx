import Link from "next/link";
import type { AppRole } from "@/lib/types";

type NavItem = { href: string; label: string; icon: string; roles: AppRole[] };

const items: NavItem[] = [
  { href: "/dashboard",   label: "Home",      icon: "◈", roles: ["developer","owner"] },
  { href: "/blocks",      label: "Blocks",    icon: "▣", roles: ["developer","owner","team_head","block_slab_entry","block_entry"] },
  { href: "/slabs",       label: "Req. Sizes", icon: "▤", roles: ["developer","owner","team_head","slab_entry","block_slab_entry"] },
  { href: "/slabs/view",  label: "Plan Gen",  icon: "⌘", roles: ["developer","owner","team_head"] },
  { href: "/cutting",     label: "Cutting",   icon: "✂", roles: ["developer","owner","cutting_operator","team_head"] },
  { href: "/slabs/ready", label: "Ready",      icon: "✦", roles: ["developer","owner","team_head","slab_entry","block_slab_entry"] },
];

export function MobileNav({ role, displayName }: { role: AppRole; displayName?: string }) {
  let visible = items.filter(i => i.roles.includes(role));

  // Name-based override: Rajesh (team_head in DB) and Naresh still
  // get Dashboard. Mirrors the desktop sidebar logic.
  const upperName = (displayName ?? "").toUpperCase();
  const isNamedTrustedUser = upperName.includes("RAJESH") || upperName.includes("NARESH");
  if (isNamedTrustedUser && !visible.some((i) => i.href === "/dashboard")) {
    const dashboardItem = items.find((i) => i.href === "/dashboard");
    if (dashboardItem) visible = [dashboardItem, ...visible];
  }

  return (
    <nav className="mobile-bottom-nav">
      {visible.map(item => (
        <Link key={item.href} href={item.href} className="mobile-nav-item">
          <span className="mobile-nav-icon">{item.icon}</span>
          <span className="mobile-nav-label">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
