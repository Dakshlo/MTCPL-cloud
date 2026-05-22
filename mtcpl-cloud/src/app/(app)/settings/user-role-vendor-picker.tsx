"use client";

/**
 * Role + carving-vendor picker for the Users panel on /settings.
 *
 * Pulled into its own client component (Daksh, May 2026) so the
 * vendor select can show/hide live as the admin flips the Role
 * dropdown. The wider settings page stays a server component;
 * this island just owns the two coupled selects.
 *
 * Behaviour:
 *  • Role dropdown lists every assignable role. When the admin
 *    picks "vendor", the vendor dropdown reveals itself and is
 *    required for the form to submit.
 *  • Vendor dropdown lists active CNC + Manual vendors so the
 *    admin can bind Mohit / Vivek / a lathe vendor / etc. with
 *    one click.
 *  • Both selects keep their `name` attribute even when hidden so
 *    the FormData payload to updateUserAction always has the
 *    correct keys (vendor_id is an empty string when unused; the
 *    server treats empty → NULL).
 */

import { useEffect, useId, useState } from "react";

export type RolePickerOption = { value: string; label: string };
export type VendorPickerOption = {
  id: string;
  name: string;
  vendor_type: "CNC" | "Manual";
};

export function UserRoleVendorPicker({
  roleOptions,
  vendorOptions,
  defaultRole,
  defaultVendorId,
}: {
  /** Roles the admin is allowed to assign (already trimmed per
   *  current user's permissions on the server side). */
  roleOptions: RolePickerOption[];
  /** Active carving vendors (CNC + Manual) — feeds the vendor select
   *  shown only when role === "vendor". */
  vendorOptions: VendorPickerOption[];
  defaultRole: string;
  defaultVendorId: string | null;
}) {
  const [role, setRole] = useState<string>(defaultRole);
  const [vendorId, setVendorId] = useState<string>(defaultVendorId ?? "");
  const vendorSelectId = useId();

  // Reset vendor binding when the admin flips away from "vendor" —
  // keeps the visible state honest. The server also force-NULLs
  // vendor_id for non-vendor roles as the authoritative backstop.
  useEffect(() => {
    if (role !== "vendor") setVendorId("");
  }, [role]);

  const isVendorRole = role === "vendor";
  // Group CNC + Manual under separate optgroups so the admin sees
  // "Mohit (CNC)" sitting in the CNC group and lathe vendors in the
  // Manual group at a glance.
  const cncVendors = vendorOptions.filter((v) => v.vendor_type === "CNC");
  const manualVendors = vendorOptions.filter((v) => v.vendor_type === "Manual");

  return (
    <>
      <label className="stack" style={{ flex: "1 1 140px" }}>
        <span>Role</span>
        <select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          {roleOptions.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      {/* Carving vendor picker. Visible only when role === "vendor"
          so the form isn't cluttered with an irrelevant control on
          non-vendor users. Keeps the name attribute either way so a
          stale vendor_id flushes to NULL on save when the admin
          changes role away from vendor. */}
      {isVendorRole ? (
        <label className="stack" style={{ flex: "2 1 200px" }}>
          <span>
            Carving vendor{" "}
            <span style={{ color: "var(--muted)", fontWeight: 500 }}>
              (which vendor cockpit does this user log into?)
            </span>
          </span>
          <select
            id={vendorSelectId}
            name="vendor_id"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            required
            style={{ fontWeight: 600 }}
          >
            <option value="">— pick a vendor —</option>
            {cncVendors.length > 0 && (
              <optgroup label="CNC vendors">
                {cncVendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            )}
            {manualVendors.length > 0 && (
              <optgroup label="Manual vendors (lathe / hand)">
                {manualVendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      ) : (
        // Hidden field keeps vendor_id in the FormData payload as an
        // empty string so the server reliably NULLs it when role is
        // not "vendor". Without this, switching role from vendor to
        // accountant would leave the old vendor_id intact because
        // the form wouldn't include the key at all.
        <input type="hidden" name="vendor_id" value="" />
      )}
    </>
  );
}
