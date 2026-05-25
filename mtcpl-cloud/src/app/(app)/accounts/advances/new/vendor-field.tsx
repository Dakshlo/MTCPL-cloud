"use client";

import { useState } from "react";
import { StyledSelect } from "@/components/styled-select";

// Daksh May 2026 round 2 — replaces the native <select> for the
// vendor pick on Record Vendor Advance. The native dropdown panel
// fell back to the OS dark-mode style which clashed with the
// finance theme; the shared StyledSelect renders a themed combobox
// with search (160+ vendors), keyboard nav, and a gold selected ✓.
//
// Stays a tiny client wrapper so the rest of the form (server
// component) can keep its current shape — the hidden input feeds
// vendor_id into the existing recordAdvanceFormAction submission.

export function AdvanceVendorField({
  vendors,
  defaultVendorId = "",
}: {
  vendors: Array<{ id: string; name: string }>;
  defaultVendorId?: string;
}) {
  const [vendorId, setVendorId] = useState(defaultVendorId);

  return (
    <>
      <input type="hidden" name="vendor_id" value={vendorId} required />
      <StyledSelect
        value={vendorId}
        onChange={setVendorId}
        placeholder="Pick a vendor…"
        searchPlaceholder="Search vendor name…"
        options={vendors.map((v) => ({
          value: v.id,
          label: v.name,
        }))}
        required
      />
    </>
  );
}
