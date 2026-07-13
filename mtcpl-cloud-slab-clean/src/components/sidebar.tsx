import Link from "next/link";

import type { AppRole, NavItem } from "@/lib/types";
import type { Language } from "@/lib/i18n";
import { t } from "@/lib/i18n";

const navItems: NavItem[] = [
  { href: "/dashboard", label: "dashboard", roles: ["owner", "office", "dispatch"] },
  { href: "/slabs", label: "slabs", roles: ["owner", "office"] },
  { href: "/slab-viewer", label: "slabViewer", roles: ["owner", "office", "assigner", "dispatch"] },
  { href: "/carving-assign", label: "assignVendor", roles: ["owner", "assigner"] },
  { href: "/carving", label: "carving", roles: ["owner", "vendor"] },
  { href: "/approval", label: "approval", roles: ["owner", "office"] },
  { href: "/dispatch", label: "dispatchBoard", roles: ["owner", "dispatch"] },
  { href: "/settings", label: "settings", roles: ["owner"] }
];

export function Sidebar({ role, displayName, lang }: { role: AppRole; displayName?: string; lang: Language }) {
  const title = role === "vendor" && displayName ? displayName : "MTCPL Cloud Slab Clean";
  const subtitle = role === "vendor" ? t(lang, "vendorWorkspace") : "Fresh slab-to-carving rebuild";

  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">SC</div>
        <div>
          <strong>{title}</strong>
          <p>{subtitle}</p>
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
    slabs: "",
    slabViewer: "",
    assignVendor: "",
    carving: "",
    approval: "",
    dispatchBoard: "",
    settings: ""
  };
}
