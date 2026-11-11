-- DocuSign retirado da plataforma.
-- Reconstruída em 11/11/2026 a partir da definição em produção (Supabase Legendre-Expenses):
-- esta alteração tinha sido corrida no Supabase sem ficar guardada no repositório.
-- Pode voltar a correr sem problema.

-- A vista não deixa remover uma coluna com «create or replace»: recria-se
drop view if exists public.exp_people;
create view public.exp_people as
  select s.id, s.full_name, s.email, p.role, p.manager_id, p.company_id, p.matricula, p.active, p.created_at, p.uses_km
  from public.staff_members s
  join public.exp_profiles p on p.staff_member_id = s.id
  where exp_private.is_active_user() or s.id = exp_private.me();
grant select on public.exp_people to authenticated;

alter table public.exp_profiles drop column if exists docusign;
alter table public.exp_settings drop column if exists docusign_enabled;
drop table if exists public.exp_signatures;

notify pgrst, 'reload schema';
