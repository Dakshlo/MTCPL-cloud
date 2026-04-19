"use client";

/**
 * Follow-up suggestion chips. Claude emits `[[FOLLOWUPS:["q1","q2","q3"]]]`
 * at the very end of a reply; parser swaps it for these chips. Clicking a
 * chip sends it as the next user message — no typing.
 */

export function FollowUps({
  questions,
  onPick,
  disabled,
}: {
  questions: string[];
  onPick: (q: string) => void;
  disabled?: boolean;
}) {
  if (!questions || questions.length === 0) return null;

  return (
    <div
      style={{
        marginTop: 14,
        paddingTop: 12,
        borderTop: "1px dashed rgba(255,255,255,0.12)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "rgba(255,255,255,0.45)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        Try next
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {questions.slice(0, 6).map((q, i) => (
          <button
            key={`${q}-${i}`}
            type="button"
            onClick={() => onPick(q)}
            disabled={disabled}
            style={{
              fontSize: 13,
              padding: "7px 13px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(232,197,114,0.05)",
              color: "rgba(255,255,255,0.85)",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
              fontWeight: 500,
              whiteSpace: "nowrap",
              transition: "background 0.15s, border-color 0.15s, color 0.15s",
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              if (disabled) return;
              e.currentTarget.style.background = "rgba(232,197,114,0.15)";
              e.currentTarget.style.borderColor = "rgba(232,197,114,0.5)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(232,197,114,0.05)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
              e.currentTarget.style.color = "rgba(255,255,255,0.85)";
            }}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
