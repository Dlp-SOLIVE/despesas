-- Emails automáticos (Edge Function exp-notify):
--   pedido submetido          → email ao manager
--   pedido aprovado (manager) → email ao colaborador
-- Substitui o trigger da migração 20261110120000_email_aprovador.sql. Pode voltar a correr sem problema.
-- Requer no Vault: exp_notify_url e exp_notify_secret (já criados).

create extension if not exists pg_net with schema extensions;

create or replace function exp_private.notify_status()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_event text;
  v_url text;
  v_secret text;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_event := case new.status when 'submitted' then 'submitted' when 'approved_mgr' then 'approved' end;
  if v_event is null then return new; end if;
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'exp_notify_url';
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'exp_notify_secret';
    if v_url is null or v_secret is null then
      raise warning 'exp-notify: falta exp_notify_url / exp_notify_secret no Vault';
      return new;
    end if;
    -- Assíncrono: enviado depois do commit; a decisão nunca fica à espera do email
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('claim_id', new.id, 'event', v_event),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-exp-secret', v_secret),
      timeout_milliseconds := 10000
    );
  exception when others then
    -- Uma falha no email nunca impede a submissão nem a aprovação
    raise warning 'exp-notify: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke execute on function exp_private.notify_status() from public, authenticated;

drop trigger if exists exp_claims_notify on public.exp_claims;
create trigger exp_claims_notify after update of status on public.exp_claims
  for each row execute function exp_private.notify_status();

drop function if exists exp_private.notify_submitted();
