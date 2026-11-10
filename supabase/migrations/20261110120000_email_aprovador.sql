-- Email automático ao manager quando um pedido é submetido (Edge Function exp-notify + Resend).
-- Correr no SQL Editor DEPOIS de publicar a função exp-notify. Pode voltar a correr sem problema.
-- Antes (uma vez), guardar no Vault o endereço da função e o segredo partilhado:
--   select vault.create_secret('https://rfdsxigfodzayoxebbga.supabase.co/functions/v1/exp-notify', 'exp_notify_url');
--   select vault.create_secret('<texto-secreto-comprido>', 'exp_notify_secret');
-- (o mesmo texto secreto vai para Edge Functions → Secrets → NOTIFY_SECRET)

create extension if not exists pg_net with schema extensions;

create or replace function exp_private.notify_submitted()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_url text;
  v_secret text;
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    begin
      select decrypted_secret into v_url from vault.decrypted_secrets where name = 'exp_notify_url';
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'exp_notify_secret';
      if v_url is null or v_secret is null then
        raise warning 'exp-notify: falta exp_notify_url / exp_notify_secret no Vault';
        return new;
      end if;
      -- Assíncrono: o pedido é enviado depois do commit; a submissão nunca fica à espera do email
      perform net.http_post(
        url := v_url,
        body := jsonb_build_object('claim_id', new.id),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-exp-secret', v_secret),
        timeout_milliseconds := 10000
      );
    exception when others then
      -- Uma falha no email nunca impede a submissão
      raise warning 'exp-notify: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;
revoke execute on function exp_private.notify_submitted() from public, authenticated;

drop trigger if exists exp_claims_notify on public.exp_claims;
create trigger exp_claims_notify after update of status on public.exp_claims
  for each row execute function exp_private.notify_submitted();

-- Diagnóstico: últimas chamadas à função (código HTTP e resposta)
--   select id, status_code, content, error_msg, created from net._http_response order by created desc limit 10;
