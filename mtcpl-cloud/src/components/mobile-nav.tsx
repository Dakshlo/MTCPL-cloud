import Link from "next/link";
import type { AppRole } from "@/lib/types";

type NavItem = { href: string; label: string; icon: string; roles: AppRole[] };

const items: NavItem[] = [
  { href: "/dashboard",   label: "Home",     icon: "◈", roles: ["developer","owner","planner","block_entry","slab_entry","worker","carving_assigner","dispatch","vendor"] },
  { href: "/blocks",      label: "Blocks",   icon: "▣", roles: ["developer","owner","planner","block_entry","slab_entry"] },
  { href: "/slabs",       label: "Slabs",    icon: "▤", roles: ["developer","owner","planner","slab_entry","block_entry"] },
  { href: "/planning",    label: "Plan",     icon: "⌘", roles: ["developer","owner","planner"] },
  { href: "/cutting",     label: "Cutting",  icon: "◌", roles: ["developer","owner","worker","planner"] },
  { href: "/slabs/ready", label: "Ready",    icon: "✦", roles: ["developer","owner","planner","slab_entry","block_entry"] },
  { href: "/settings",    label: "Settings", icon: "⚙", roles: ["developer","owner","planner"] },
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
