"use client";

/**
 * Archive a settled bill — owner only, confirmed by a code (mig 226).
 *
 * Only rendered when the bill is fully paid with nothing outstanding
 * and nothing held back, so the owner never sees this on a bill that
 * still owes money. The server re-checks all of that, and so does a
 * CHECK constraint in the database.
 *
 * Two steps on purpose:
 *   1. "Archive this bill" → a 4-digit code is sent to the owner's own
 *      registered number.
 *   2. He types it here.
 *
 * He asked for a code rather than another stack of confirm dialogs, and
 * he was right: a second "are you sure?" is muscle memory within a
 * week, while a code that has to arrive on your phone cannot be clicked
 * through by accident — or by whoever finds the screen unlocked.
 *
 * The panel says plainly that this is reversible and by whom, because
 * an owner who believes he is deleting something permanent behaves
 * differently from one who knows it can be brought back.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CODE_LENGTH } from "@/lib/otp-shape";
import {
  requestBillArchiveOtpAction,
  archiveBillAction,
  restoreBillAction,
} from "../../bill-archive-actions";

export function ArchiveBillPanel({
  billId,
  token,
  canArchive,
}: {
  billId: string;
  token: string;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<"idle" | "code">("idle");
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!canArchive) return null;

  const sendCode = () =>
    start(async () => {
      setErr(null); setMsg(null);
      const r = await requestBillArchiveOtpAction(billId);
      if (!r.ok) { setErr(r.error); return; }
      setMsg(r.message);
      setStage("code");
    });

  const doArchive = () =>
    start(async () => {
      setErr(null); setMsg(null);
      const r = await archiveBillAction(billId, code, reason);
      if (!r.ok) { setErr(r.error); return; }
      // Straight to the vendor list — the bill's own page would now be
      // showing an archived banner, which reads like a failure.
      router.push("/accounts/bills?toast=" + encodeURIComponent(r.message));
      router.refresh();
    });

  return (
    <section className="page-card" style={{ borderColor: "rgba(220,38,38,0.35)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>🗄 Archive this bill</h2>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 8px" }}>
          owner only
        </span>
      </div>
      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.65, marginTop: 8, marginBottom: 12 }}>
        {token} is fully settled. Archiving takes it out of the bill list, out of{" "}
        {"this vendor's"} totals and out of every report — as if it were finished business,
        which it is. <strong>Nothing is deleted:</strong> the payments, vouchers and audit trail
        stay exactly as they are, and the developer can bring the bill back at any time.
      </p>

      {stage === "idle" && (
        <>
          <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>
            Reason (optional)
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. old bill, fully settled"
            style={{ width: "100%", maxWidth: 420, padding: "9px 11px", fontSize: 13, border: "1.5px solid var(--border)", borderRadius: 10, background: "var(--bg)", color: "var(--text)", marginBottom: 12 }}
          />
          <div>
            <button
              type="button"
              onClick={sendCode}
              disabled={pending}
              style={{ padding: "10px 16px", fontSize: 13.5, fontWeight: 800, borderRadius: 10, border: "none", background: "#b91c1c", color: "#fff", cursor: pending ? "wait" : "pointer" }}
            >
              {pending ? "Sending code…" : "Archive this bill →"}
            </button>
          </div>
        </>
      )}

      {stage === "code" && (
        <>
          <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>
            {CODE_LENGTH}-digit code from your phone
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={"–".repeat(CODE_LENGTH)}
              style={{ width: 122, padding: "10px 12px", fontSize: 22, fontWeight: 800, letterSpacing: "0.2em", textAlign: "center", fontFamily: "ui-monospace, monospace", border: "1.5px solid var(--border)", borderRadius: 10, background: "var(--bg)", color: "var(--text)" }}
            />
            <button
              type="button"
              onClick={doArchive}
              disabled={pending || code.length !== CODE_LENGTH}
              style={{ padding: "10px 16px", fontSize: 13.5, fontWeight: 800, borderRadius: 10, border: "none", background: code.length === CODE_LENGTH ? "#b91c1c" : "var(--border)", color: "#fff", cursor: pending ? "wait" : "pointer" }}
            >
              {pending ? "Archiving…" : "Confirm archive"}
            </button>
            <button
              type="button"
              onClick={() => { setStage("idle"); setCode(""); setErr(null); setMsg(null); }}
              disabled={pending}
              style={{ padding: "10px 14px", fontSize: 12.5, fontWeight: 700, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {msg && <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: "#15803d" }}>{msg}</div>}
      {err && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: "#b91c1c", background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, padding: "8px 11px" }}>
          {err}
        </div>
      )}
    </section>
  );
}

/** Shown INSTEAD of everything else when an archived bill is opened
 *  directly — from the audit trail, a bookmark, or the developer's
 *  archive list. The page still works; it just says what it is. */
export function ArchivedBillBanner({
  billId,
  archivedAt,
  archivedBy,
  reason,
  canRestore,
}: {
  billId: string;
  archivedAt: string;
  archivedBy: string | null;
  reason: string | null;
  canRestore: boolean;
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const restore = () =>
    start(async () => {
      setErr(null);
      const r = await restoreBillAction(billId);
      if (!r.ok) { setErr(r.error); return; }
      router.refresh();
    });

  const when = new Date(archivedAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  return (
    <section
      className="page-card"
      style={{ borderColor: "rgba(180,83,9,0.45)", background: "rgba(180,83,9,0.05)" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 15, color: "#b45309" }}>🗄 This bill is archived</h2>
        {canRestore && (
          <button
            type="button"
            onClick={restore}
            disabled={pending}
            style={{ marginLeft: "auto", padding: "8px 14px", fontSize: 12.5, fontWeight: 800, borderRadius: 9, border: "none", background: "#15803d", color: "#fff", cursor: pending ? "wait" : "pointer" }}
          >
            {pending ? "Restoring…" : "Restore to the accounts"}
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.65, margin: "8px 0 0" }}>
        Archived {when}
        {archivedBy ? ` by ${archivedBy}` : ""}
        {reason ? ` · “${reason}”` : ""}. It is hidden from the bill list, the {"vendor's"} totals
        and every report — but nothing was deleted, and the figures below are exactly as they
        were.
      </p>
      {err && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: "#b91c1c", background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, padding: "8px 11px" }}>
          {err}
        </div>
      )}
    </section>
  );
}
