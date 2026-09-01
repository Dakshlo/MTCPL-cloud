"use client";

/**
 * Put one archived bill back into the accounts (mig 226). Developer
 * only — the server action checks the role again.
 *
 * No OTP and no confirm dialog here, deliberately: restoring cannot
 * lose anything. The dangerous direction is archiving, and that is the
 * direction that carries the code.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreBillAction } from "../bill-archive-actions";

export function RestoreBillButton({ billId, token }: { billId: string; token: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {err && <span style={{ fontSize: 11.5, color: "#b91c1c", fontWeight: 700 }}>{err}</span>}
      <button
        type="button"
        title={`Put ${token} back into the accounts`}
        onClick={() =>
          start(async () => {
            setErr(null);
            const r = await restoreBillAction(billId);
            if (!r.ok) { setErr(r.error); return; }
            router.refresh();
          })
        }
        disabled={pending}
        style={{
          padding: "7px 13px",
          fontSize: 12,
          fontWeight: 800,
          borderRadius: 9,
          border: "none",
          background: "#15803d",
          color: "#fff",
          cursor: pending ? "wait" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {pending ? "Restoring…" : "Restore"}
      </button>
    </div>
  );
}
