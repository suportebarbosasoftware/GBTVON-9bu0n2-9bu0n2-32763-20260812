-- performance: service-role-only transactional representative renewal/deactivation.
-- Defines the operation without changing any existing client, balance or transaction.
create or replace function public.gbtvon_rep_device_action(
  p_action text, p_rep_id uuid, p_rep_password text, p_device_id uuid, p_days integer default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rep public.representatives%rowtype;
  v_device public.devices%rowtype;
  v_cost numeric;
  v_balance public.representatives.credits%type;
  v_expiry timestamptz;
  v_now timestamptz := clock_timestamp();
  v_source_name text;
begin
  if p_action is null or p_action not in ('renewRepDevice', 'deactivateRepDevice') then
    return jsonb_build_object('error', 'Operação inválida.', 'code', 'invalid_action', 'status', 400);
  end if;
  if p_rep_id is null or coalesce(p_rep_password, '') = '' then
    return jsonb_build_object('error', 'Não autorizado.', 'code', 'access_denied', 'status', 401);
  end if;
  if p_action = 'renewRepDevice' then
    -- Serialize renewal credit debits for this representative only.
    select r.* into v_rep from public.representatives r where r.id = p_rep_id and r.active = true for update;
  else
    select r.* into v_rep from public.representatives r where r.id = p_rep_id and r.active = true;
  end if;
  if v_rep.id is null or v_rep.password_hash is distinct from p_rep_password then
    return jsonb_build_object('error', 'Não autorizado.', 'code', 'access_denied', 'status', 401);
  end if;
  if p_device_id is null then
    return jsonb_build_object('error', 'Dispositivo obrigatório.', 'code', 'invalid_device', 'status', 400);
  end if;
  if p_action = 'renewRepDevice' then
    if p_days is null or p_days < 1 then
      return jsonb_build_object('error', 'Prazo inválido.', 'code', 'invalid_period', 'status', 400);
    end if;
    v_cost := round(p_days::numeric / 30, 2);
    if v_rep.credits < v_cost then
      return jsonb_build_object('error', 'Créditos insuficientes.', 'code', 'insufficient_credits', 'status', 400);
    end if;
    -- Preserve JSON column conversion: do not silently round the current integer credit schema.
    -- trim_scale makes integral amounts valid integer JSON while retaining fractional precision.
    begin
      select r.credits into v_balance from jsonb_populate_record(null::public.representatives,
        jsonb_build_object('credits', trim_scale(v_rep.credits - v_cost))) r;
    exception when invalid_text_representation then
      return jsonb_build_object('error', 'O saldo está configurado em créditos inteiros e não aceita este custo fracionado. Use um prazo múltiplo de 30 dias.',
        'code', 'credit_precision', 'status', 422);
    end;
    select d.* into v_device from public.devices d where d.id = p_device_id and d.rep_id = p_rep_id for update;
    if v_device.id is null then
      return jsonb_build_object('error', 'Dispositivo não encontrado na sua rede.', 'code', 'device_not_found', 'status', 404);
    end if;
    v_expiry := greatest(coalesce(v_device.expires_at, v_now), v_now) + make_interval(days => p_days);
    update public.devices d set expires_at = v_expiry, activated = true, blocked_reason = null,
      block_reason_detail = null, blocked_at = null, updated_at = v_now
      where d.id = p_device_id and d.rep_id = p_rep_id returning d.* into v_device;
    update public.representatives r set credits = v_balance, updated_at = v_now
      where r.id = p_rep_id returning r.* into v_rep;
    insert into public.credit_transactions (rep_id, amount, type, description, device_mac, days)
      values (p_rep_id, ceil(v_cost)::integer, 'consume',
        format('Renovação %sd — %s (custo real: %s cr.)', p_days, v_device.mac_address, v_cost), v_device.mac_address, p_days);
  else
    update public.devices d set activated = false, current_content = null, current_content_type = null,
      current_content_at = null, updated_at = v_now
      where d.id = p_device_id and d.rep_id = p_rep_id returning d.* into v_device;
    if v_device.id is null then
      return jsonb_build_object('error', 'Dispositivo não encontrado na sua rede.', 'code', 'device_not_found', 'status', 404);
    end if;
  end if;
  select s.name into v_source_name from public.sources s where s.id = v_device.source_id;
  return jsonb_build_object('success', true,
    'device', to_jsonb(v_device) || jsonb_build_object('sources', case when v_source_name is null then null else jsonb_build_object('name', v_source_name) end),
    'rep', to_jsonb(v_rep) - 'password_hash', 'credit_cost', coalesce(v_cost, 0), 'new_expiry', v_device.expires_at);
end;
$$;
-- Only Edge Functions may execute it; anonymous/authenticated app clients are denied.
revoke all on function public.gbtvon_rep_device_action(text, uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.gbtvon_rep_device_action(text, uuid, text, uuid, integer) to service_role;
comment on function public.gbtvon_rep_device_action(text, uuid, text, uuid, integer) is 'Atomic scoped representative renewal/deactivation; service role only. Existing credentials and credit precision preserved.';
-- Reload the API schema cache so the Edge Function can resolve the new RPC.
notify pgrst, 'reload schema';
