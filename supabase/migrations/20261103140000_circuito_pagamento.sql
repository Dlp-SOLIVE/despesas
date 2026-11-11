-- Circuito de pagamento: manager aprova → RH regista → Administrativo regista o pagamento (data + referência) → Pago.
-- Reconstruída em 11/11/2026 a partir da definição em produção (Supabase Legendre-Expenses):
-- esta alteração tinha sido corrida no Supabase sem ficar guardada no repositório.
-- Pode voltar a correr sem problema.

alter table public.exp_claims add column if not exists paid_on date;
alter table public.exp_claims add column if not exists payment_ref text;

-- Versões anteriores da função (com e sem DocuSign)
drop function if exists public.exp_decide(uuid, text, text, jsonb);
drop function if exists public.exp_decide(uuid, text, text, jsonb, boolean);

-- p_action: 'approve' | 'return'; p_notes: {"<line_id>": "comentário"}
-- No último passo (Administrativo): p_paid_on obrigatório (até hoje) e p_payment_ref opcional
CREATE OR REPLACE FUNCTION public.exp_decide(p_claim uuid, p_action text, p_comment text, p_notes jsonb DEFAULT '{}'::jsonb, p_paid_on date DEFAULT NULL::date, p_payment_ref text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c public.exp_claims; v_role text := exp_private.my_role(); v_mgr uuid; v_next text; v_label text; k text;
begin
  select * into c from public.exp_claims where id = p_claim for update;
  if c.id is null then raise exception 'Pedido não encontrado'; end if;
  select manager_id into v_mgr from public.exp_profiles where staff_member_id = c.staff_member_id;
  if c.status = 'submitted' and v_mgr = exp_private.me() then v_next := 'approved_mgr'; v_label := 'Aprovado';
  elsif c.status = 'approved_mgr' and v_role in ('rh','admin') then v_next := 'validated_rh'; v_label := 'Registado RH';
  elsif c.status = 'validated_rh' and v_role in ('contabilidade','admin') then v_next := 'posted'; v_label := 'Pago';
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
    if v_next = 'posted' then
      if p_paid_on is null then raise exception 'Indique a data do pagamento'; end if;
      if p_paid_on > (now() at time zone 'Europe/Lisbon')::date then raise exception 'A data do pagamento não pode ser futura'; end if;
      update public.exp_claims set status = 'posted', posted_at = now(), paid_on = p_paid_on,
        payment_ref = nullif(btrim(coalesce(p_payment_ref, '')), '') where id = p_claim;
    else
      update public.exp_claims set status = v_next where id = p_claim;
    end if;
    insert into public.exp_history(claim_id, actor_id, action, comment)
    values (p_claim, exp_private.me(), v_label,
      case when v_next = 'posted'
        then 'Pago a ' || to_char(p_paid_on, 'DD/MM/YYYY') || coalesce(' · Ref. ' || nullif(btrim(coalesce(p_payment_ref, '')), ''), '') || coalesce(' — ' || nullif(btrim(p_comment), ''), '')
        else nullif(btrim(p_comment), '') end);
    insert into public.exp_audit(actor_id, action) values (exp_private.me(), v_label || ' pedido ' || c.period || ' · ' || c.cost_center);
  else raise exception 'Ação inválida';
  end if;
end;
$function$;
grant execute on function public.exp_decide(uuid, text, text, jsonb, date, text) to authenticated;

notify pgrst, 'reload schema';

-- Perfis (dados, feitos à parte em Administração → Utilizadores): RH = rh; Administrativo (pagamentos) = contabilidade.
