-- ntfy.sh telt zijn daglimiet (250 berichten) per IP-adres. De edge functions
-- delen hun uitgaande IP met andere Supabase-projecten, dus dat limiet is vaak
-- al halverwege de dag op (HTTP 429, "daily message quota reached"). Zo kwamen
-- de urgente Dagadvies-meldingen (gekocht, stop zetten, stop geraakt) pas de
-- volgende ochtend binnen, en verloren Hippos, Sprinters en de sterrenscan op
-- sommige dagen al hun meldingen.
--
-- De database heeft een eigen IP met een eigen limiet (Xinix verstuurt er
-- hoogstens een paar dozijn per dag). Lukt het direct niet, dan stuurt
-- `_shared/ntfy.ts` de melding via pg_net vanuit de database.

create or replace function public.xinix_ntfy_relay(p_payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_server text;
begin
  if p_payload is null or coalesce(p_payload->>'topic', '') = '' then
    raise exception 'ntfy-relay: topic ontbreekt';
  end if;
  -- Alleen naar de ingestelde ntfy-server, nooit naar een meegegeven adres.
  select nullif(trim(ntfy_server), '') into v_server from signal_settings where id = 1;
  return net.http_post(
    url := rtrim(coalesce(v_server, 'https://ntfy.sh'), '/'),
    body := p_payload,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000
  );
end $$;

-- Uitkomst van een doorgestuurde melding; NULL zolang pg_net hem nog niet heeft verstuurd.
create or replace function public.xinix_ntfy_relay_status(p_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'status', r.status_code,
    'error', coalesce(r.error_msg, case when r.timed_out then 'timeout' end),
    'body', left(r.content, 300)
  )
  from net._http_response r
  where r.id = p_id
$$;

revoke all on function public.xinix_ntfy_relay(jsonb) from public, anon, authenticated;
revoke all on function public.xinix_ntfy_relay_status(bigint) from public, anon, authenticated;
grant execute on function public.xinix_ntfy_relay(jsonb) to service_role;
grant execute on function public.xinix_ntfy_relay_status(bigint) to service_role;
