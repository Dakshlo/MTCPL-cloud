"use client";

/**
 * Confirming Approve button for the cutting detail page (Daksh,
 * May 2026).
 *
 * The audit-list page (approvals-client.tsx) already prompts a
 * window.confirm with the slab + remainder counts before firing
 * approveCutAction. The detail page View → Approve had a bare
 * <form> + button with no confirmation — so an approver who
 * clicked Approve from the detail view bypassed the safety check
 * and could commit by accident.
 *
 * This wrapper restores parity: same multi-line confirm body, same
 * "tap OK only if the counts match" warning, then submits the
 * existing server action.
 *
 * Stays purely client-side; no router.refresh needed because the
 * server action redirects via revalidatePath on success.
 */

import type { FormEvent } from "react";

export function ApproveCutConfirmButton({
  action,
  sessionBlockId,
  blockId,
  cutCount,
  extraCount,
  transferCount,
  remainderCount,
}: {
  /** The bound server action (approveCutFormAction). Passed in
   *  rather than imported so we don't pull a server-only module
   *  into a client component. */
  action: (formData: FormData) => void | Promise<void>;
  sessionBlockId: string;
  blockId: string;
  cutCount: number;
  extraCount: number;
  transferCount: number;
  remainderCount: number;
}) {
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    // Build the exact same body as the audit-list confirm so the
    // approver sees consistent language across both surfaces.
    const lines = [
      `Approve cut for block ${blockId}?`,
      "",
      "This will commit:",
      `  • ${cutCount} slab(s) marked CUT`,
      ...(extraCount > 0 ? [`  • ${extraCount} extra slab(s)`] : []),
      ...(transferCount > 0 ? [`  • ${transferCount} transferred slab(s)`] : []),
      `  • ${remainderCount} remainder piece(s) → new restocked block(s)`,
      "",
      "Reversing an approval requires a developer SQL fix.",
      "",
      "Tap OK ONLY if every slab + remainder above matches what was actually cut.",
    ];
    if (!window.confirm(lines.join("\n"))) {
      e.preventDefault();
    }
  }
  return (
    <form action={action} onSubmit={onSubmit}>
      <input type="hidden" name="session_block_id" value={sessionBlockId} />
      <button className="primary-button" type="submit">
        ✓ Approve
      </button>
    </form>
  );
}
