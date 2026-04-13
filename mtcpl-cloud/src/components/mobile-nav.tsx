import Link from "next/link";
import type { AppRole } from "@/lib/types";

type NavItem = { href: string; label: string; icon: string; roles: AppRole[] };

const items: NavItem[] = [
  { href: "/dashboard",   label: "Home",     icon: "◈", roles: ["developer","owner","team_head","block_slab_entry","slab_entry","carving_assigner","dispatch","vendor"] },
  { href: "/blocks",      label: "Blocks",   icon: "▣", roles: ["developer","owner","team_head","block_slab_entry","block_entry"] },
  { href: "/slabs",       label: "Slabs",    icon: "▤", roles: ["developer","owner","team_head","slab_entry","block_slab_entry"] },
  { href: "/planning",    label: "Plan",     icon: "⌘", roles: ["developer","owner","team_head"] },
  { href: "/cutting",     label: "Cutting",  icon: "◌", roles: ["developer","owner","cutting_operator","team_head"] },
  { href: "/slabs/ready", label: "Ready",    icon: "✦", roles: ["developer","owner","team_head","slab_entry","block_slab_entry"] },
  { href: "/settings",    label: "Settings", icon: "⚙", roles: ["developer","owner","team_head"] },
];

export function MobileNav({ role }: { role: AppRole }) {
  const visible = items.filter(i => i.roles.includes(role));
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
