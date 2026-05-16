"use client";

/**
 * Mig 058 — Parties list + add/edit SidePanel.
 *
 * Mirrors src/app/(app)/accounts/vendors/vendor-form.tsx pattern:
 *   • AddTrigger — button that opens a fresh "new party" panel
 *   • EditTrigger — button (one per row) that opens an edit panel
 *   • List — the actual table
 *
 * Exported as a single namespace `PartiesClient` so the server
 * page can import once and use both pieces (AddTrigger + List)
 * cleanly.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import {
  ACCOUNTS_TOKENS,
  BUTTON_STYLES,
  INPUT_STYLE,
  SidePanel,
  TABLE_STYLES,
  VendorIdentity,
} from "../../accounts/_ui/components";

export type PartyRow = {
  id: string;
  name: string;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  challanCount: number;
  invoiceCount: number;
};

type ActionResult = { ok: true } | { ok: false; error: string };
type UpsertAction = (formData: FormData) => Promise<ActionResult>;
type ArchiveAction = (formData: FormData) => Promise<ActionResult>;

// ────────────────────────────────────────────────────────────────
// AddTrigger — button + SidePanel for creating a new party
// ────────────────────────────────────────────────────────────────

function AddTrigger({
  upsertAction,
  archiveAction: _archiveAction,
  buttonLabel = "+ Add party",
}: {
  upsertAction: UpsertAction;
  archiveAction: ArchiveAction;
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={BUTTON_STYLES.primary}>
        {buttonLabel}
      </button>
      <SidePanel
        open={open}
        onClose={() => setOpen(false)}
        title="New party"
        description="Saved customers — pick from this list when creating challans or invoices."
      >
        <PartyForm
          mode="create"
          upsertAction={upsertAction}
          onDone={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      </SidePanel>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// List — the parties table + per-row Edit/Archive
// ────────────────────────────────────────────────────────────────

function List({
  parties,
  upsertAction,
  archiveAction,
}: {
  parties: PartyRow[];
  upsertAction: UpsertAction;
  archiveAction: ArchiveAction;
}) {
  return (
    <table style={TABLE_STYLES.table}>
      <thead style={TABLE_STYLES.thead}>
        <tr>
          <th style={TABLE_STYLES.th}>Party</th>
          <th style={TABLE_STYLES.th}>GSTIN</th>
          <th style={TABLE_STYLES.th}>Phone</th>
          <th style={TABLE_STYLES.thRight}>Challans</th>
          <th style={TABLE_STYLES.thRight}>Invoices</th>
          <th style={{ ...TABLE_STYLES.thRight, width: 220 }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {parties.map((p, idx) => (
          <tr
            key={p.id}
            style={{
              background: !p.isActive
                ? ACCOUNTS_TOKENS.surfaceMuted
                : idx % 2 === 0
                ? "#fff"
                : ACCOUNTS_TOKENS.surfaceMuted,
              opacity: p.isActive ? 1 : 0.55,
            }}
          >
            <td style={TABLE_STYLES.td}>
              <VendorIdentity
                name={p.name}
                subLabel={p.address?.split("\n")[0] ?? undefined}
                href={`/invoicing/parties/${p.id}`}
              />
              {!p.isActive && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 8px",
                    background: ACCOUNTS_TOKENS.neutralLight,
                    color: ACCOUNTS_TOKENS.neutral,
                    borderRadius: 999,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Archived
                </span>
              )}
            </td>
            <td style={{ ...TABLE_STYLES.td, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
              {p.gstin ?? "—"}
            </td>
            <td style={TABLE_STYLES.td}>{p.phone ?? "—"}</td>
            <td style={{ ...TABLE_STYLES.tdRight, fontFamily: "ui-monospace, monospace" }}>
              {p.challanCount}
            </td>
            <td style={{ ...TABLE_STYLES.tdRight, fontFamily: "ui-monospace, monospace" }}>
              {p.invoiceCount}
            </td>
            <td style={TABLE_STYLES.tdRight}>
              <div style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                <Link
                  href={`/invoicing/parties/${p.id}`}
                  style={{ ...BUTTON_STYLES.secondary, padding: "6px 10px", fontSize: 12 }}
                >
                  View
                </Link>
                <EditTrigger
                  party={p}
                  upsertAction={upsertAction}
                  archiveAction={archiveAction}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ────────────────────────────────────────────────────────────────
// EditTrigger — small button + edit SidePanel
// ────────────────────────────────────────────────────────────────

function EditTrigger({
  party,
  upsertAction,
  archiveAction,
}: {
  party: PartyRow;
  upsertAction: UpsertAction;
  archiveAction: ArchiveAction;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ ...BUTTON_STYLES.ghost, padding: "6px 10px", fontSize: 12 }}
      >
        ✎ Edit
      </button>
      <SidePanel
        open={open}
        onClose={() => setOpen(false)}
        title={`Edit · ${party.name}`}
        description="Changes apply to future challans/invoices. Existing invoices keep the customer details they were issued with."
      >
        <PartyForm
          mode="edit"
          party={party}
          upsertAction={upsertAction}
          archiveAction={archiveAction}
          onDone={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      </SidePanel>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// PartyForm — shared by Add + Edit modes
// ────────────────────────────────────────────────────────────────

function PartyForm({
  mode,
  party,
  upsertAction,
  archiveAction,
  onDone,
}: {
  mode: "create" | "edit";
  party?: PartyRow;
  upsertAction: UpsertAction;
  archiveAction?: ArchiveAction;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(party?.name ?? "");
  const [gstin, setGstin] = useState(party?.gstin ?? "");
  const [pan, setPan] = useState(party?.pan ?? "");
  const [address, setAddress] = useState(party?.address ?? "");
  const [phone, setPhone] = useState(party?.phone ?? "");
  const [email, setEmail] = useState(party?.email ?? "");
  const [notes, setNotes] = useState(party?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Party name is required.");
    startTransition(async () => {
      const fd = new FormData();
      if (party?.id) fd.set("id", party.id);
      fd.set("name", name.trim());
      fd.set("gstin", gstin.trim());
      fd.set("pan", pan.trim());
      fd.set("address", address.trim());
      fd.set("phone", phone.trim());
      fd.set("email", email.trim());
      fd.set("notes", notes.trim());
      const r = await upsertAction(fd);
      if (!r.ok) return setError(r.error);
      onDone();
    });
  }

  function handleArchive() {
    if (!party?.id || !archiveAction) return;
    if (!confirm(`Archive "${party.name}"? It'll stop appearing in pickers, but existing challans/invoices are unaffected.`))
      return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", party.id);
      const r = await archiveAction(fd);
      if (!r.ok) return setError(r.error);
      onDone();
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <FinanceLoadingOverlay show={pending} label={mode === "edit" ? "Saving party…" : "Creating party…"} />

      <Field label="Party name *">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 200))}
          autoFocus
          required
          style={{ ...INPUT_STYLE, fontWeight: 600 }}
        />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="GSTIN">
          <input
            type="text"
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase().slice(0, 20))}
            placeholder="22AAAAA0000A1Z5"
            style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
          />
        </Field>
        <Field label="PAN">
          <input
            type="text"
            value={pan}
            onChange={(e) => setPan(e.target.value.toUpperCase().slice(0, 10))}
            placeholder="AAAAA0000A"
            style={{ ...INPUT_STYLE, fontFamily: "ui-monospace, monospace" }}
          />
        </Field>
      </div>
      <Field label="Address">
        <textarea
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={2}
          placeholder="Street, city, state, PIN"
          style={{ ...INPUT_STYLE, resize: "vertical", fontFamily: "inherit" }}
        />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Phone">
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value.slice(0, 30))}
            placeholder="+91…"
            style={INPUT_STYLE}
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value.slice(0, 100))}
            placeholder="name@company.com"
            style={INPUT_STYLE}
          />
        </Field>
      </div>
      <Field label="Notes (internal)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything worth remembering about this party (credit terms, contact preferences, etc.)"
          style={{ ...INPUT_STYLE, resize: "vertical", fontFamily: "inherit" }}
        />
      </Field>

      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            background: ACCOUNTS_TOKENS.dangerLight,
            border: `1px solid ${ACCOUNTS_TOKENS.danger}`,
            color: ACCOUNTS_TOKENS.danger,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button type="submit" disabled={pending || !name.trim()} style={BUTTON_STYLES.primary}>
          {mode === "edit" ? "Save changes" : "+ Add party"}
        </button>
        {mode === "edit" && party?.isActive && archiveAction && (
          <button
            type="button"
            onClick={handleArchive}
            disabled={pending}
            style={{ ...BUTTON_STYLES.danger, marginLeft: "auto" }}
          >
            Archive party
          </button>
        )}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginBottom: 5,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

export const PartiesClient = {
  AddTrigger,
  List,
};
