-- DocuSign: assinatura real das aprovações (opcional, pode ser desligada em Parâmetros)
alter table public.exp_settings add column if not exists docusign_enabled boolean not null default false;

create table if not exists public.exp_signatures (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.exp_claims(id) on delete cascade,
  step text not null check (step in ('submitted','approved_mgr')),
  signer_id uuid not null references public.staff_members(id),
  envelope_id text not null unique,
  status text not null default 'sent' check (status in ('sent','completed','declined','voided')),
  signed_path text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists exp_signatures_claim_idx on public.exp_signatures(claim_id);
alter table public.exp_signatures enable row level security;
grant select on public.exp_signatures to authenticated;
drop policy if exists exp_signatures_read on public.exp_signatures;
create policy exp_signatures_read on public.exp_signatures for select to authenticated using (exp_private.can_see_claim(claim_id));
-- escrita só pela Edge Function exp-docusign (service role)

-- exp_decide: se a aprovação diz "DocuSign", tem de existir assinatura concluída desse aprovador nesse passo
create or replace function public.exp_decide(p_claim uuid, p_action text, p_comment text, p_notes jsonb default '{}'::jsonb, p_docusign boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.exp_claims; v_role text := exp_private.my_role(); v_mgr uuid; v_next text; v_label text; k text; v_signed text;
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
    if p_docusign then
      select envelope_id into v_signed from public.exp_signatures
      where claim_id = p_claim and step = c.status and signer_id = exp_private.me() and status = 'completed'
      order by completed_at desc limit 1;
      if v_signed is null then raise exception 'Assinatura DocuSign não concluída'; end if;
    end if;
    update public.exp_claims set status = v_next, posted_at = case when v_next = 'posted' then now() else posted_at end where id = p_claim;
    insert into public.exp_history(claim_id, actor_id, action, comment)
    values (p_claim, exp_private.me(), v_label, case when v_next = 'posted' then nullif(btrim(p_comment), '')
      else (case when p_docusign then 'Plataforma + DocuSign (envelope ' || v_signed || ')' else 'Plataforma' end) || coalesce(' — ' || nullif(btrim(p_comment), ''), '') end);
    insert into public.exp_audit(actor_id, action) values (exp_private.me(), v_label || ' pedido ' || c.period || ' · ' || c.cost_center || case when p_docusign then ' (DocuSign)' else '' end);
  else raise exception 'Ação inválida';
  end if;
end;
$$;
grant execute on function public.exp_decide(uuid, text, text, jsonb, boolean) to authenticated;
