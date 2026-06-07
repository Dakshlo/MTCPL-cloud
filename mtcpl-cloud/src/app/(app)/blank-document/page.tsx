import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Personal/owner tool — owner + developer only.
const ALLOWED = ["owner", "developer"];

export default async function BlankDocumentPage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/dashboard");

  return (
    <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 16, paddingBottom: 32 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>📄 Blank company document</h1>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
          A printable MTCPL letterhead with the standard terms and a vendor signature line — blank in the
          middle so you can fill it in by hand for any vendor dealing. Not connected to any system record.
        </p>
      </div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--muted)", lineHeight: 1.8 }}>
          <li>Company logo + accent rule at the top</li>
          <li>Full address &amp; contact footer at the bottom</li>
          <li>Standard terms (1–6) just above the signature</li>
          <li>A single <strong>Vendor signature</strong> line</li>
          <li>Empty centre — write the slabs / rate / details by hand</li>
        </ul>
        <a
          href="/api/blank-vendor-doc"
          style={{ alignSelf: "flex-start", padding: "11px 22px", fontSize: 14, fontWeight: 800, color: "#fff", background: "var(--gold-dark)", border: "none", borderRadius: 10, textDecoration: "none" }}
        >
          ⬇ Download blank document
        </a>
      </div>
    </div>
  );
}
