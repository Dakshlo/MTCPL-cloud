"use client";

/**
 * A masked input the browser does NOT treat as a login credential.
 *
 * Daksh, Aug 2026: sitting with his dad on the finance and royalty
 * screens, Chrome's password manager offered to "save password" every
 * single time he opened a gate, and then suggested his email address
 * back to him in the box. These fields are not logins — they are a
 * shared passphrase in front of a panel — so every one of those
 * prompts is noise, and the suggestions are worse than noise because
 * they put the wrong value one keystroke away.
 *
 * How it stops both:
 *
 *   • A `type="password"` field is what makes Chrome offer to save and
 *     to fill. So once we know the browser can mask a plain text field
 *     (`-webkit-text-security`, i.e. Chrome / Edge / Safari), we render
 *     `type="text"` instead. Nothing about the field says "credential"
 *     any more, so no prompt and no suggestions — and the value is
 *     still dots on screen.
 *   • It starts as `type="password"` and switches after mount, which
 *     keeps SSR and the first client render identical (no hydration
 *     mismatch) and means Firefox — which has no text-security — stays
 *     masked rather than showing the passphrase in the clear. Chrome
 *     decides about saving at submit time, long after the switch.
 *   • `autocomplete="off"` plus the opt-out attributes the third-party
 *     managers read (1Password, LastPass, Bitwarden, Dashlane).
 *   • The field is never named "password". Chrome's heuristics read
 *     names, so calling it that would undo the rest.
 *
 * The real login (components/auth-form.tsx) is deliberately NOT built
 * on this — filling a phone number and an OTP from the browser is
 * genuinely useful there.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";

export function PassphraseInput({
  value,
  onChange,
  placeholder = "Passphrase",
  autoFocus,
  inputMode = "text",
  style,
  onKeyDown,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  inputMode?: "text" | "numeric";
  style?: CSSProperties;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  // Starts false so server and first client render agree; flips after
  // mount where the browser can mask plain text itself.
  const [maskWithCss, setMaskWithCss] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      (CSS.supports("-webkit-text-security", "disc") || CSS.supports("text-security", "disc"));
    if (ok) setMaskWithCss(true);
  }, []);

  return (
    <input
      ref={ref}
      // Masked by CSS where possible; a real password field otherwise,
      // so the passphrase is never legible on screen either way.
      type={maskWithCss ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      inputMode={inputMode}
      aria-label={ariaLabel ?? placeholder}
      // Not "password" — Chrome reads the name as a hint.
      name="mtcpl-gate"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      // Third-party managers each have their own opt-out.
      data-1p-ignore=""
      data-lpignore="true"
      data-bwignore="true"
      data-form-type="other"
      style={{
        ...style,
        ...(maskWithCss
          ? ({
              WebkitTextSecurity: "disc",
              textSecurity: "disc",
            } as CSSProperties)
          : null),
      }}
    />
  );
}
