"use client";

import { useState } from "react";

import { BlockCardPreview } from "@/components/stone-previews";
import type { StoneType as Stone } from "@/lib/types";

type BlockRecord = {
  id: string;
  stone: Stone;
  yard: number;
  category: string;
  length_ft: number | string;
  width_ft: number | string;
  height_ft: number | string;
  status: string;
  created_at: string;
};

function feetToInches(value: number | string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 12 * 100) / 100;
}

function toCft(length: number, width: number, height: number) {
  if (!length || !width || !height) return "—";
  return ((length * width * height) / 1728).toFixed(2);
}

function statusClass(status: string) {
  return `status-badge status-${status}`;
}

export function BlocksManager({
  blocks,
  suggestedId,
  addAction,
  updateAction,
  deleteAction
}: {
  blocks: BlockRecord[];
  suggestedId: string;
  addAction: (formData: FormData) => void | Promise<void>;
  updateAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
}) {
  const [stone, setStone] = useState<Stone>("PinkStone");
  const [lengthIn, setLengthIn] = useState("72");
  const [widthIn, setWidthIn] = useState("48");
  const [heightIn, setHeightIn] = useState("24");
  const [editingId, setEditingId] = useState<string | null>(null);

  const cft = toCft(Number(lengthIn), Number(widthIn), Number(heightIn));

  return (
    <div className="records-stack">
      <section className="page-card">
        <div className="page-heading">
          <div>
            <h1>Blocks</h1>
            <p className="muted">Register stock with inches-based entry, live CFT, and a visual yard-ready card grid.</p>
          </div>
        </div>

        <form action={addAction} className="records-stack">
          <div className="form-row">
            <label className="stack form-col-3">
              <span>Block Code</span>
              <input defaultValue={suggestedId} name="id" />
            </label>

            <div className="stack form-col-3">
              <span>Stone Type</span>
              <div className="segmented-control">
                {(["PinkStone", "WhiteStone"] as Stone[]).map((option) => (
                  <button
                    className={stone === option ? "active" : ""}
                    key={option}
                    onClick={(event) => {
                      event.preventDefault();
                      setStone(option);
                    }}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
              <input name="stone" type="hidden" value={stone} />
            </div>

            <label className="stack form-col-2">
              <span>Yard</span>
              <select defaultValue="1" name="yard">
                <option value="1">Yard 1</option>
                <option value="2">Yard 2</option>
                <option value="3">Yard 3</option>
              </select>
            </label>

            <label className="stack form-col-2">
              <span>Category</span>
              <select defaultValue="Fresh" name="category">
                <option value="Fresh">Fresh</option>
                <option value="Reused">Reused</option>
              </select>
            </label>

            <div className="stack form-col-2">
              <span>CFT</span>
              <div className="readonly-field">{cft}</div>
            </div>

            <label className="stack form-col-2">
              <span>Length (in)</span>
              <input name="length_in" onChange={(e) => setLengthIn(e.target.value)} step="0.01" type="number" value={lengthIn} />
            </label>

            <label className="stack form-col-2">
              <span>Width (in)</span>
              <input name="width_in" onChange={(e) => setWidthIn(e.target.value)} step="0.01" type="number" value={widthIn} />
            </label>

            <label className="stack form-col-2">
              <span>Height (in)</span>
              <input name="height_in" onChange={(e) => setHeightIn(e.target.value)} step="0.01" type="number" value={heightIn} />
            </label>

            <div className="form-col-2">
              <input name="status" type="hidden" value="available" />
              <button className="primary-button" style={{ width: "100%" }} type="submit">
                Add Block
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className="page-card">
        <div className="section-heading">
          <div>
            <h2>Inventory Cards</h2>
            <p className="muted">{blocks.length} blocks in the current stock register.</p>
          </div>
        </div>

        <div className="block-card-grid">
          {blocks.map((block) => {
            const li = feetToInches(block.length_ft);
            const wi = feetToInches(block.width_ft);
            const hi = feetToInches(block.height_ft);
            const blockCft = toCft(li, wi, hi);
            const isPink = block.stone === "PinkStone";
            const isEditing = editingId === block.id;

            return (
              <article className="block-card" key={block.id}>
                <div className="block-card-visual">
                  <BlockCardPreview
                    h={Math.max(16, hi)}
                    l={Math.max(36, li)}
                    stone={block.stone}
                    w={Math.max(24, wi)}
                  />
                </div>

                <div className="block-card-title">
                  <div>
                    <strong>{block.id}</strong>
                    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span className={`stone-badge ${isPink ? "stone-badge-pink" : "stone-badge-white"}`}>{block.stone}</span>
                      <span className="yard-badge">Yard {block.yard}</span>
                      <span className={statusClass(block.status)}>{block.status.replaceAll("_", " ")}</span>
                    </div>
                  </div>
                  <div className="block-card-actions">
                    <button className="card-icon-button" onClick={() => setEditingId(isEditing ? null : block.id)} type="button">
                      Edit
                    </button>
                  </div>
                </div>

                <div className="block-card-meta">
                  <div className="block-card-dimensions">{li}" × {wi}" × {hi}"</div>
                  <div>CFT {blockCft}</div>
                  <div>{block.category}</div>
                </div>

                {isEditing ? (
                  <form action={updateAction} className="records-stack" style={{ marginTop: 16 }}>
                    <input name="original_id" type="hidden" value={block.id} />
                    <div className="form-row">
                      <label className="stack form-col-6">
                        <span>Block Code</span>
                        <input defaultValue={block.id} name="id" required />
                      </label>
                      <label className="stack form-col-6">
                        <span>Stone Type</span>
                        <select defaultValue={block.stone} name="stone">
                          <option value="PinkStone">PinkStone</option>
                          <option value="WhiteStone">WhiteStone</option>
                        </select>
                      </label>
                      <label className="stack form-col-4">
                        <span>Yard</span>
                        <select defaultValue={String(block.yard)} name="yard">
                          <option value="1">Yard 1</option>
                          <option value="2">Yard 2</option>
                          <option value="3">Yard 3</option>
                        </select>
                      </label>
                      <label className="stack form-col-4">
                        <span>Category</span>
                        <select defaultValue={block.category} name="category">
                          <option value="Fresh">Fresh</option>
                          <option value="Reused">Reused</option>
                        </select>
                      </label>
                      <label className="stack form-col-4">
                        <span>Status</span>
                        <select defaultValue={block.status} name="status">
                          <option value="available">available</option>
                          <option value="reserved">reserved</option>
                          <option value="consumed">consumed</option>
                          <option value="discarded">discarded</option>
                        </select>
                      </label>
                      <label className="stack form-col-4">
                        <span>Length (in)</span>
                        <input defaultValue={String(li)} name="length_in" step="0.01" type="number" />
                      </label>
                      <label className="stack form-col-4">
                        <span>Width (in)</span>
                        <input defaultValue={String(wi)} name="width_in" step="0.01" type="number" />
                      </label>
                      <label className="stack form-col-4">
                        <span>Height (in)</span>
                        <input defaultValue={String(hi)} name="height_in" step="0.01" type="number" />
                      </label>
                      <label className="stack form-col-6">
                        <span>Delete code</span>
                        <input name="delete_code" placeholder="Enter delete code" />
                      </label>
                      <div className="form-col-6 record-actions">
                        <button className="btn-danger" formAction={deleteAction} formNoValidate name="delete_target_id" type="submit" value={block.id}>
                          Delete
                        </button>
                        <button className="secondary-button" type="submit">
                          Save Changes
                        </button>
                      </div>
                    </div>
                  </form>
                ) : null}
              </article>
            );
          })}
        </div>

        {!blocks.length ? <div className="banner" style={{ marginTop: 16 }}>No blocks found yet. Add your first block above.</div> : null}
      </section>
    </div>
  );
}
