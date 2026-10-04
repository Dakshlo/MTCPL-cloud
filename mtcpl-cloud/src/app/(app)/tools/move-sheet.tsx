"use client";

/**
 * The movement sheet — the screen that replaces the register page.
 *
 * Everything on it is sized for a man standing at a machine holding a
 * phone in one hand: the stepper buttons are 52px, the name chips are
 * tap targets rather than a dropdown, and the confirm button says what
 * will happen ("Take 2 · 10 left") instead of "Submit".
 *
 * There is no free-typing of a person's name unless you ask for it. The
 * chips come from who has already taken things from THIS crib, newest
 * first — so after the first week the common case is two taps and done.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { KIND_VERB, type ToolMovementKind, type ToolRow } from "@/lib/cnc-tool-stock";
import { Sheet } from "./sheet";

export type MoveIntent = { tool: ToolRow; kind: ToolMovementKind };

const NEEDS_NAME: ToolMovementKind[] = ["issue", "return"];

export function MoveSheet({
  intent,
  vendorId,
  people,
  busy,
  onClose,
  onSubmit,
}: {
  intent: MoveIntent | null;
  vendorId: string;
  people: string[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (fd: FormData) => void;
}) {
  const [qty, setQty] = useState(1);
  const [name, setName] = useState("");
  const [typing, setTyping] = useState(false);
  const [note, setNote] = useState("");
  const [down, setDown] = useState(true);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const tool = intent?.tool ?? null;
  const kind = intent?.kind ?? "issue";

  // Fresh sheet every time it opens — a stepper still showing the last
  // man's 6 is how wrong numbers get written down.
  useEffect(() => {
    if (!intent) return;
    setQty(1);
    setNote("");
    setDown(true);
    // One known name is almost always the right one; preselect it so the
    // common case is a single tap on Confirm.
    setName(people.length === 1 ? people[0] : "");
    setTyping(people.length === 0);
  }, [intent, people]);

  useEffect(() => {
    if (typing) nameRef.current?.focus();
  }, [typing]);

  const needsName = NEEDS_NAME.includes(kind);
  const signed = useMemo(() => {
    if (!tool) return 0;
    if (kind === "receive" || kind === "return") return qty;
    if (kind === "issue" || kind === "scrap") return -qty;
    return down ? -qty : qty;
  }, [kind, qty, down, tool]);

  const after = (tool?.stock ?? 0) + signed;
  const wouldGoNegative = after < 0;
  const ready =
    !!tool && qty > 0 && !wouldGoNegative && (!needsName || name.trim().length > 0) && !busy;

  if (!tool) return null;

  const outcomeColour =
    after <= 0 ? "var(--danger)" : after <= tool.lowLine ? "var(--warning)" : "var(--success)";

  return (
    <Sheet
      open={!!intent}
      onClose={onClose}
      tone={kind === "scrap" ? "danger" : "gold"}
      title={`${KIND_VERB[kind]} · ${tool.name}`}
      subtitle={
        <>
          {tool.spec ? <>{tool.spec} · </> : null}
          <strong style={{ color: "var(--text)" }}>{tool.stock}</strong> {tool.unit} in the crib now
        </>
      }
      footer={
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            const fd = new FormData();
            fd.set("vendor_id", vendorId);
            fd.set("tool_id", tool.id);
            fd.set("kind", kind);
            fd.set("qty", String(qty));
            if (needsName) fd.set("taken_by", name.trim());
            if (kind === "adjust") fd.set("direction", down ? "down" : "up");
            if (note.trim()) fd.set("note", note.trim());
            onSubmit(fd);
          }}
          style={{
            width: "100%", padding: "15px 18px", fontSize: 16, fontWeight: 800,
            borderRadius: 13, border: "none", cursor: ready ? "pointer" : "not-allowed",
            color: "#fff",
            background: !ready
              ? "var(--border)"
              : kind === "scrap"
                ? "var(--danger)"
                : "linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%)",
            boxShadow: ready ? "0 6px 18px rgba(166,123,40,0.3)" : "none",
            transition: "transform .08s ease",
          }}
        >
          {busy
            ? "Saving…"
            : wouldGoNegative
              ? `Only ${tool.stock} on the books`
              : `${KIND_VERB[kind]} ${qty} · ${after} left`}
        </button>
      }
    >
      {/* ── How many ─────────────────────────────────────────── */}
      <Label>How many</Label>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
        <StepBtn label="−" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} />
        <div style={{ flex: 1, textAlign: "center" }}>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            style={{
              width: "100%", border: "none", background: "transparent", textAlign: "center",
              fontSize: 46, fontWeight: 800, color: "var(--text)",
              fontFamily: "ui-monospace, monospace", letterSpacing: "-0.03em",
              outline: "none", padding: 0, MozAppearance: "textfield",
            }}
          />
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginTop: -4 }}>{tool.unit}</div>
        </div>
        <StepBtn label="+" onClick={() => setQty((q) => q + 1)} />
      </div>

      {/* The three numbers people actually reach for. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {[1, 2, 5].map((n) => (
          <button
            key={n} type="button" onClick={() => setQty(n)}
            style={{
              flex: 1, padding: "8px 0", fontSize: 13, fontWeight: 700, borderRadius: 9,
              cursor: "pointer",
              border: `1px solid ${qty === n ? "var(--gold)" : "var(--border)"}`,
              background: qty === n ? "var(--gold-subtle)" : "var(--surface)",
              color: qty === n ? "var(--gold-dark)" : "var(--muted)",
            }}
          >
            {n}
          </button>
        ))}
      </div>

      {/* ── Direction, adjust only ───────────────────────────── */}
      {kind === "adjust" && (
        <>
          <Label>Which way</Label>
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            {[
              { v: true, t: "Fewer on the shelf", s: "the crib has less than the books say" },
              { v: false, t: "More on the shelf", s: "the crib has more than the books say" },
            ].map((o) => (
              <button
                key={String(o.v)} type="button" onClick={() => setDown(o.v)}
                style={{
                  flex: 1, padding: "11px 12px", borderRadius: 11, cursor: "pointer", textAlign: "left",
                  border: `1px solid ${down === o.v ? "var(--gold)" : "var(--border)"}`,
                  background: down === o.v ? "var(--gold-subtle)" : "var(--surface)",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{o.t}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, lineHeight: 1.35 }}>{o.s}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── Who ──────────────────────────────────────────────── */}
      {needsName && (
        <>
          <Label>{kind === "issue" ? "Who is taking it" : "Who is returning it"}</Label>
          {!typing && people.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {people.map((p) => (
                <button
                  key={p} type="button" onClick={() => setName(p)}
                  style={{
                    padding: "10px 15px", fontSize: 14, fontWeight: 700, borderRadius: 999,
                    cursor: "pointer",
                    border: `1.5px solid ${name === p ? "var(--gold-dark)" : "var(--border)"}`,
                    background: name === p ? "var(--gold)" : "var(--surface)",
                    color: name === p ? "#fff" : "var(--text)",
                  }}
                >
                  {p}
                </button>
              ))}
              <button
                type="button" onClick={() => { setName(""); setTyping(true); }}
                style={{
                  padding: "10px 15px", fontSize: 14, fontWeight: 700, borderRadius: 999,
                  cursor: "pointer", border: "1.5px dashed var(--border)",
                  background: "transparent", color: "var(--muted)",
                }}
              >
                + New name
              </button>
            </div>
          )}
          {(typing || people.length === 0) && (
            <div style={{ marginBottom: 10 }}>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name of the person"
                maxLength={60}
                style={inputStyle()}
              />
              {people.length > 0 && (
                <button
                  type="button" onClick={() => setTyping(false)}
                  style={{
                    marginTop: 8, fontSize: 12.5, fontWeight: 700, color: "var(--gold-dark)",
                    background: "none", border: "none", cursor: "pointer", padding: 0,
                  }}
                >
                  ← Pick from the list instead
                </button>
              )}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 18, lineHeight: 1.5 }}>
            This is the name that goes in the register — the person who physically takes it, not
            whoever is holding the phone.
          </div>
        </>
      )}

      {/* ── Note ─────────────────────────────────────────────── */}
      <Label>Note {kind === "scrap" || kind === "adjust" ? "" : "(optional)"}</Label>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={
          kind === "scrap" ? "What happened to it?"
            : kind === "adjust" ? "Why the count is different"
              : "Which machine, which job…"
        }
        maxLength={300}
        style={inputStyle()}
      />

      {/* ── What this will do ────────────────────────────────── */}
      <div
        style={{
          marginTop: 18, padding: "13px 15px", borderRadius: 12,
          background: "var(--surface-alt)", border: "1px solid var(--border-light)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}
      >
        <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>After this</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
          <span style={{ fontSize: 13, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
            {tool.stock}
          </span>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>→</span>
          <span
            style={{
              fontSize: 26, fontWeight: 800, color: outcomeColour,
              fontFamily: "ui-monospace, monospace", letterSpacing: "-0.02em",
            }}
          >
            {Math.max(0, after)}
          </span>
          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{tool.unit}</span>
        </div>
      </div>

      {/* The warning lands at the moment it is useful — while the man
          who just emptied the shelf is still standing there. */}
      {!wouldGoNegative && after <= tool.lowLine && (
        <div
          style={{
            marginTop: 10, padding: "11px 14px", borderRadius: 11, fontSize: 12.5, fontWeight: 700,
            lineHeight: 1.5,
            background: after <= 0 ? "var(--danger-bg)" : "var(--warning-bg)",
            color: after <= 0 ? "var(--danger)" : "var(--warning)",
          }}
        >
          {after <= 0
            ? `⚠ That empties the crib of ${tool.name}.`
            : `⚠ That leaves only ${after} ${tool.unit} — at or below the ${tool.lowLine} you set.`}
        </div>
      )}
    </Sheet>
  );
}

// ── Small shared bits (module level: a component defined inside a
//    component remounts on every render and steals input focus) ──────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase",
        color: "var(--muted)", marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function StepBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-label={label === "+" ? "More" : "Fewer"}
      style={{
        width: 56, height: 56, borderRadius: 16, flex: "0 0 auto",
        fontSize: 28, fontWeight: 700, lineHeight: 1,
        border: "1px solid var(--border)",
        background: disabled ? "var(--bg)" : "var(--surface-alt)",
        color: disabled ? "var(--border)" : "var(--text)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%", padding: "13px 15px", fontSize: 15, borderRadius: 11,
    border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)",
    outline: "none",
  };
}
