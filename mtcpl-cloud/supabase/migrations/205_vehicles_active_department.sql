-- 205: allow 'vehicles' in profiles.active_department (Daksh, Jul 2026).
--
-- The mig-204 Vehicles department missed this step of the new-department
-- checklist: the active_department CHECK (last extended by mig 189) didn't
-- include 'vehicles', so setActiveDepartmentAction's UPDATE failed silently
-- and the sidebar stayed stuck on the previous department after switching.

alter table public.profiles
  drop constraint if exists profiles_active_department_check;
alter table public.profiles
  add constraint profiles_active_department_check
    check (active_department in ('production', 'finance', 'inventory', 'invoicing', 'register', 'maintenance', 'salary', 'vehicles'));

notify pgrst, 'reload schema';
