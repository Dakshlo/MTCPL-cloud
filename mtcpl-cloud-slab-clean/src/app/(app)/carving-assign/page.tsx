import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { SlabSizedPreview } from "@/components/stone-previews";
import { requireAuth } from "@/lib/auth";
import { colorFromGroupName, formatNeedLabel, numValue, textValue } from "@/lib/slab";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function assignSingleVendorAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "assigner"]);
  const supabase = await createServerSupabaseClient();
  const slabId = textValue(formData, "slab_id");
  const vendorId = textValue(formData, "vendor_id");
  const outsidePrice = numValue(formData, "outside_price", 0) || null;

  if (!slabId || !vendorId) {
    redirect("/carving-assign?toast=Slab+and+vendor+are+required");
  }

  const [{ data: slab, error: slabError }, { data: vendor, error: vendorError }] = await Promise.all([
    supabase.from("slabs").select("id, temple_id").eq("id", slabId).single(),
    supabase.from("vendors").select("id, name").eq("id", vendorId).single()
  ]);

  if (slabError || !slab) redirect(`/carving-assign?toast=${encodeURIComponent(slabError?.message || "Slab not found")}`);
  if (vendorError || !vendor) redirect(`/carving-assign?toast=${encodeURIComponent(vendorError?.message || "Vendor not found")}`);

  if (profile.role === "assigner") {
    const { data: accessRows } = await supabase.from("user_temple_access").select("temple_id").eq("user_id", profile.id).eq("temple_id", slab.temple_id);
    if (!accessRows?.length) redirect("/carving-assign?toast=You+cannot+assign+for+this+temple");
  }

  const { error } = await supabase
    .from("slabs")
    .update({
      assigned_vendor_id: vendor.id,
      assigned_vendor_name: vendor.name,
      outside_price: outsidePrice,
      status: "assigned",
      updated_by: profile.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", slabId)
    .in("status", ["ready_for_assignment", "denied_rework"]);

  if (error) redirect(`/carving-assign?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/carving-assign");
  revalidatePath("/carving");
  revalidatePath("/slab-viewer");
  revalidatePath("/dashboard");
  redirect("/carving-assign?toast=Vendor+assigned");
}

export default async function AssignVendorPage() {
  const { profile } = await requireAuth(["owner", "assigner"]);
  const supabase = await createServerSupabaseClient();
  let allowedTempleIds: string[] | null = null;

  if (profile.role === "assigner") {
    const { data: accessRows } = await supabase.from("user_temple_access").select("temple_id").eq("user_id", profile.id);
    allowedTempleIds = (accessRows ?? []).map((row) => row.temple_id);
  }

  const slabsQuery = supabase
    .from("slabs")
    .select("id, slab_code, temple_id, temple_name, component, group_name, group_color, stone_type, length_decimal_ft, width_decimal_ft, thickness_decimal_ft, cubic_ft, priority, needed_by, outside_price, status")
    .in("status", ["ready_for_assignment", "denied_rework"])
    .order("temple_name")
    .order("needed_by", { ascending: true });

  if (allowedTempleIds && allowedTempleIds.length) slabsQuery.in("temple_id", allowedTempleIds);

  if (allowedTempleIds && !allowedTempleIds.length) {
    return (
      <section className="page-card">
        <h1>Assign Vendor</h1>
        <div className="banner" style={{ marginTop: 18 }}>
          This assigner account does not have temple access yet. Owner needs to configure temple access in Settings.
        </div>
      </section>
    );
  }

  const [{ data: slabs }, { data: vendors }] = await Promise.all([
    slabsQuery,
    supabase.from("vendors").select("id, name, vendor_type").eq("is_active", true).order("name")
  ]);

  return (
    <>
      <section className="page-card dashboard-hero">
        <div className="dashboard-hero-copy">
          <div className="dashboard-chip">Temple to Vendor</div>
          <h1>Assign Vendor</h1>
          <p className="muted">Only slabs marked ready in Slab Viewer appear here. Assigners can work temple-wise based on the temple access set in Settings.</p>
        </div>
      </section>

      <div className="records-stack" style={{ marginTop: 16 }}>
        {(slabs ?? []).map((slab) => {
          const accent = slab.group_color || colorFromGroupName(slab.group_name);
          return (
            <form action={assignSingleVendorAction} className="record-card" key={slab.id}>
              <input name="slab_id" type="hidden" value={slab.id} />

              <div className="record-head">
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <SlabSizedPreview
                    accent={accent}
                    lengthFt={Number(slab.length_decimal_ft)}
                    stone={slab.stone_type}
                    thicknessFt={Number(slab.thickness_decimal_ft)}
                    widthFt={Number(slab.width_decimal_ft)}
                  />
                  <div>
                    <strong>{slab.slab_code}</strong>
                    <p className="muted">{slab.temple_name} · {slab.component} · {slab.group_name || "No group"}</p>
                  </div>
                </div>
                <span className="role-pill">{slab.priority}</span>
              </div>

              <div className="inventory-chip-row">
                <span className="role-pill">{slab.status.replaceAll("_", " ")}</span>
                <span className="role-pill">{Number(slab.cubic_ft).toFixed(3)} cft</span>
                <span className="role-pill">{slab.stone_type}</span>
                {formatNeedLabel(slab.needed_by) ? <span className="role-pill">{formatNeedLabel(slab.needed_by)}</span> : null}
              </div>

              <div className="inventory-row" style={{ marginTop: 14 }}>
                <label className="stack">
                  <span>Vendor</span>
                  <select defaultValue="" name="vendor_id" required>
                    <option value="">Select vendor</option>
                    {(vendors ?? []).map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.name} ({vendor.vendor_type})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="stack">
                  <span>Outside price</span>
                  <input defaultValue={slab.outside_price || ""} min="0" name="outside_price" step="0.01" type="number" />
                </label>
              </div>

              <div className="record-actions" style={{ marginTop: 14 }}>
                <button className="primary-button" type="submit">Assign Vendor</button>
              </div>
            </form>
          );
        })}
      </div>
    </>
  );
}
