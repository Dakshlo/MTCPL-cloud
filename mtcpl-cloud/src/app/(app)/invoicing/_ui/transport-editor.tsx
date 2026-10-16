"use client";

/**
 * Transport details on an issued invoice — editable, on its own.
 *
 * Daksh, Oct 2026: the accountants kept ringing him to change an LR or a lorry
 * number, because once an invoice exists every edit screen either hides these
 * fields or parks the whole change in the owner's approval queue.
 *
 * So this is a SEPARATE form with its own Save, sitting outside the pricing
 * form, and that separation is the point rather than a layout choice:
 *
 *   · the money form stages a change and waits for the owner;
 *     this one saves straight away, because none of these six fields
 *     touches the amount, the GST, the number or who is billed;
 *   · nobody can nudge a rate while "just fixing the lorry number",
 *     and nobody has to re-approve an invoice to correct a typo;
 *   · a nested <form> is invalid HTML anyway, so it has to be its own.
 *
 * Every save is written to the audit log with the old and the new value, so a
 * correction is still a traceable act.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type TransportValues = {
  transport_company: string | null;
  transport_phone: string | null;
  lr_no: string | null;
  transport_vehicle_no: string | null;
  transport_driver_name: string | null;
  transport_driver_phone: string | null;
};

type SaveResult = { ok: true } | { ok: false; error: string };

const FIELDS: Array<{
  name: keyof TransportValues;
  label: string;
  hint?: string;
  mono?: boolean;
  wide?: boolean;
}> = [
  { name: "transport_company", label: "Transport company", hint: "Pick or type new…", wide: true },
  { name: "transport_phone", label: "Transport phone" },
  { name: "lr_no", label: "LR no." },
  { name: "transport_vehicle_no", label: "Vehicle no.", hint: "e.g. RJ30GA5566", mono: true },
  { name: "transport_driver_name", label: "Driver name" },
  { name: "transport_driver_phone", label: "Driver phone" },
];

export function TransportEditor({
  id,
  kind,
  initial,
  saveAction,
  companies = [],
  locked,
}: {
  id: string;
  kind: "temple" | "other";
  initial: TransportValues;
  saveAction: (fd: FormData) => Promise<SaveResult>;
  /** Transport-company master, for the company suggestions. */
  companies?: string[];
  /** Cancelled bills are a closed record — show, never edit. */
  locked?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [vals, setVals] = useState<TransportValues>(initial);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const dirty = FIELDS.filter((f) => (vals[f.name] ?? "") !== (initial[f.name] ?? ""));

  const matches = useMemo(() => {
    const q = (vals.transport_company ?? "").trim().toLowerCase();
    return (q ? companies.filter((n) => n.toLowerCase().includes(q)) : companies).slice(0, 50);
  }, [vals.transport_company, companies]);

  function set(name: keyof TransportValues, v: string) {
    setVals((prev) => ({ ...prev, [name]: v }));
    setSaved(null);
    setErr(null);
  }

  function save() {
    const changed = dirty.map((f) => f.label);
    setErr(null);
    setSaved(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("kind", kind);
      for (const f of FIELDS) fd.set(f.name, (vals[f.name] ?? "").trim());
      const r = await saveAction(fd);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setSaved(changed);
      router.refresh();
    });
  }

  return (
    <section className="te">
      <style>{CSS}</style>

      <header className="te-head">
        <h3>🚚 Transport details</h3>
        <p>
          Saves on its own, straight away — no approval needed, because none of
          these change the amount, the GST or the invoice number. To change
          rates, GST or the discount, use the form above; that still goes to the
          owner. Every change here is recorded with the old value.
        </p>
      </header>

      {locked ? (
        <div className="te-locked">This bill is cancelled, so its transport details are frozen.</div>
      ) : (
        <>
          <div className="te-grid">
            {FIELDS.map((f) => {
              const isCompany = f.name === "transport_company";
              const edited = (vals[f.name] ?? "") !== (initial[f.name] ?? "");
              return (
                <div key={f.name} className={`te-field${f.wide ? " is-wide" : ""}`}>
                  <span className="te-lbl">
                    {f.label}
                    {edited && <em className="te-chg">changed</em>}
                  </span>
                  <div className="te-wrap">
                    <input
                      value={vals[f.name] ?? ""}
                      onChange={(e) => {
                        set(f.name, e.target.value);
                        if (isCompany) setListOpen(true);
                      }}
                      onFocus={isCompany ? () => setListOpen(true) : undefined}
                      onBlur={isCompany ? () => setTimeout(() => setListOpen(false), 120) : undefined}
                      placeholder={f.hint ?? ""}
                      className={`${edited ? "is-edited" : ""}${f.mono ? " is-mono" : ""}`}
                      maxLength={120}
                      autoComplete="off"
                    />
                    {isCompany && listOpen && matches.length > 0 && (
                      <div className="te-list">
                        {matches.map((n) => (
                          <button
                            key={n}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              set("transport_company", n);
                              setListOpen(false);
                            }}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="te-actions">
            <button type="button" onClick={save} disabled={pending || dirty.length === 0}>
              {pending ? "Saving…" : "Save transport details"}
            </button>
            {dirty.length > 0 && !pending && (
              <span className="te-dirty">
                {dirty.length} change{dirty.length > 1 ? "s" : ""} not saved yet
              </span>
            )}
            {saved && dirty.length === 0 && (
              <span className="te-ok">
                ✓ Saved{saved.length ? ` — ${saved.join(", ")}` : ""}
              </span>
            )}
            {err && <span className="te-err">⚠ {err}</span>}
          </div>
        </>
      )}
    </section>
  );
}

const CSS = `
.te { margin-top:18px; background:var(--surface); border:1px solid var(--border);
  border-left:4px solid var(--gold); border-radius:14px; padding:16px 18px; }
.te-head h3 { font-size:15px; font-weight:800; margin:0 0 5px; }
.te-head p { font-size:12px; color:var(--muted); line-height:1.55; margin:0 0 14px; max-width:78ch; }
.te-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:12px; }
.te-field { display:flex; flex-direction:column; gap:5px; min-width:0; }
.te-field.is-wide { grid-column:span 2; }
.te-lbl { display:flex; align-items:center; gap:7px; font-size:10.5px; font-weight:800;
  letter-spacing:.07em; text-transform:uppercase; color:var(--muted); }
.te-chg { font-style:normal; font-size:9.5px; font-weight:800; letter-spacing:.04em;
  color:#92400e; background:rgba(234,179,8,.16); border-radius:999px; padding:1px 7px; }
.te-wrap { position:relative; }
.te-field input { width:100%; box-sizing:border-box; min-height:42px; padding:0 12px;
  font-size:14.5px; border-radius:10px; border:1px solid var(--border);
  background:var(--surface); color:var(--text); outline:none; }
.te-field input.is-mono { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
.te-field input.is-edited { border-color:#d97706; background:rgba(234,179,8,.07); }
.te-field input:focus { border-color:var(--gold); box-shadow:0 0 0 3px rgba(166,123,40,.12); }
.te-list { position:absolute; top:calc(100% + 4px); left:0; right:0; z-index:30;
  background:var(--surface); border:1px solid var(--border); border-radius:8px;
  box-shadow:0 10px 30px rgba(0,0,0,.18); max-height:220px; overflow-y:auto; }
.te-list button { display:block; width:100%; text-align:left; padding:9px 12px; font-size:13px;
  background:transparent; border:none; border-bottom:1px solid var(--border);
  cursor:pointer; color:var(--text); }
.te-list button:hover { background:rgba(184,115,51,.12); }
.te-actions { display:flex; align-items:center; gap:12px; margin-top:14px; flex-wrap:wrap; }
.te-actions button { padding:11px 20px; font-size:14px; font-weight:800; border-radius:11px;
  border:none; color:#fff; cursor:pointer;
  background:linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%); }
.te-actions button:disabled { background:var(--border); color:var(--muted); cursor:not-allowed; }
.te-ok { font-size:12.5px; font-weight:700; color:#15803d; }
.te-dirty { font-size:12.5px; font-weight:600; color:#92400e; }
.te-err { font-size:12.5px; font-weight:600; color:#b91c1c; }
.te-locked { font-size:13px; color:var(--muted); background:var(--surface-alt);
  border:1px solid var(--border-light); border-radius:10px; padding:12px 14px; }

@media (max-width: 560px) { .te-field.is-wide { grid-column:span 1; } }
`;
