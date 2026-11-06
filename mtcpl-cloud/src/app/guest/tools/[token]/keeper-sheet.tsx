"use client";

/**
 * Keeping the shelf, from the cupboard, on a phone.
 *
 * Daksh, Nov 2026: "add [an] add item button so i can directly
 * maintain or add stock from phone only... and that add button on
 * bottom center so the UI will look good."
 *
 * ── Why a bottom sheet and not a page ─────────────────────────────
 *
 * This is used one-handed, standing at an open cupboard, often with a
 * box in the other hand. Everything that matters therefore lives in
 * the bottom third of the screen where a thumb reaches: the button
 * that opens it, the three choices, the number pad, the confirm. The
 * top of a phone is for reading, not for pressing.
 *
 * Three jobs, each one list-then-number, because that is the shape of
 * the thought: WHICH tool, then HOW MANY. Nothing asks for both at
 * once and nothing asks for anything a man standing at a cupboard
 * does not already know.
 *
 * Only the office three ever see it. The server re-reads that on every
 * call — this component drawing is not what makes it allowed.
 */

import { useMemo, useRef, useState, useTransition } from "react";

import { prettyBytes, shrinkImage } from "@/lib/compress-image";

export type KeeperTool = {
  id: string;
  name: string;
  spec: string | null;
  unit: string;
  stock: number;
  imageUrl: string | null;
};

type Res = { ok: true; message: string } | { ok: false; error: string };

type Job = "menu" | "stock" | "count" | "new";

export function KeeperSheet({
  token, tools, onDone,
  addStockAction, fixCountAction, newToolAction,
}: {
  token: string;
  /** Every live tool, empty ones included — an empty shelf is exactly
   *  what you have come to refill. */
  tools: KeeperTool[];
  /** Fired after a successful write so the screen can pull fresh
   *  numbers and show the line. */
  onDone: (message: string) => void;
  addStockAction: (fd: FormData) => Promise<Res>;
  fixCountAction: (fd: FormData) => Promise<Res>;
  newToolAction: (fd: FormData) => Promise<Res>;
}) {
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState<Job>("menu");
  const [picked, setPicked] = useState<KeeperTool | null>(null);
  const [n, setN] = useState(1);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // new tool
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [opening, setOpening] = useState(0);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = [...tools].sort((a, b) => a.name.localeCompare(b.name));
    if (!needle) return list;
    return list.filter(
      (t) => t.name.toLowerCase().includes(needle) || (t.spec ?? "").toLowerCase().includes(needle),
    );
  }, [tools, q]);

  function reset() {
    setJob("menu"); setPicked(null); setN(1); setQ(""); setErr(null);
    setName(""); setUnit("pcs"); setOpening(0);
    setPhoto(null); setPhotoNote(null);
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
  }

  function close() { setOpen(false); reset(); }

  function run(fn: () => Promise<Res>) {
    setErr(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) { setErr(r.error); return; }
      close();
      onDone(r.message);
    });
  }

  async function choosePhoto(file: File | null) {
    if (!file) { setPhoto(null); setPhotoNote(null); return; }
    setPhotoNote("Shrinking…");
    const out = await shrinkImage(file);
    setPhoto(out.file);
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(URL.createObjectURL(out.file));
    setPhotoNote(
      out.changed
        ? `${prettyBytes(out.beforeBytes)} → ${prettyBytes(out.afterBytes)}`
        : prettyBytes(out.afterBytes),
    );
  }

  const title =
    job === "stock" ? (picked ? "How many came in?" : "Add stock to…")
      : job === "count" ? (picked ? "What does the shelf say?" : "Fix the count of…")
        : job === "new" ? "New tool"
          : "Keep the shelf";

  return (
    <>
      {/* The button. Bottom centre, where the thumb already is.
          Gone while the sheet is up: it would otherwise sit behind the
          scrim, dimmed but still legible, looking like something you
          could press. */}
      {!open && (
        <button type="button" className="ks-fab" onClick={() => setOpen(true)}>
          <span aria-hidden>＋</span> Add stock
        </button>
      )}

      {open && (
        <div className="ks-wrap" role="dialog" aria-modal="true" aria-label="Keep the shelf">
          <div className="ks-scrim" onClick={close} />
          <div className="ks-sheet">
            <div className="ks-grab" aria-hidden />
            <header className="ks-head">
              {job !== "menu" && (
                <button
                  type="button"
                  className="ks-back"
                  onClick={() => (picked ? setPicked(null) : reset())}
                  aria-label="Back"
                >
                  ‹
                </button>
              )}
              <h2>{title}</h2>
              <button type="button" className="ks-x" onClick={close} aria-label="Close">✕</button>
            </header>

            {err && <div className="ks-err" role="alert">⚠ {err}</div>}

            {/* ── the three jobs ─────────────────────────────── */}
            {job === "menu" && (
              <div className="ks-menu">
                <button type="button" onClick={() => setJob("stock")}>
                  <span className="ks-ic" data-t="in" aria-hidden>📦</span>
                  <span><strong>Add stock</strong><em>A box has arrived</em></span>
                  <span className="ks-go" aria-hidden>›</span>
                </button>
                <button type="button" onClick={() => setJob("count")}>
                  <span className="ks-ic" data-t="fix" aria-hidden>⚖</span>
                  <span><strong>Fix count</strong><em>The shelf and the register disagree</em></span>
                  <span className="ks-go" aria-hidden>›</span>
                </button>
                <button type="button" onClick={() => setJob("new")}>
                  <span className="ks-ic" data-t="new" aria-hidden>✚</span>
                  <span><strong>New tool</strong><em>Something the store has never had</em></span>
                  <span className="ks-go" aria-hidden>›</span>
                </button>
              </div>
            )}

            {/* ── pick a tool ────────────────────────────────── */}
            {(job === "stock" || job === "count") && !picked && (
              <>
                {tools.length > 6 && (
                  <div className="ks-search">
                    <span aria-hidden>🔍</span>
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Search the shelf…"
                      aria-label="Search tools"
                    />
                  </div>
                )}
                <div className="ks-list">
                  {shown.length === 0 ? (
                    <div className="ks-blank">Nothing matches “{q}”.</div>
                  ) : (
                    shown.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="ks-row"
                        onClick={() => {
                          setPicked(t);
                          setN(job === "count" ? Math.max(0, Math.round(t.stock)) : 1);
                        }}
                      >
                        <span className="ks-thumb" data-empty={t.imageUrl ? undefined : "1"}>
                          {t.imageUrl
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={t.imageUrl} alt="" loading="lazy" />
                            : <i>{t.name.trim().charAt(0).toUpperCase() || "?"}</i>}
                        </span>
                        <span className="ks-row-main">
                          <strong>{t.name}</strong>
                          <em>{t.spec ? t.spec : `counted in ${t.unit}`}</em>
                        </span>
                        <span className="ks-row-n" data-out={t.stock <= 0 ? "1" : undefined}>
                          {t.stock}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}

            {/* ── the number ─────────────────────────────────── */}
            {(job === "stock" || job === "count") && picked && (
              <div className="ks-num">
                <div className="ks-chosen">
                  <span className="ks-thumb" data-empty={picked.imageUrl ? undefined : "1"}>
                    {picked.imageUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={picked.imageUrl} alt="" />
                      : <i>{picked.name.trim().charAt(0).toUpperCase() || "?"}</i>}
                  </span>
                  <span>
                    <strong>{picked.name}</strong>
                    <em>
                      {job === "count"
                        ? `the register says ${picked.stock} ${picked.unit}`
                        : `${picked.stock} ${picked.unit} on the shelf now`}
                    </em>
                  </span>
                </div>

                <div className="ks-stepper">
                  <button
                    type="button"
                    onClick={() => setN((v) => Math.max(job === "count" ? 0 : 1, v - 1))}
                    disabled={pending}
                    aria-label="One less"
                  >
                    −
                  </button>
                  <input
                    className="ks-bignum"
                    inputMode="numeric"
                    value={String(n)}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "");
                      setN(v === "" ? 0 : Math.min(9999, Number(v)));
                    }}
                    aria-label="How many"
                  />
                  <button
                    type="button"
                    onClick={() => setN((v) => Math.min(9999, v + 1))}
                    disabled={pending}
                    aria-label="One more"
                  >
                    +
                  </button>
                </div>

                <div className="ks-quick">
                  {[1, 5, 10, 25, 50].map((k) => (
                    <button key={k} type="button" onClick={() => setN(job === "count" ? k : n + k)}>
                      {job === "count" ? k : `+${k}`}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  className="ks-go-btn"
                  disabled={pending || (job === "stock" && n < 1)}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("token", token);
                    fd.set("tool_id", picked.id);
                    if (job === "stock") { fd.set("qty", String(n)); run(() => addStockAction(fd)); }
                    else { fd.set("counted", String(n)); run(() => fixCountAction(fd)); }
                  }}
                >
                  {pending
                    ? "Saving…"
                    : job === "stock"
                      ? `Put ${n} ${picked.unit} in`
                      : `The shelf has ${n} ${picked.unit}`}
                </button>
                {job === "count" && (
                  <p className="ks-fine">
                    The old line stays in the register. A correction is a new line,
                    never a rub-out.
                  </p>
                )}
              </div>
            )}

            {/* ── a new tool ─────────────────────────────────── */}
            {job === "new" && (
              <div className="ks-new">
                <label className="ks-field">
                  <span>Name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="450mm tool"
                    maxLength={80}
                  />
                </label>

                <div className="ks-two">
                  <label className="ks-field">
                    <span>Counted in</span>
                    <input
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      placeholder="pcs"
                      maxLength={16}
                    />
                  </label>
                  <label className="ks-field">
                    <span>On the shelf now</span>
                    <input
                      inputMode="numeric"
                      value={String(opening)}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, "");
                        setOpening(v === "" ? 0 : Math.min(9999, Number(v)));
                      }}
                    />
                  </label>
                </div>

                <button
                  type="button"
                  className="ks-photo"
                  onClick={() => fileRef.current?.click()}
                  disabled={pending}
                >
                  {photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl} alt="" />
                  ) : (
                    <span className="ks-photo-ic" aria-hidden>📷</span>
                  )}
                  <span>
                    <strong>{photo ? "Change the photo" : "Take a photo"}</strong>
                    <em>{photoNote ?? "The men know the thing before they know the name"}</em>
                  </span>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={(e) => void choosePhoto(e.target.files?.[0] ?? null)}
                />

                <button
                  type="button"
                  className="ks-go-btn"
                  disabled={pending || name.trim().length < 2}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("token", token);
                    fd.set("name", name);
                    fd.set("unit", unit);
                    fd.set("opening", String(opening));
                    if (photo) fd.set("photo", photo);
                    run(() => newToolAction(fd));
                  }}
                >
                  {pending ? "Saving…" : "Add it to the store"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export const KEEPER_CSS = `
/* ── the button ─────────────────────────────────────────── */
.ks-fab {
  position:fixed; left:50%; transform:translateX(-50%);
  bottom:calc(16px + env(safe-area-inset-bottom)); z-index:60;
  display:flex; align-items:center; gap:8px; cursor:pointer;
  padding:15px 26px; border:none; border-radius:999px; font:inherit;
  font-size:15.5px; font-weight:800; color:#fff; white-space:nowrap;
  background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);
  box-shadow:0 10px 26px rgba(79,70,229,.42), 0 2px 6px rgba(0,0,0,.18);
}
.ks-fab:active { transform:translateX(-50%) scale(.97); }
.ks-fab span { font-size:19px; line-height:1; }

/* ── the sheet ──────────────────────────────────────────── */
.ks-wrap { position:fixed; inset:0; z-index:70; display:flex; align-items:flex-end; }
.ks-scrim { position:absolute; inset:0; background:rgba(12,12,16,.5); backdrop-filter:blur(2px); }
.ks-sheet {
  position:relative; width:100%; max-height:92dvh; overflow-y:auto;
  background:#fff; color:#15181d; border-radius:24px 24px 0 0;
  padding:10px 16px calc(22px + env(safe-area-inset-bottom));
  box-shadow:0 -12px 40px rgba(0,0,0,.28);
  animation:ks-up .22s cubic-bezier(.2,.8,.3,1);
}
@keyframes ks-up { from { transform:translateY(14%); opacity:.6; } to { transform:none; opacity:1; } }
.ks-grab { width:40px; height:4px; border-radius:99px; background:#d9d7d2; margin:2px auto 10px; }
.ks-head { display:flex; align-items:center; gap:8px; margin-bottom:12px; }
.ks-head h2 { flex:1; margin:0; font-size:19px; font-weight:800; letter-spacing:-.02em; }
.ks-back, .ks-x {
  width:34px; height:34px; flex:0 0 auto; border-radius:11px; cursor:pointer;
  border:1px solid #e6e4df; background:#faf9f7; color:#6b7280; font-size:15px; line-height:1;
}
.ks-back { font-size:22px; }
.ks-err {
  margin-bottom:12px; padding:11px 13px; border-radius:12px; font-size:13.5px; font-weight:600;
  background:#fef2f2; color:#b91c1c; border:1px solid rgba(185,28,28,.3);
}

/* ── the three jobs ─────────────────────────────────────── */
.ks-menu { display:flex; flex-direction:column; gap:10px; }
.ks-menu button {
  display:flex; align-items:center; gap:13px; width:100%; text-align:left; cursor:pointer;
  padding:15px; border-radius:17px; font:inherit; color:inherit;
  background:#faf9f7; border:1.5px solid #e6e4df;
}
.ks-menu button:active { transform:scale(.99); }
.ks-menu strong { display:block; font-size:16px; font-weight:800; }
.ks-menu em { display:block; font-style:normal; font-size:12.5px; color:#6b7280; margin-top:1px; }
.ks-ic {
  width:46px; height:46px; flex:0 0 auto; border-radius:15px; font-size:21px;
  display:grid; place-items:center;
}
.ks-ic[data-t="in"]  { background:#ecfdf5; }
.ks-ic[data-t="fix"] { background:#fffbeb; }
.ks-ic[data-t="new"] { background:#eef2ff; }
.ks-go { margin-left:auto; font-size:20px; color:#b8b5ad; }

/* ── pick a tool ────────────────────────────────────────── */
.ks-search {
  display:flex; align-items:center; gap:9px; margin-bottom:10px;
  padding:0 13px; border-radius:13px; background:#faf9f7; border:1.5px solid #e6e4df;
}
.ks-search input {
  flex:1; min-width:0; border:none; background:none; outline:none;
  font:inherit; font-size:16px; padding:13px 0; color:inherit;
}
.ks-list { display:flex; flex-direction:column; gap:8px; }
.ks-row {
  display:flex; align-items:center; gap:12px; width:100%; text-align:left; cursor:pointer;
  padding:10px 12px; border-radius:15px; font:inherit; color:inherit;
  background:#fff; border:1.5px solid #e6e4df;
}
.ks-row:active { transform:scale(.99); }
.ks-row-main { flex:1; min-width:0; }
.ks-row-main strong { display:block; font-size:15.5px; font-weight:800; }
.ks-row-main em { display:block; font-style:normal; font-size:12px; color:#6b7280; }
.ks-row-n { font-size:19px; font-weight:800; color:#059669; }
.ks-row-n[data-out] { color:#dc2626; }
.ks-blank { padding:22px; text-align:center; color:#6b7280; font-size:14px; }

/* ── the number ─────────────────────────────────────────── */
.ks-num { display:flex; flex-direction:column; gap:14px; }
.ks-chosen { display:flex; align-items:center; gap:12px; }
.ks-chosen strong { display:block; font-size:17px; font-weight:800; }
.ks-chosen em { display:block; font-style:normal; font-size:12.5px; color:#6b7280; margin-top:2px; }
.ks-stepper { display:flex; align-items:center; gap:12px; }
.ks-stepper button {
  width:60px; height:60px; flex:0 0 auto; border-radius:19px; cursor:pointer;
  font:inherit; font-size:27px; font-weight:700;
  background:#f2f1ee; border:1.5px solid #e6e4df; color:#15181d;
}
.ks-stepper button:disabled { opacity:.4; }
.ks-bignum {
  flex:1; min-width:0; text-align:center; font:inherit; font-size:40px; font-weight:800;
  letter-spacing:-.03em; padding:8px 4px; border-radius:17px; color:#15181d;
  border:1.5px solid #e6e4df; background:#fff; outline:none;
}
.ks-quick { display:flex; gap:7px; }
.ks-quick button {
  flex:1; padding:10px 0; border-radius:12px; cursor:pointer; font:inherit;
  font-size:13.5px; font-weight:700; background:#faf9f7; border:1.5px solid #e6e4df; color:#4b5563;
}
.ks-go-btn {
  width:100%; padding:17px; border:none; border-radius:17px; cursor:pointer; font:inherit;
  font-size:16.5px; font-weight:800; color:#fff;
  background:linear-gradient(135deg,#059669 0%,#047857 100%);
  box-shadow:0 8px 20px rgba(5,150,105,.3);
}
.ks-go-btn:disabled { background:#d9d7d2; color:#8b8b8b; box-shadow:none; }
.ks-fine { margin:0; font-size:12px; line-height:1.5; color:#6b7280; text-align:center; }

/* ── a new tool ─────────────────────────────────────────── */
.ks-new { display:flex; flex-direction:column; gap:12px; }
.ks-field { display:flex; flex-direction:column; gap:5px; }
.ks-field > span { font-size:11px; font-weight:800; letter-spacing:.07em;
  text-transform:uppercase; color:#6b7280; }
.ks-field input {
  width:100%; padding:14px; font:inherit; font-size:16px; border-radius:13px;
  border:1.5px solid #e6e4df; background:#fff; color:#15181d; outline:none;
}
.ks-field input:focus { border-color:#4f46e5; }
.ks-two { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.ks-photo {
  display:flex; align-items:center; gap:13px; width:100%; text-align:left; cursor:pointer;
  padding:11px 13px; border-radius:15px; font:inherit; color:inherit;
  background:#faf9f7; border:1.5px dashed #d9d7d2;
}
.ks-photo img { width:52px; height:52px; flex:0 0 auto; border-radius:13px; object-fit:cover; }
.ks-photo-ic {
  width:52px; height:52px; flex:0 0 auto; border-radius:13px; font-size:23px;
  display:grid; place-items:center; background:#eef2ff;
}
.ks-photo strong { display:block; font-size:14.5px; font-weight:800; }
.ks-photo em { display:block; font-style:normal; font-size:12px; color:#6b7280; margin-top:1px; }

/* ── shared thumbnail ───────────────────────────────────── */
.ks-thumb {
  width:54px; height:54px; flex:0 0 auto; border-radius:15px; overflow:hidden;
  display:grid; place-items:center; background:#f2f1ee;
}
.ks-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.ks-thumb i { font-style:normal; font-size:19px; font-weight:800; color:#8b8b8b; }
`;
