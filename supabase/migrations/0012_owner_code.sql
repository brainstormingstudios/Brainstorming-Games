-- 0012_owner_code: staff powers need a second factor.
--
-- Until now the admin or moderator role alone opened every staff function and policy. From here
-- the session must also have passed a time-based one-time code from an authenticator app
-- (Supabase multi-factor sign-in). Supabase marks such a session with the claim `aal: aal2` in its
-- token; a stolen password or a stolen magic link is only `aal1` and gets nothing.
--
-- Because every staff policy and function goes through app.is_staff() / app.is_admin(), changing
-- these two predicates locks the whole management portal at the database, not only in its UI.

/** True when this request's session has passed the owner code. */
create or replace function app.has_owner_code() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '') = 'aal2';
$$;

create or replace function app.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_owner_code() and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'moderator') and p.banned_at is null
  );
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_owner_code() and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.banned_at is null
  );
$$;

grant execute on function app.has_owner_code() to anon, authenticated, service_role;
