-- Doorgeefluik voor alle ntfy-meldingen (edge function xinix-ntfy).
--
-- Alle meldingsfuncties posten hun melding naar signal_settings.ntfy_server.
-- Die wijst nu naar xinix-ntfy, dat (1) een tik op de melding het Dagadvies
-- laat openen, met de link naar het aandeel als knop (keuze gebruiker,
-- 2026-10-03), en (2) doorstuurt via _shared/ntfy.ts, dus bij de daglimiet van
-- ntfy.sh via de database. Waar het echt heen gaat staat in ntfy_upstream;
-- de database-relay gebruikt dat ook, anders zou hij naar het doorgeefluik
-- zelf terugsturen.

alter table public.signal_settings add column if not exists ntfy_upstream text not null default 'https://ntfy.sh';

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
  -- Alleen naar de echte ntfy-server, nooit naar een meegegeven adres.
  select nullif(trim(ntfy_upstream), '') into v_server from signal_settings where id = 1;
  return net.http_post(
    url := rtrim(coalesce(v_server, 'https://ntfy.sh'), '/'),
    body := p_payload,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000
  );
end $$;
revoke all on function public.xinix_ntfy_relay(jsonb) from public, anon, authenticated;
grant execute on function public.xinix_ntfy_relay(jsonb) to service_role;

-- Pas ná het deployen van xinix-ntfy (terugzetten: ntfy_server = ntfy_upstream).
update public.signal_settings
set ntfy_server = 'https://zfcjugqgufsyltxhvkuu.supabase.co/functions/v1/xinix-ntfy'
where id = 1 and rtrim(ntfy_server, '/') = rtrim(ntfy_upstream, '/');
