import Link from "next/link";

import type { AppRole, NavItem } from "@/lib/types";
import type { Language } from "@/lib/i18n";
import { t } from "@/lib/i18n";

const navItems: NavItem[] = [
  { href: "/dashboard", label: "dashboard", roles: ["owner", "planner", "dispatch"] },
  { href: "/blocks", label: "blocks", roles: ["owner", "planner", "block_entry"] },
  { href: "/slabs", label: "slabs", roles: ["owner", "planner", "slab_entry"] },
  { href: "/planning", label: "planning", roles: ["owner", "planner"] },
  { href: "/cutting", label: "cutting", roles: ["owner", "worker"] },
  { href: "/carving-assign", label: "carvingAssign", roles: ["owner", "carving_assigner"] },
  { href: "/carving", label: "carving", roles: ["owner", "dispatch", "vendor"] },
  { href: "/users", label: "users", roles: ["owner"] }
];

export function Sidebar({ role, displayName, lang }: { role: AppRole; displayName?: string; lang: Language }) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">MC</div>
        <div>
          <strong>{role === "vendor" && displayName ? displayName : "MTCPL Cloud"}</strong>
          <p>{role === "vendor" && displayName ? t(lang, "vendorWorkspace") : t(lang, "sharedWorkflow")}</p>
        </div>
      </div>

      <nav className="nav-stack">
        {navItems
          .filter((item) => item.roles.includes(role))
          .map((item) => (
            <Link className="nav-link" href={item.href} key={item.href}>
              {t(lang, item.label as keyof ReturnType<typeof getLabels>)}
            </Link>
          ))}
      </nav>
    </aside>
  );
}

function getLabels() {
  return {
    dashboard: "",
    blocks: "",
    slabs: "",
    planning: "",
    cutting: "",
    carvingAssign: "",
    carving: "",
    users: ""
  };
}
