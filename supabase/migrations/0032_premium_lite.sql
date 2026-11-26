-- 0032: a third Premium plan. Lite (49 rupees a month) joins Plus (99) and Max (179).
-- The plan perks themselves live in the site code (lib/domain/premium.ts); the database only
-- needs to accept the new plan name. Max-only perks (double points, guest passes) are unchanged.
alter table public.profiles drop constraint if exists profiles_premium_plan_check;
alter table public.profiles add constraint profiles_premium_plan_check
  check (premium_plan in ('lite', 'plus', 'max'));
