"use client";

import { useMemo, useState } from "react";
import {
  createActivityEntryAction,
  updateActivityEntryAction,
  deleteActivityEntryAction,
} from "./actions";
import { ConfirmButton } from "@/components/confirm-button";

export type RegisterEntry = {
  id: string;
  srNo: number;
  code: string;
  date: string; // YYYY-MM-DD
  activity: string;
  person: string;
  reference: string;
  hasProof: boolean;
};

function fmtDate(d: string): string {
  if (!d) return "—";
  try {
    return new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return d;
  }
}
function todayISO(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  fontSize: 14,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg)",
  color: "var(--text)",
  width: "100%",
};

export function ActivityRegisterTable({
  entries,
  toast,
}: {
  entries: RegisterEntry[];
  toast: string | null;
}) {
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<
    null | { mode: "new" } | { mode: "edit"; entry: RegisterEntry }
  >(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return entries;
    return entries.filter((e) =>
      [e.code, e.date, fmtDate(e.date), e.activity, e.person, e.reference]
        .filter(Boolean)
        .some((f) => f.toLowerCase().includes(s)),
    );
  }, [entries, q]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {toast && (
        <div
          style={{
            background: "rgba(217,119,6,0.1)",
            border: "1px solid rgba(217,119,6,0.35)",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            color: "#92400e",
          }}
        >
          {toast}
        </div>
      )}

      {/* Toolbar — search + New entry */}
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search code, activity, person, reference, date…"
          style={{
            flex: "1 1 320px",
            padding: "9px 14px",
            fontSize: 14,
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--bg)",
            color: "var(--text)",
          }}
        />
        <button
          type="button"
          onClick={() => setModal({ mode: "new" })}
          style={{
            padding: "9px 18px",
            fontSize: 14,
            fontWeight: 800,
            color: "#fff",
            background: "var(--gold-dark)",
            border: "none",
            borderRadius: 10,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          ＋ New entry
        </button>
      </div>

      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
        {q ? ` matching “${q}”` : ""}
      </div>

      {/* Excel-style register */}
      <div
        style={{
          overflowX: "auto",
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--surface)",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            minWidth: 900,
          }}
        >
          <thead>
            <tr style={{ background: "var(--surface-alt, rgba(0,0,0,0.03))", textAlign: "left" }}>
              {["Sr", "Code", "Date", "Activity", "Person", "Reference", "Proof", ""].map((h, i) => (
                <th
                  key={i}
                  style={{
                    padding: "10px 12px",
                    fontSize: 11,
                    fontWeight: 800,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    borderBottom: "1px solid var(--border)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 28, textAlign: "center", color: "var(--muted)" }}>
                  {q
                    ? "No entries match your search."
                    : "No entries yet. Tap “＋ New entry” to add the first record."}
                </td>
              </tr>
            ) : (
              filtered.map((e) => (
                <tr key={e.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "9px 12px", fontFamily: "ui-monospace, monospace", color: "var(--muted)" }}>
                    {e.srNo}
                  </td>
                  <td style={{ padding: "9px 12px", fontFamily: "ui-monospace, monospace", fontWeight: 700, whiteSpace: "nowrap" }}>
                    {e.code}
                  </td>
                  <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>{fmtDate(e.date)}</td>
                  <td style={{ padding: "9px 12px", minWidth: 260, whiteSpace: "pre-wrap" }}>{e.activity}</td>
                  <td style={{ padding: "9px 12px" }}>{e.person || "—"}</td>
                  <td style={{ padding: "9px 12px" }}>{e.reference || "—"}</td>
                  <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                    {e.hasProof ? (
                      <a
                        href={`/api/activity-register/proof/${e.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--gold-dark)", fontWeight: 700, textDecoration: "none" }}
                      >
                        📎 View
                      </a>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "9px 12px", whiteSpace: "nowrap", textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() => setModal({ mode: "edit", entry: e })}
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "var(--text)",
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: 7,
                        padding: "4px 10px",
                        cursor: "pointer",
                        marginRight: 6,
                      }}
                    >
                      Edit
                    </button>
                    <form action={deleteActivityEntryAction} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={e.id} />
                      <ConfirmButton
                        message={`Delete entry ${e.code}? This also deletes its proof file and cannot be undone.`}
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "#b91c1c",
                          background: "rgba(220,38,38,0.08)",
                          border: "1px solid rgba(220,38,38,0.3)",
                          borderRadius: 7,
                          padding: "4px 10px",
                          cursor: "pointer",
                        }}
                      >
                        Delete
                      </ConfirmButton>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <EntryModal
          mode={modal.mode}
          entry={modal.mode === "edit" ? modal.entry : null}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function EntryModal({
  mode,
  entry,
  onClose,
}: {
  mode: "new" | "edit";
  entry: RegisterEntry | null;
  onClose: () => void;
}) {
  const isEdit = mode === "edit";
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(15,23,42,0.5)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "5vh 16px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: 22,
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{isEdit ? `Edit ${entry?.code}` : "New register entry"}</h2>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 24, lineHeight: 1, cursor: "pointer", color: "var(--muted)" }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <form
          action={isEdit ? updateActivityEntryAction : createActivityEntryAction}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          {isEdit && <input type="hidden" name="id" value={entry!.id} />}
          <Field label="Date">
            <input
              name="activity_date"
              type="date"
              defaultValue={isEdit ? entry!.date : todayISO()}
              style={inputStyle}
            />
          </Field>
          <Field label="Activity *">
            <textarea
              name="activity"
              required
              rows={3}
              defaultValue={isEdit ? entry!.activity : ""}
              placeholder="e.g. Sent black-granite demo sample to L&T, Mumbai (2 pieces, by Blue Dart)"
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
            />
          </Field>
          <Field label="Person">
            <input
              name="person"
              defaultValue={isEdit ? entry!.person : ""}
              placeholder="Who did it / the contact"
              style={inputStyle}
            />
          </Field>
          <Field label="Reference">
            <input
              name="reference"
              defaultValue={isEdit ? entry!.reference : ""}
              placeholder="PO no., courier tracking, party name, etc."
              style={inputStyle}
            />
          </Field>
          <Field label={isEdit ? "Proof — choose a file to replace" : "Proof (photo / PDF, optional)"}>
            {isEdit && entry!.hasProof && (
              <div style={{ fontSize: 12, marginBottom: 6 }}>
                <a
                  href={`/api/activity-register/proof/${entry!.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--gold-dark)", fontWeight: 700 }}
                >
                  📎 Current proof
                </a>
                <span style={{ color: "var(--muted)" }}> — pick a file below to replace it</span>
              </div>
            )}
            <input name="proof" type="file" accept="image/*,application/pdf" style={{ fontSize: 13 }} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "9px 16px",
                fontSize: 13,
                fontWeight: 700,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                cursor: "pointer",
                color: "var(--text)",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                padding: "9px 20px",
                fontSize: 13,
                fontWeight: 800,
                color: "#fff",
                background: "var(--gold-dark)",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              {isEdit ? "Save changes" : "Add entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
