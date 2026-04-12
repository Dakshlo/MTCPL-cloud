import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { SlabSizedPreview } from "@/components/stone-previews";
import { requireAuth } from "@/lib/auth";
import { DIMENSION_MODES, PRIORITY_OPTIONS, colorFromGroupName, cubicFeet, formatNeedLabel, makeTempleSlabCode, neededDateFromDays, nextTempleSequence, numValue, textValue, toDecimalFeet } from "@/lib/slab";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function splitDecimalFeet(value: number) {
  const safe = Math.max(Number(value || 0), 0);
  const feet = Math.floor(safe);
  const inches = Number(((safe - feet) * 12).toFixed(2));
  return { feet, inches };
}

function slabValuesFromForm(formData: FormData, mode: string) {
  if (mode === "decimal_ft") {
    const lengthDecimal = numValue(formData, "length_decimal_ft", 0);
    const widthDecimal = numValue(formData, "width_decimal_ft", 0);
    const thicknessDecimal = numValue(formData, "thickness_decimal_ft", 0);
    const lengthParts = splitDecimalFeet(lengthDecimal);
    const widthParts = splitDecimalFeet(widthDecimal);
    const thicknessParts = splitDecimalFeet(thicknessDecimal);
    return {
      length_ft: lengthParts.feet,
      length_in: lengthParts.inches,
      width_ft: widthParts.feet,
      width_in: widthParts.inches,
      thickness_ft: thicknessParts.feet,
      thickness_in: thicknessParts.inches,
      length_decimal_ft: Number(lengthDecimal.toFixed(2)),
      width_decimal_ft: Number(widthDecimal.toFixed(2)),
      thickness_decimal_ft: Number(thicknessDecimal.toFixed(2))
    };
  }

  const lengthFt = numValue(formData, "length_ft", 0);
  const lengthIn = numValue(formData, "length_in", 0);
  const widthFt = numValue(formData, "width_ft", 0);
  const widthIn = numValue(formData, "width_in", 0);
  const thicknessFt = numValue(formData, "thickness_ft", 0);
  const thicknessIn = numValue(formData, "thickness_in", 0);

  return {
    length_ft: Math.round(lengthFt),
    length_in: Number(lengthIn.toFixed(2)),
    width_ft: Math.round(widthFt),
    width_in: Number(widthIn.toFixed(2)),
    thickness_ft: Math.round(thicknessFt),
    thickness_in: Number(thicknessIn.toFixed(2)),
    length_decimal_ft: toDecimalFeet(lengthFt, lengthIn),
    width_decimal_ft: toDecimalFeet(widthFt, widthIn),
    thickness_decimal_ft: toDecimalFeet(thicknessFt, thicknessIn)
  };
}

async function addSlabAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "office"]);
  const supabase = await createServerSupabaseClient();

  const templeId = textValue(formData, "temple_id");
  const mode = textValue(formData, "dimension_mode") || DIMENSION_MODES[0];
  const groupName = textValue(formData, "group_name");
  const component = textValue(formData, "component");
  const neededBy = neededDateFromDays(textValue(formData, "needed_in_days"));
  const notes = textValue(formData, "notes") || null;
  const priority = textValue(formData, "priority") || "Medium";
  const stoneType = textValue(formData, "stone_type") || "Pinkstone";

  if (!templeId || !component) {
    redirect("/slabs?toast=Temple+and+component+are+required");
  }

  const [{ data: temple, error: templeError }, { data: rows, error: rowsError }] = await Promise.all([
    supabase.from("temples").select("id, name, code_prefix").eq("id", templeId).single(),
    supabase.from("slabs").select("slab_code").eq("temple_id", templeId)
  ]);

  if (templeError || !temple) {
    redirect(`/slabs?toast=${encodeURIComponent(templeError?.message || "Temple not found")}`);
  }

  if (rowsError) {
    redirect(`/slabs?toast=${encodeURIComponent(rowsError.message)}`);
  }

  const nextSequence = nextTempleSequence((rows ?? []).map((row) => row.slab_code), temple.code_prefix);
  const slabCode = makeTempleSlabCode(temple.code_prefix, nextSequence);
  const dimensions = slabValuesFromForm(formData, mode);

  const { error } = await supabase.from("slabs").insert({
    slab_code: slabCode,
    temple_id: temple.id,
    temple_name: temple.name,
    component,
    group_name: groupName || null,
    group_color: colorFromGroupName(groupName),
    stone_type: stoneType,
    ...dimensions,
    cubic_ft: cubicFeet(dimensions.length_decimal_ft, dimensions.width_decimal_ft, dimensions.thickness_decimal_ft),
    priority,
    needed_by: neededBy,
    notes,
    status: "entered",
    created_by: profile.id,
    updated_by: profile.id
  });

  if (error) {
    redirect(`/slabs?toast=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/slabs");
  revalidatePath("/slab-viewer");
  revalidatePath("/dashboard");
  redirect(`/slabs?toast=${encodeURIComponent(`Slab ${slabCode} added`)}`);
}

export default async function SlabEntryPage() {
  await requireAuth(["owner", "office"]);

  const supabase = await createServerSupabaseClient();
  const [{ data: settings }, { data: temples }, { data: slabs, error }] = await Promise.all([
    supabase.from("system_settings").select("dimension_mode").limit(1).single(),
    supabase.from("temples").select("id, name, code_prefix").eq("is_active", true).order("display_order"),
    supabase
      .from("slabs")
      .select("id, slab_code, temple_name, component, group_name, group_color, stone_type, length_decimal_ft, width_decimal_ft, thickness_decimal_ft, cubic_ft, priority, needed_by, status, created_at")
      .order("created_at", { ascending: false })
      .limit(18)
  ]);

  if (error) throw new Error(error.message);

  const dimensionMode = settings?.dimension_mode || "ft_inch";
  const slabList = slabs ?? [];

  return (
    <>
      <section className="page-card inventory-hero inventory-hero-slabs">
        <div className="inventory-hero-copy">
          <div className="dashboard-chip">Fresh Intake</div>
          <h1>Slab Entry</h1>
          <p className="muted">
            This page is only for clean slab intake. Enter temple, component, size, group, priority, and timeline. Moving slabs forward happens from Slab Viewer.
          </p>
          <div className="inventory-chip-row">
            <span className="role-pill">{temples?.length ?? 0} active temples</span>
            <span className="role-pill">{slabList.filter((slab) => slab.status === "entered").length} entered</span>
            <span className="role-pill">Default stone Pinkstone</span>
          </div>
        </div>

        <div className="inventory-hero-panel">
          <div className="inventory-hero-art">
            <SlabSizedPreview stone="Pinkstone" lengthFt={4} thicknessFt={0.5} widthFt={2.5} />
            <div>
              <strong>Temple-prefixed slab codes</strong>
              <p className="muted">Each slab gets a unique auto-generated code from its temple prefix. Dimension mode follows Settings.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="page-card" style={{ marginTop: 16 }}>
        <div className="section-heading">
          <h2 style={{ margin: 0 }}>Create Requirement</h2>
          <p className="muted">Office creates the slab here. It will appear in Slab Viewer for readiness checks and assignment.</p>
        </div>

        <form action={addSlabAction} className="block-edit-form slab-entry-form" style={{ marginTop: 18 }}>
          <input name="dimension_mode" type="hidden" value={dimensionMode} />

          <div className="slab-entry-grid slab-entry-grid-three">
            <label className="stack">
              <span>Temple</span>
              <select defaultValue="" name="temple_id" required>
                <option value="">Select temple</option>
                {(temples ?? []).map((temple) => (
                  <option key={temple.id} value={temple.id}>
                    {temple.name} ({temple.code_prefix})
                  </option>
                ))}
              </select>
            </label>

            <label className="stack">
              <span>Stone type</span>
              <select defaultValue="Pinkstone" name="stone_type">
                <option value="Pinkstone">Pinkstone</option>
                <option value="Makrana">Makrana</option>
              </select>
            </label>

            <label className="stack">
              <span>Priority</span>
              <select defaultValue="Medium" name="priority">
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="slab-entry-grid slab-entry-grid-three">
            <label className="stack">
              <span>Component</span>
              <input name="component" placeholder="Parkota, border, panel, step..." required />
            </label>

            <label className="stack">
              <span>Group / layer</span>
              <input name="group_name" placeholder="Layer A / border set / dome ring" />
            </label>

            <label className="stack">
              <span>Needed in (days)</span>
              <input defaultValue="28" min="1" name="needed_in_days" type="number" />
            </label>
          </div>

          {dimensionMode === "decimal_ft" ? (
            <div className="slab-entry-grid slab-entry-grid-three">
              <label className="stack">
                <span>Length (decimal ft)</span>
                <input min="0" name="length_decimal_ft" step="0.01" type="number" />
              </label>
              <label className="stack">
                <span>Width (decimal ft)</span>
                <input min="0" name="width_decimal_ft" step="0.01" type="number" />
              </label>
              <label className="stack">
                <span>Thickness (decimal ft)</span>
                <input min="0" name="thickness_decimal_ft" step="0.01" type="number" />
              </label>
            </div>
          ) : (
            <div className="slab-entry-grid slab-entry-grid-three">
              <label className="stack">
                <span>Length</span>
                <div className="slab-dimension-split">
                  <input min="0" name="length_ft" placeholder="ft" step="1" type="number" />
                  <input min="0" name="length_in" placeholder="in" step="0.5" type="number" />
                </div>
              </label>
              <label className="stack">
                <span>Width</span>
                <div className="slab-dimension-split">
                  <input min="0" name="width_ft" placeholder="ft" step="1" type="number" />
                  <input min="0" name="width_in" placeholder="in" step="0.5" type="number" />
                </div>
              </label>
              <label className="stack">
                <span>Thickness</span>
                <div className="slab-dimension-split">
                  <input min="0" name="thickness_ft" placeholder="ft" step="1" type="number" />
                  <input min="0" name="thickness_in" placeholder="in" step="0.25" type="number" />
                </div>
              </label>
            </div>
          )}

          <label className="stack">
            <span>Notes</span>
            <textarea name="notes" placeholder="Drawing reference, site note, carving detail, or packing instruction" />
          </label>

          <div className="block-edit-footer">
            <p className="muted" style={{ fontSize: 12, flex: 1 }}>
              Slab code is generated automatically. This page does not move slabs forward in the workflow.
            </p>
            <button className="primary-button" type="submit">Create Slab</button>
          </div>
        </form>
      </section>

      <section className="page-card" style={{ marginTop: 16 }}>
        <div className="section-heading">
          <h2 style={{ margin: 0 }}>Recent Intake</h2>
          <p className="muted">A simple intake log for the newest slab requirements.</p>
        </div>

        <div className="records-stack" style={{ marginTop: 18 }}>
          {slabList.map((slab) => (
            <article className="record-card" key={slab.id}>
              <div className="record-head">
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <SlabSizedPreview
                    accent={slab.group_color}
                    lengthFt={Number(slab.length_decimal_ft)}
                    stone={slab.stone_type}
                    thicknessFt={Number(slab.thickness_decimal_ft)}
                    widthFt={Number(slab.width_decimal_ft)}
                  />
                  <div>
                    <strong>{slab.slab_code}</strong>
                    <p className="muted">{slab.temple_name} · {slab.component}</p>
                  </div>
                </div>
                <span className="role-pill">{slab.status.replaceAll("_", " ")}</span>
              </div>

              <div className="inventory-chip-row">
                <span className="role-pill">{slab.group_name || "No group"}</span>
                <span className="role-pill">{slab.priority}</span>
                <span className="role-pill">{slab.stone_type}</span>
                <span className="role-pill">{Number(slab.cubic_ft).toFixed(3)} cft</span>
                {formatNeedLabel(slab.needed_by) ? <span className="role-pill">{formatNeedLabel(slab.needed_by)}</span> : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
