-- Administração: apagar um utilizador (só sem pedidos submetidos e sem decisões sobre pedidos de outros).
-- Reconstruída em 11/11/2026 a partir da definição em produção (Supabase Legendre-Expenses):
-- esta alteração tinha sido corrida no Supabase sem ficar guardada no repositório.
-- Pode voltar a correr sem problema.

CREATE OR REPLACE FUNCTION public.exp_admin_delete_user(p_staff uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare v_name text; v_email text;
begin
  if not exp_private.is_admin() then raise exception 'Só o administrador pode apagar utilizadores'; end if;
  if p_staff = exp_private.me() then raise exception 'Não pode apagar a sua própria conta'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indique o motivo'; end if;
  select full_name, lower(email) into v_name, v_email from public.staff_members where id = p_staff;
  if v_name is null then raise exception 'Utilizador não encontrado'; end if;
  if exists (select 1 from public.exp_claims where staff_member_id = p_staff and (status <> 'draft' or submitted_at is not null)) then
    raise exception '% tem pedidos submetidos, que têm de ser conservados (legislação fiscal). Desative a conta em vez de a apagar.', v_name;
  end if;
  if exists (select 1 from public.exp_history h join public.exp_claims c on c.id = h.claim_id where h.actor_id = p_staff and c.staff_member_id <> p_staff) then
    raise exception '% já aprovou ou tratou pedidos de outros colaboradores. Desative a conta em vez de a apagar.', v_name;
  end if;
  perform set_config('exp.rpc', 'on', true);
  delete from public.exp_claims where staff_member_id = p_staff;
  update public.exp_profiles set manager_id = null where manager_id = p_staff;
  update public.exp_cost_centers set owner_id = null where owner_id = p_staff;
  update public.exp_audit set action = '[' || v_name || '] ' || action, actor_id = null where actor_id = p_staff;
  delete from public.staff_members where id = p_staff;
  delete from auth.users where lower(email) = v_email;
  insert into public.exp_audit(actor_id, action) values (exp_private.me(), 'Apagou utilizador ' || v_name || ' (' || v_email || ') — ' || btrim(p_reason));
end;
$function$;
revoke execute on function public.exp_admin_delete_user(uuid, text) from public;
grant execute on function public.exp_admin_delete_user(uuid, text) to authenticated;

notify pgrst, 'reload schema';
