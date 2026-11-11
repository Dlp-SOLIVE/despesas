-- Quilómetros: declaração de seguro automóvel obrigatória e submissão em qualquer dia do mês.
-- Reconstruída em 11/11/2026 a partir da definição em produção (Supabase Legendre-Expenses):
-- esta alteração tinha sido corrida no Supabase sem ficar guardada no repositório.
-- Pode voltar a correr sem problema.

-- Sem declaração de seguro no pedido não se registam deslocações
CREATE OR REPLACE FUNCTION exp_private.trip_requires_insurance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not exists (select 1 from public.exp_claims where id = new.claim_id and insurance_declared) then
    raise exception 'Assinale a declaração de seguro automóvel antes de registar deslocações';
  end if;
  return new;
end;
$function$;

drop trigger if exists exp_trips_insurance on public.exp_trips;
create trigger exp_trips_insurance before insert on public.exp_trips
  for each row execute function exp_private.trip_requires_insurance();

-- Não deixa retirar a declaração enquanto houver deslocações
CREATE OR REPLACE FUNCTION exp_private.keep_insurance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.insurance_declared and not new.insurance_declared
     and exists (select 1 from public.exp_trips where claim_id = new.id) then
    raise exception 'Apague primeiro as deslocações para retirar a declaração de seguro';
  end if;
  return new;
end;
$function$;

drop trigger if exists exp_claims_keep_insurance on public.exp_claims;
create trigger exp_claims_keep_insurance before update of insurance_declared on public.exp_claims
  for each row execute function exp_private.keep_insurance();

-- Sem regra do dia 20: submissão a partir do dia 1
update public.exp_settings set open_day = 1 where id = 1;
