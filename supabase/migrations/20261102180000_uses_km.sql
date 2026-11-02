-- Colaboradores sem viatura pessoal: o mapa de km só aparece a quem o usa
alter table public.exp_profiles add column if not exists uses_km boolean not null default false;

create or replace view public.exp_people as
  select s.id, s.full_name, s.email, p.role, p.manager_id, p.company_id, p.matricula, p.active, p.docusign, p.created_at, p.uses_km
  from public.staff_members s
  join public.exp_profiles p on p.staff_member_id = s.id
  where exp_private.is_active_user() or s.id = exp_private.me();
grant select on public.exp_people to authenticated;

drop function if exists public.exp_request_access(text, text, text);
create or replace function public.exp_request_access(p_full_name text, p_matricula text, p_company text, p_uses_km boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_id uuid;
begin
  if v_email = '' then raise exception 'Sessão inválida'; end if;
  select id into v_id from public.staff_members where lower(email) = v_email limit 1;
  if v_id is null then
    insert into public.staff_members(full_name, initials, email, role, is_active)
    values (btrim(p_full_name), upper(left(regexp_replace(btrim(p_full_name), '(\S)\S*\s*', '\1', 'g'), 4)), v_email, 'viewer'::public.app_role, false)
    returning id into v_id;
  end if;
  insert into public.exp_profiles(staff_member_id, matricula, company_id, active, uses_km)
  values (v_id, nullif(btrim(p_matricula), ''), nullif(p_company, ''), false, coalesce(p_uses_km, false))
  on conflict (staff_member_id) do update set
    matricula = coalesce(excluded.matricula, public.exp_profiles.matricula),
    company_id = coalesce(excluded.company_id, public.exp_profiles.company_id),
    uses_km = excluded.uses_km;
end;
$$;
grant execute on function public.exp_request_access(text, text, text, boolean) to authenticated;
