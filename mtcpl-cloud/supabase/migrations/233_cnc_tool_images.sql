-- 233: a picture on every tool (Daksh, Oct 2026).
--
-- "If I add item, that item should show properly. We may also add image
-- to its thumbnail so user can also see image-wise product."
--
-- The men at the cupboard do not read "450mm tool" and picture a 450mm
-- tool — they picture the thing in their hand. A photo on the card is
-- the difference between reading a list and recognising a shelf, and it
-- matters most on the phone, where the person is holding the tool while
-- they look for it.
--
-- One nullable column and one public bucket. Public on purpose, and in
-- line with machine_images / temple_component_images: these are photos
-- of consumable tooling with nothing private in them, the cupboard QR
-- screen has no app login to sign a URL with, and a signed URL that
-- expires is a broken image on somebody's phone an hour later.

begin;

alter table public.cnc_tools
  add column if not exists image_path text;

comment on column public.cnc_tools.image_path is
  'Object path inside the public cnc_tool_images bucket. NULL = no photo; '
  'the screens fall back to a coloured initial.';

insert into storage.buckets (id, name, public)
values ('cnc_tool_images', 'cnc_tool_images', true)
on conflict (id) do nothing;

notify pgrst, 'reload schema';

commit;

-- ROLLBACK
-- begin;
-- alter table public.cnc_tools drop column if exists image_path;
-- delete from storage.buckets where id = 'cnc_tool_images';
-- notify pgrst, 'reload schema';
-- commit;
