-- LEGENDRE · Despesas — esquema inicial
-- Supabase partilhado com o Sistema de Compras: todas as tabelas têm o prefixo exp_
-- e reutilizam public.staff_members (login comum). Não altera nenhuma tabela das Compras.

create extension if not exists pgcrypto;
create schema if not exists exp_private;
grant usage on schema exp_private to authenticated;

-- Se este Supabase não for o do Sistema de Compras, cria a tabela de equipa com a mesma estrutura.
-- Se já existir (projeto das Compras), não faz nada.
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where t.typname = 'app_role' and n.nspname = 'public') then
    create type public.app_role as enum ('admin', 'user', 'standard', 'viewer');
  end if;
end $$;

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  initials text,
  email text not null unique,
  phone text,
  role public.app_role not null default 'viewer',
  is_active boolean not null default false,
  authority_limit numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.staff_members enable row level security;
drop policy if exists exp_staff_self_read on public.staff_members;
create policy exp_staff_self_read on public.staff_members for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
grant select on public.staff_members to authenticated;

-- ───────────── Tabelas ─────────────
create table if not exists public.exp_companies (
  id text primary key,
  name text not null,
  nif text not null
);

create table if not exists public.exp_settings (
  id int primary key default 1 check (id = 1),
  km_rate numeric(6,3) not null default 0.40,
  max_age_months int not null default 3,
  open_day int not null default 20 check (open_day between 1 and 28),
  max_lines int not null default 24,
  retention_years int not null default 10,
  updated_at timestamptz not null default now()
);

create table if not exists public.exp_profiles (
  staff_member_id uuid primary key references public.staff_members(id) on delete cascade,
  role text not null default 'colaborador' check (role in ('colaborador','manager','rh','contabilidade','admin')),
  manager_id uuid references public.staff_members(id),
  company_id text references public.exp_companies(id),
  matricula text,
  active boolean not null default false,
  docusign boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exp_cost_centers (
  code text primary key check (code ~ '^[0-9]{2}-[0-9]{5}$'),
  label text not null,
  company_id text not null references public.exp_companies(id),
  owner_id uuid references public.staff_members(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.exp_vehicles (
  staff_member_id uuid primary key references public.staff_members(id) on delete cascade,
  model text not null default '',
  plate text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.exp_fav_trips (
  id uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  origin text not null,
  dest text not null,
  purpose text not null default '',
  km numeric(8,1) not null check (km > 0),
  round_trip boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.exp_claims (
  id uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references public.staff_members(id),
  cost_center text not null references public.exp_cost_centers(code),
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  status text not null default 'draft' check (status in ('draft','returned','submitted','approved_mgr','validated_rh','posted')),
  insurance_declared boolean not null default false,
  vehicle_model text,
  vehicle_plate text,
  km_rate numeric(6,3),
  submitted_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exp_claims_one_per_month unique (staff_member_id, cost_center, period)
);

create table if not exists public.exp_lines (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.exp_claims(id) on delete cascade,
  no int not null,
  receipt_date date,
  type text check (type in ('FDD','FDM','OFF')),
  sub text,
  details jsonb not null default '{}'::jsonb,
  client text,
  nif text,
  currency text not null default 'EUR' check (currency in ('EUR','GBP')),
  rate numeric(12,6) not null default 1,
  excl numeric(12,2),
  incl numeric(12,2),
  file_path text,
  file_type text,
  ocr jsonb,
  approver_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists exp_lines_claim_idx on public.exp_lines(claim_id);

create table if not exists public.exp_trips (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.exp_claims(id) on delete cascade,
  trip_date date not null,
  origin text not null,
  dest text not null,
  purpose text not null,
  km numeric(8,1) not null check (km > 0),
  round_trip boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists exp_trips_claim_idx on public.exp_trips(claim_id);

create table if not exists public.exp_history (
  id bigserial primary key,
  claim_id uuid not null references public.exp_claims(id) on delete cascade,
  actor_id uuid references public.staff_members(id),
  action text not null,
  comment text,
  at timestamptz not null default now()
);
create index if not exists exp_history_claim_idx on public.exp_history(claim_id);

-- Audit log: só inserção; ninguém altera nem apaga (nem o admin, pela aplicação)
create table if not exists public.exp_audit (
  id bigserial primary key,
  actor_id uuid references public.staff_members(id),
  action text not null,
  at timestamptz not null default now()
);

-- ───────────── Funções de acesso ─────────────
create or replace function exp_private.me()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.staff_members
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

create or replace function exp_private.my_role()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.exp_profiles where staff_member_id = exp_private.me() and active limit 1;
$$;

create or replace function exp_private.is_active_user()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exp_private.my_role() is not null;
$$;

create or replace function exp_private.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(exp_private.my_role() = 'admin', false);
$$;

create or replace function exp_private.is_backoffice()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(exp_private.my_role() in ('rh','contabilidade','admin'), false);
$$;

create or replace function exp_private.can_see_claim(target uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.exp_claims c
    left join public.exp_profiles p on p.staff_member_id = c.staff_member_id
    where c.id = target and exp_private.is_active_user() and (
      c.staff_member_id = exp_private.me()
      or p.manager_id = exp_private.me()
      or exp_private.is_backoffice()
    )
  );
$$;

create or replace function exp_private.can_edit_claim(target uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.exp_claims c
    where c.id = target and (
      (c.staff_member_id = exp_private.me() and c.status in ('draft','returned') and exp_private.is_active_user())
      or exp_private.is_admin()
    )
  );
$$;

grant execute on all functions in schema exp_private to authenticated;

-- Estado só muda através das funções exp_submit / exp_decide / exp_admin_reopen
create or replace function exp_private.guard_status()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and coalesce(current_setting('exp.rpc', true), '') <> 'on' then
    raise exception 'O estado do pedido só muda pelas ações da plataforma';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists exp_claims_guard_status on public.exp_claims;
create trigger exp_claims_guard_status before update on public.exp_claims
for each row execute function exp_private.guard_status();

create or replace function exp_private.touch()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
drop trigger if exists exp_lines_touch on public.exp_lines;
create trigger exp_lines_touch before update on public.exp_lines for each row execute function exp_private.touch();
drop trigger if exists exp_profiles_touch on public.exp_profiles;
create trigger exp_profiles_touch before update on public.exp_profiles for each row execute function exp_private.touch();

-- Utilizador não-admin não pode mudar o próprio perfil para admin/rh/etc.
create or replace function exp_private.guard_profile()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exp_private.is_admin() then
    if tg_op = 'UPDATE' and (new.role <> old.role or new.active <> old.active or new.manager_id is distinct from old.manager_id) then
      raise exception 'Só o administrador altera perfil, manager ou estado';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists exp_profiles_guard on public.exp_profiles;
create trigger exp_profiles_guard before update on public.exp_profiles for each row execute function exp_private.guard_profile();

-- ───────────── Vista de pessoas (nomes visíveis para quem precisa) ─────────────
create or replace view public.exp_people as
  select s.id, s.full_name, s.email, p.role, p.manager_id, p.company_id, p.matricula, p.active, p.docusign, p.created_at
  from public.staff_members s
  join public.exp_profiles p on p.staff_member_id = s.id
  where exp_private.is_active_user() or s.id = exp_private.me();
grant select on public.exp_people to authenticated;

-- ───────────── RLS ─────────────
alter table public.exp_companies enable row level security;
alter table public.exp_settings enable row level security;
alter table public.exp_profiles enable row level security;
alter table public.exp_cost_centers enable row level security;
alter table public.exp_vehicles enable row level security;
alter table public.exp_fav_trips enable row level security;
alter table public.exp_claims enable row level security;
alter table public.exp_lines enable row level security;
alter table public.exp_trips enable row level security;
alter table public.exp_history enable row level security;
alter table public.exp_audit enable row level security;

grant select, insert, update, delete on public.exp_companies, public.exp_settings, public.exp_profiles, public.exp_cost_centers,
  public.exp_vehicles, public.exp_fav_trips, public.exp_claims, public.exp_lines, public.exp_trips to authenticated;
grant select on public.exp_history to authenticated;
grant select, insert on public.exp_audit to authenticated;
grant usage on sequence public.exp_audit_id_seq to authenticated;

drop policy if exists exp_companies_read on public.exp_companies;
create policy exp_companies_read on public.exp_companies for select to authenticated using (exp_private.is_active_user());
drop policy if exists exp_companies_admin on public.exp_companies;
create policy exp_companies_admin on public.exp_companies for all to authenticated using (exp_private.is_admin()) with check (exp_private.is_admin());

drop policy if exists exp_settings_read on public.exp_settings;
create policy exp_settings_read on public.exp_settings for select to authenticated using (exp_private.is_active_user());
drop policy if exists exp_settings_admin on public.exp_settings;
create policy exp_settings_admin on public.exp_settings for update to authenticated using (exp_private.is_admin()) with check (exp_private.is_admin());

drop policy if exists exp_profiles_read on public.exp_profiles;
create policy exp_profiles_read on public.exp_profiles for select to authenticated using (staff_member_id = exp_private.me() or exp_private.is_active_user());
drop policy if exists exp_profiles_self_update on public.exp_profiles;
create policy exp_profiles_self_update on public.exp_profiles for update to authenticated using (staff_member_id = exp_private.me() or exp_private.is_admin()) with check (staff_member_id = exp_private.me() or exp_private.is_admin());
drop policy if exists exp_profiles_admin_delete on public.exp_profiles;
create policy exp_profiles_admin_delete on public.exp_profiles for delete to authenticated using (exp_private.is_admin());

drop policy if exists exp_cc_read on public.exp_cost_centers;
create policy exp_cc_read on public.exp_cost_centers for select to authenticated using (exp_private.is_active_user());
drop policy if exists exp_cc_admin_ins on public.exp_cost_centers;
create policy exp_cc_admin_ins on public.exp_cost_centers for insert to authenticated with check (exp_private.is_admin());
drop policy if exists exp_cc_admin_upd on public.exp_cost_centers;
create policy exp_cc_admin_upd on public.exp_cost_centers for update to authenticated using (exp_private.is_admin()) with check (exp_private.is_admin());

drop policy if exists exp_vehicles_own on public.exp_vehicles;
create policy exp_vehicles_own on public.exp_vehicles for all to authenticated using (staff_member_id = exp_private.me()) with check (staff_member_id = exp_private.me() and exp_private.is_active_user());
drop policy if exists exp_fav_own on public.exp_fav_trips;
create policy exp_fav_own on public.exp_fav_trips for all to authenticated using (staff_member_id = exp_private.me()) with check (staff_member_id = exp_private.me() and exp_private.is_active_user());

drop policy if exists exp_claims_read on public.exp_claims;
create policy exp_claims_read on public.exp_claims for select to authenticated using (exp_private.can_see_claim(id));
drop policy if exists exp_claims_insert on public.exp_claims;
create policy exp_claims_insert on public.exp_claims for insert to authenticated with check (staff_member_id = exp_private.me() and status = 'draft' and exp_private.is_active_user());
drop policy if exists exp_claims_update on public.exp_claims;
create policy exp_claims_update on public.exp_claims for update to authenticated using (exp_private.can_edit_claim(id)) with check (exp_private.can_edit_claim(id));
drop policy if exists exp_claims_delete on public.exp_claims;
create policy exp_claims_delete on public.exp_claims for delete to authenticated using (staff_member_id = exp_private.me() and status = 'draft' and not exists (select 1 from public.exp_lines l where l.claim_id = exp_claims.id));

drop policy if exists exp_lines_read on public.exp_lines;
create policy exp_lines_read on public.exp_lines for select to authenticated using (exp_private.can_see_claim(claim_id));
drop policy if exists exp_lines_write on public.exp_lines;
create policy exp_lines_write on public.exp_lines for insert to authenticated with check (exp_private.can_edit_claim(claim_id));
drop policy if exists exp_lines_update on public.exp_lines;
create policy exp_lines_update on public.exp_lines for update to authenticated using (exp_private.can_edit_claim(claim_id)) with check (exp_private.can_edit_claim(claim_id));
drop policy if exists exp_lines_delete on public.exp_lines;
create policy exp_lines_delete on public.exp_lines for delete to authenticated using (exp_private.can_edit_claim(claim_id));

drop policy if exists exp_trips_read on public.exp_trips;
create policy exp_trips_read on public.exp_trips for select to authenticated using (exp_private.can_see_claim(claim_id));
drop policy if exists exp_trips_write on public.exp_trips;
create policy exp_trips_write on public.exp_trips for insert to authenticated with check (exp_private.can_edit_claim(claim_id));
drop policy if exists exp_trips_update on public.exp_trips;
create policy exp_trips_update on public.exp_trips for update to authenticated using (exp_private.can_edit_claim(claim_id)) with check (exp_private.can_edit_claim(claim_id));
drop policy if exists exp_trips_delete on public.exp_trips;
create policy exp_trips_delete on public.exp_trips for delete to authenticated using (exp_private.can_edit_claim(claim_id));

drop policy if exists exp_history_read on public.exp_history;
create policy exp_history_read on public.exp_history for select to authenticated using (exp_private.can_see_claim(claim_id));

drop policy if exists exp_audit_insert on public.exp_audit;
create policy exp_audit_insert on public.exp_audit for insert to authenticated with check (actor_id = exp_private.me() and exp_private.is_active_user());
drop policy if exists exp_audit_read on public.exp_audit;
create policy exp_audit_read on public.exp_audit for select to authenticated using (exp_private.is_admin());

-- ───────────── Ações (RPC) ─────────────
-- Pedido de acesso: cria (se não existir) o registo em staff_members como 'viewer' inativo,
-- para não dar acesso ao Sistema de Compras, e um perfil de Despesas pendente.
create or replace function public.exp_request_access(p_full_name text, p_matricula text, p_company text)
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
  insert into public.exp_profiles(staff_member_id, matricula, company_id, active)
  values (v_id, nullif(btrim(p_matricula), ''), nullif(p_company, ''), false)
  on conflict (staff_member_id) do update set matricula = coalesce(excluded.matricula, public.exp_profiles.matricula), company_id = coalesce(excluded.company_id, public.exp_profiles.company_id);
end;
$$;
grant execute on function public.exp_request_access(text, text, text) to authenticated;

create or replace function public.exp_submit(p_claim uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.exp_claims;
  s public.exp_settings;
  v_lines int; v_trips int; v_period_start date; v_today date := (now() at time zone 'Europe/Lisbon')::date;
  v_bad int;
begin
  select * into c from public.exp_claims where id = p_claim for update;
  if c.id is null or c.staff_member_id <> exp_private.me() then raise exception 'Pedido não encontrado'; end if;
  if c.status not in ('draft','returned') then raise exception 'Este pedido já foi submetido'; end if;
  select * into s from public.exp_settings where id = 1;
  v_period_start := to_date(c.period || '-01', 'YYYY-MM-DD');
  if v_today < (v_period_start + (s.open_day - 1)) then raise exception 'A submissão abre a % de cada mês', s.open_day; end if;
  select count(*) into v_lines from public.exp_lines where claim_id = p_claim;
  select count(*) into v_trips from public.exp_trips where claim_id = p_claim;
  if v_lines + v_trips = 0 then raise exception 'O pedido está vazio'; end if;
  if v_lines > s.max_lines then raise exception 'Máximo de % recibos por formulário', s.max_lines; end if;
  select count(*) into v_bad from public.exp_lines
    where claim_id = p_claim and (file_path is null or receipt_date is null or type is null or sub is null or incl is null or excl is null
      or receipt_date > v_today or receipt_date < (v_today - make_interval(months => s.max_age_months))::date);
  if v_bad > 0 then raise exception '% recibo(s) com dados em falta ou fora do prazo', v_bad; end if;
  if v_trips > 0 and not c.insurance_declared then raise exception 'Falta a declaração de seguro automóvel'; end if;
  perform set_config('exp.rpc', 'on', true);
  update public.exp_claims set status = 'submitted', submitted_at = now(), km_rate = s.km_rate,
    vehicle_model = (select model from public.exp_vehicles where staff_member_id = c.staff_member_id),
    vehicle_plate = (select plate from public.exp_vehicles where staff_member_id = c.staff_member_id)
  where id = p_claim;
  update public.exp_lines set approver_note = null where claim_id = p_claim;
  insert into public.exp_history(claim_id, actor_id, action) values (p_claim, exp_private.me(), 'Submetido ao manager');
  insert into public.exp_audit(actor_id, action) values (exp_private.me(), 'Submeteu pedido ' || c.period || ' · ' || c.cost_center);
end;
$$;
grant execute on function public.exp_submit(uuid) to authenticated;

-- p_action: 'approve' | 'return'; p_notes: {"<line_id>": "comentário"}
create or replace function public.exp_decide(p_claim uuid, p_action text, p_comment text, p_notes jsonb default '{}'::jsonb, p_docusign boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.exp_claims; v_role text := exp_private.my_role(); v_mgr uuid; v_next text; v_label text; k text;
begin
  select * into c from public.exp_claims where id = p_claim for update;
  if c.id is null then raise exception 'Pedido não encontrado'; end if;
  select manager_id into v_mgr from public.exp_profiles where staff_member_id = c.staff_member_id;
  if c.status = 'submitted' and v_mgr = exp_private.me() then v_next := 'approved_mgr'; v_label := 'Aprovado';
  elsif c.status = 'approved_mgr' and v_role in ('rh','admin') then v_next := 'validated_rh'; v_label := 'Validado';
  elsif c.status = 'validated_rh' and v_role in ('contabilidade','admin') then v_next := 'posted'; v_label := 'Lançado';
  else raise exception 'Não tem permissão para decidir este pedido neste estado';
  end if;
  if c.staff_member_id = exp_private.me() and v_role <> 'admin' then raise exception 'Não pode aprovar o seu próprio pedido'; end if;
  perform set_config('exp.rpc', 'on', true);
  if p_action = 'return' then
    if coalesce(btrim(p_comment), '') = '' then raise exception 'Indique o motivo da devolução'; end if;
    update public.exp_claims set status = 'returned' where id = p_claim;
    for k in select jsonb_object_keys(coalesce(p_notes, '{}'::jsonb)) loop
      update public.exp_lines set approver_note = p_notes ->> k where id = k::uuid and claim_id = p_claim;
    end loop;
    insert into public.exp_history(claim_id, actor_id, action, comment) values (p_claim, exp_private.me(), 'Devolvido', p_comment);
    insert into public.exp_audit(actor_id, action) values (exp_private.me(), 'Devolveu pedido ' || c.period || ' · ' || c.cost_center);
  elsif p_action = 'approve' then
    update public.exp_claims set status = v_next, posted_at = case when v_next = 'posted' then now() else posted_at end where id = p_claim;
    insert into public.exp_history(claim_id, actor_id, action, comment)
    values (p_claim, exp_private.me(), v_label, case when v_next = 'posted' then nullif(btrim(p_comment), '') else (case when p_docusign then 'Plataforma + DocuSign' else 'Plataforma' end) || coalesce(' — ' || nullif(btrim(p_comment), ''), '') end);
    insert into public.exp_audit(actor_id, action) values (exp_private.me(), v_label || ' pedido ' || c.period || ' · ' || c.cost_center);
  else raise exception 'Ação inválida';
  end if;
end;
$$;
grant execute on function public.exp_decide(uuid, text, text, jsonb, boolean) to authenticated;

create or replace function public.exp_admin_reopen(p_claim uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exp_private.is_admin() then raise exception 'Só o administrador'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indique o motivo'; end if;
  perform set_config('exp.rpc', 'on', true);
  update public.exp_claims set status = 'draft' where id = p_claim;
  insert into public.exp_history(claim_id, actor_id, action, comment) values (p_claim, exp_private.me(), 'Reaberto pelo administrador', p_reason);
  insert into public.exp_audit(actor_id, action) values (exp_private.me(), 'Reabriu pedido ' || p_claim || ' — ' || p_reason);
end;
$$;
grant execute on function public.exp_admin_reopen(uuid, text) to authenticated;

create or replace function public.exp_admin_delete(p_claim uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.exp_claims;
begin
  if not exp_private.is_admin() then raise exception 'Só o administrador'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indique o motivo'; end if;
  select * into c from public.exp_claims where id = p_claim;
  insert into public.exp_audit(actor_id, action) values (exp_private.me(), 'Apagou pedido ' || c.period || ' · ' || c.cost_center || ' de ' || c.staff_member_id || ' — ' || p_reason);
  delete from public.exp_claims where id = p_claim;
end;
$$;
grant execute on function public.exp_admin_delete(uuid, text) to authenticated;

-- ───────────── Ficheiros (recibos) ─────────────
-- Caminho: <staff_member_id>/<claim_id>/<ficheiro>
insert into storage.buckets (id, name, public) values ('despesas-recibos', 'despesas-recibos', false)
on conflict (id) do nothing;

drop policy if exists "exp recibos read" on storage.objects;
create policy "exp recibos read" on storage.objects for select to authenticated
using (bucket_id = 'despesas-recibos' and exp_private.can_see_claim(((storage.foldername(name))[2])::uuid));
drop policy if exists "exp recibos insert" on storage.objects;
create policy "exp recibos insert" on storage.objects for insert to authenticated
with check (bucket_id = 'despesas-recibos' and (storage.foldername(name))[1] = exp_private.me()::text and exp_private.can_edit_claim(((storage.foldername(name))[2])::uuid));
drop policy if exists "exp recibos delete" on storage.objects;
create policy "exp recibos delete" on storage.objects for delete to authenticated
using (bucket_id = 'despesas-recibos' and exp_private.can_edit_claim(((storage.foldername(name))[2])::uuid));

-- ───────────── Dados iniciais ─────────────
insert into public.exp_companies(id, name, nif) values
  ('LEGDR', 'LEGDR Engenharia e Construção', '515 345 946'),
  ('IBER', 'Legendre Ibérica', '515 461 504')
on conflict (id) do update set name = excluded.name, nif = excluded.nif;

insert into public.exp_settings(id) values (1) on conflict (id) do nothing;

-- ───────────── Primeiro administrador ─────────────
-- Depois de criar a sua conta na plataforma, corra (trocando o email):
--   insert into public.exp_profiles(staff_member_id, role, active, company_id)
--   select id, 'admin', true, 'LEGDR' from public.staff_members where lower(email) = lower('o.seu.email@legendre.pt')
--   on conflict (staff_member_id) do update set role = 'admin', active = true;
