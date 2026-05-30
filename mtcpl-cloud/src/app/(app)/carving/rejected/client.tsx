"use client";

/**
 * Mig 080 — Carving Rejected client. Renders the rejected list with
 * lazy signed-URL image fetches per row. Kept tiny on purpose; the
 * server page does all the data hydration so this just walks the
 * array and paints each row.
 */

import { useEffect, useState } from "react";
import { getSignedReviewMediaUrl } from "../actions";

export type RejectedItem = {
  id: string;
  slab_id: string;
  vendor_name: string | null;
  reviewer_name: string | null;
  rejected_at: string | null;
  image_path: string | null;
  notes: string | null;
  slab: {
    label: string | null;
    temple: string;
    stone: string | null;
    length_in: number;
    width_in: number;
    thickness_in: number;
  } | null;
};

function dimStr(s: RejectedItem["slab"]): string {
  if (!s) return "—";
  return `${s.length_in}×${s.width_in}×${s.thickness_in}″`;
}

export function CarvingRejectedClient({ items }: { items: RejectedItem[] }) {
  if (items.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          textAlign: "center",
          color: "var(--muted)",
          fontSize: 13,
        }}
      >
        No rejected carvings. 🎉
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {items.map((it) => (
        <RejectedRow key={it.id} item={it} />
      ))}
    </div>
  );
}

function RejectedRow({ item }: { item: RejectedItem }) {
  return (
    <div
      style={{
        padding: 14,
        background: "rgba(220,38,38,0.05)",
        border: "1.5px solid rgba(220,38,38,0.4)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontFamily: "ui-monospace, monospace",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {item.slab_id}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "2px 7px",
                borderRadius: 999,
                background: "rgba(220,38,38,0.18)",
                color: "#b91c1c",
                border: "1px solid rgba(220,38,38,0.45)",
                letterSpacing: "0.05em",
              }}
            >
              ✗ REJECTED
            </span>
          </div>
          {item.slab && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              {item.slab.temple} · {dimStr(item.slab)}
              {item.slab.stone ? ` · ${item.slab.stone}` : ""}
            </div>
          )}
          {item.slab?.label && (
            <div
              style={{
                fontSize: 12,
                color: "var(--text)",
                marginTop: 3,
                fontWeight: 600,
                wordBreak: "break-word",
              }}
              title="Slab label (set at cut time)"
            >
              🏷 {item.slab.label}
            </div>
          )}
          <div
            style={{
              fontSize: 11,
              color: "var(--muted)",
              marginTop: 6,
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            {item.vendor_name && <span>Vendor: <strong style={{ color: "var(--text)" }}>{item.vendor_name}</strong></span>}
            {item.reviewer_name && <span>Reviewer: <strong style={{ color: "var(--text)" }}>{item.reviewer_name}</strong></span>}
            {item.rejected_at && (
              <span>
                Rejected: <strong style={{ color: "var(--text)" }}>{new Date(item.rejected_at).toLocaleString()}</strong>
              </span>
            )}
          </div>
        </div>
      </div>

      {item.notes && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            padding: "10px 12px",
            borderRadius: 8,
            fontSize: 13,
            color: "var(--text)",
            lineHeight: 1.5,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 5,
            }}
          >
            Reviewer's reason
          </div>
          {item.notes}
        </div>
      )}

      <SignedImage path={item.image_path} alt="Rejection photo" />
    </div>
  );
}

function SignedImage({ path, alt }: { path: string | null; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!path) return;
    (async () => {
      try {
        const signed = await getSignedReviewMediaUrl(path);
        if (!cancelled) setUrl(signed);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) {
    return (
      <span
        style={{
          fontSize: 11,
          padding: "3px 8px",
          borderRadius: 999,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          color: "var(--muted)",
          alignSelf: "flex-start",
        }}
      >
        📷 no photo
      </span>
    );
  }
  if (err) {
    return (
      <span
        style={{
          fontSize: 11,
          padding: "3px 8px",
          borderRadius: 999,
          background: "rgba(220,38,38,0.1)",
          border: "1px solid rgba(220,38,38,0.4)",
          color: "#b91c1c",
          alignSelf: "flex-start",
        }}
        title={err}
      >
        ⚠ photo load failed
      </span>
    );
  }
  if (!url) {
    return (
      <span
        style={{
          fontSize: 11,
          padding: "3px 8px",
          borderRadius: 999,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          color: "var(--muted)",
          alignSelf: "flex-start",
        }}
      >
        Loading photo…
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      style={{
        maxWidth: "100%",
        maxHeight: 280,
        borderRadius: 8,
        border: "1px solid var(--border)",
        objectFit: "contain",
        background: "rgba(0,0,0,0.04)",
        alignSelf: "flex-start",
      }}
    />
  );
}
