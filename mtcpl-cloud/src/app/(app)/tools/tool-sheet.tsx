"use client";

/**
 * Everything you can do to one tool, reached by pressing that tool.
 *
 * Daksh, Nov 2026: "to add stock and fix count you have to press fix
 * count and choose which tool — instead maybe we can long press on home
 * page only."
 *
 * The old order was backwards. You picked the VERB first, from a FAB or
 * a ⋯ menu, and only then said which tool it applied to — even though
 * your thumb had been resting on the tool the whole time. On a phone
 * that is three screens and a scroll through a list of near-identical
 * part codes to reach a number you already knew.
 *
 * Press the tool. Everything that can happen to it is here, with its
 * name and its count at the top so there is no doubt which one you are
 * holding.
 *
 * This replaces the row's inline buttons on a phone entirely. A 12px
 * "Add stock" and a 28px "⋯" sat side by side in a row 44px tall; both
 * were under the 44px Apple and Google both ask for, and they were the
 * two things most likely to be pressed with a glove on.
 */

import { ago } from "./ui-bits";
import { Sheet } from "./sheet";
import type { ToolRow } from "@/lib/cnc-tool-stock";

export function ToolSheet({
  tool,
  canManage,
  confirmingDelete,
  onClose,
  onAddStock,
  onFixCount,
  onHistory,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  tool: ToolRow | null;
  canManage: boolean;
  confirmingDelete: boolean;
  onClose: () => void;
  onAddStock: () => void;
  onFixCount: () => void;
  onHistory: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  if (!tool) return null;

  const level = tool.stock <= 0 ? "out" : tool.stock <= tool.lowLine ? "low" : "ok";

  return (
    <Sheet
      open={!!tool}
      onClose={onClose}
      title={tool.name}
      subtitle={
        <>
          <strong>{tool.stock} {tool.unit}</strong> on the shelf
          {level === "low" && <> · running low, warns at {tool.lowLine}</>}
          {level === "out" && <> · empty</>}
          {tool.lastMovement && (
            <>
              {" · "}
              {tool.lastMovement.taken_by
                ? `${tool.lastMovement.taken_by} took ${Math.abs(Number(tool.lastMovement.delta))}`
                : "stock added"}{" "}
              {ago(tool.lastMovement.created_at)}
            </>
          )}
        </>
      }
    >
      <style>{TOOL_SHEET_CSS}</style>

      <div className="ts-acts">
        {canManage && (
          <>
            <button type="button" className="ts-act ts-act-go" onClick={onAddStock}>
              <b>Add stock</b>
              <em>A box has arrived</em>
            </button>
            <button type="button" className="ts-act" onClick={onFixCount}>
              <b>Fix count</b>
              <em>The shelf and the register disagree</em>
            </button>
          </>
        )}

        <button type="button" className="ts-act" onClick={onHistory}>
          <b>This tool&apos;s register</b>
          <em>Every line, who took what</em>
        </button>

        {canManage && (
          <button type="button" className="ts-act" onClick={onEdit}>
            <b>Edit tool</b>
            <em>Name, unit, the warning line, its photo</em>
          </button>
        )}
      </div>

      {/* Delete appears only at zero. It is not greyed out at other
          times — a button somebody cannot press is a question they have
          to ask somebody else. The rule is written where they can read
          it instead. */}
      {canManage && (
        <div className="ts-danger">
          {tool.stock <= 0 ? (
            confirmingDelete ? (
              <div className="ts-ask">
                <span>Delete {tool.name} from the store for good?</span>
                <div>
                  <button type="button" className="ts-yes" onClick={onDelete}>Yes, delete</button>
                  <button type="button" className="ts-no" onClick={onCancelDelete}>Keep it</button>
                </div>
              </div>
            ) : (
              <button type="button" className="ts-act ts-act-danger" onClick={onAskDelete}>
                <b>Delete tool</b>
                <em>It is empty, so it can go</em>
              </button>
            )
          ) : (
            <p className="ts-why">
              It can only be deleted once it is empty — {tool.stock} {tool.unit} still on the shelf.
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}

const TOOL_SHEET_CSS = `
.ts-acts { display:flex; flex-direction:column; gap:8px; }
.ts-act {
  display:flex; flex-direction:column; gap:2px; width:100%; text-align:left;
  /* 56px tall at minimum: this is pressed on a shop floor, sometimes
     with a glove on. */
  min-height:56px; justify-content:center;
  padding:11px 14px; border-radius:var(--radius); cursor:pointer; font:inherit;
  background:var(--surface); border:1px solid var(--border); color:var(--text);
}
.ts-act:hover { background:var(--surface-alt); border-color:var(--muted-light); }
.ts-act b { font-size:14px; font-weight:600; }
.ts-act em { font-style:normal; font-size:11.5px; color:var(--muted); }
.ts-act-go { background:var(--gold-subtle); border-color:var(--gold-border); }
.ts-act-go b { color:var(--gold-dark); }
.ts-act-go:hover { background:var(--gold); border-color:var(--gold); }
.ts-act-go:hover b, .ts-act-go:hover em { color:#fff; }

.ts-danger { margin-top:14px; padding-top:12px; border-top:1px solid var(--border); }
.ts-act-danger { border-color:rgba(220,38,38,.25); }
.ts-act-danger b { color:var(--danger); }
.ts-act-danger:hover { background:var(--danger-bg); border-color:var(--danger); }
.ts-why { margin:0; font-size:12px; line-height:1.55; color:var(--muted); }

.ts-ask > span { display:block; font-size:13px; font-weight:600; color:var(--text);
  line-height:1.5; margin-bottom:10px; }
.ts-ask > div { display:flex; gap:8px; }
.ts-yes, .ts-no { padding:10px 14px; border-radius:var(--radius); cursor:pointer;
  font:inherit; font-size:13px; font-weight:600; }
.ts-yes { background:var(--danger); color:#fff; border:1px solid var(--danger); }
.ts-no { background:var(--surface); color:var(--muted); border:1px solid var(--border); }
`;
