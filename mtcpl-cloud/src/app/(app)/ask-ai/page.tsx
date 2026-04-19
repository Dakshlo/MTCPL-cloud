import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { AskAiChat } from "@/components/ask-ai-chat";

export default async function AskAiPage() {
  const { profile } = await requireAuth(["owner", "developer"]);

  return (
    <section className="page-card" style={{ maxWidth: 780, margin: "0 auto" }}>
      <div style={{ marginBottom: 18 }}>
        <Link href="/dashboard" style={{ color: "var(--muted)", textDecoration: "none", fontSize: 13, fontWeight: 500 }}>
          ← Back to Dashboard
        </Link>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>✨ Ask AI</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Ask anything about blocks, slabs, cutting, or planning — in English or Hindi.
        </p>
      </div>

      <AskAiChat userName={profile.full_name || "there"} />
    </section>
  );
}
