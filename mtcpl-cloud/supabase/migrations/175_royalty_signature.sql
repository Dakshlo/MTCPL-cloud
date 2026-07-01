-- Migration 175 — optional on-screen vendor signature on a royalty entry (Daksh).
--
-- Accounts/manager can capture the vendor's signature (drawn on-screen with a
-- finger/stylus on a tablet, or a mouse on a desktop) when adding a royalty
-- paid/received entry. Stored as a small PNG data-URL so the owner can see it
-- while approving. Optional for now (may become mandatory later).

alter table vendor_royalty_entries add column if not exists signature_data text;
