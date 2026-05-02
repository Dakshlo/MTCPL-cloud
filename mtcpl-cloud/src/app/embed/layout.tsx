import type { ReactNode } from "react";
import { requireAuth } from "@/lib/auth";

/**
 * Embed-mode layout for routes loaded inside an iframe via the
 * PeekIframe component. Strips out the sidebar / header / mobile
 * nav so the route content fills the iframe cleanly.
 *
 * Auth still required — the embedding page is gated, but the iframe
 * is a separate request and needs its own auth check (otherwise
 * non-logged-in users could brute-force their way to data via
 * /embed/<route>).
 *
 * Currently powers:
 *   /embed/blocks/report    — Block Report inside the /blocks peek
 *   /embed/block-journey    — Block Journey inside the dashboard peek
 */
export default async function EmbedLayout({ children }: { children: ReactNode }) {
  await requireAuth();
  return (
    <div
      className="embed-shell"
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        padding: "20px 24px 40px",
      }}
    >
      {children}
    </div>
  );
}
