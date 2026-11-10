-- Língua dos emails: guarda no perfil a língua escolhida na plataforma (PT / EN).
-- A plataforma grava-a sozinha quando a pessoa entra ou carrega em PT/EN; a função exp-notify usa-a.
-- Pode voltar a correr sem problema.

alter table public.exp_profiles add column if not exists lang text not null default 'pt';
do $$ begin
  alter table public.exp_profiles add constraint exp_profiles_lang_chk check (lang in ('pt', 'en'));
exception when duplicate_object then null;
end $$;

-- p_lang = 'pt'/'en' grava; null só lê. Devolve sempre a língua guardada.
create or replace function public.exp_sync_lang(p_lang text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v text;
begin
  if p_lang in ('pt', 'en') then
    update public.exp_profiles set lang = p_lang
    where staff_member_id = exp_private.me() and lang is distinct from p_lang;
  end if;
  select lang into v from public.exp_profiles where staff_member_id = exp_private.me();
  return v;
end;
$$;
revoke execute on function public.exp_sync_lang(text) from public;
grant execute on function public.exp_sync_lang(text) to authenticated;

notify pgrst, 'reload schema';

-- Para mudar a língua de alguém à mão:
--   update public.exp_profiles set lang = 'en'
--   where staff_member_id = (select id from public.staff_members where email ilike 'nome@empresa.pt');
