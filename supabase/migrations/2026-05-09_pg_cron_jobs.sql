-- pg_cron + http extensies + 11 cron jobs die de Supabase Edge Functions
-- aanroepen op de schedules die voorheen in netlify.toml stonden.
--
-- Runtime config staat in tabel public._xinix_config (zie volgende
-- migratie 2026-05-09_pg_cron_config_table.sql) — ALTER DATABASE SET
-- vereist superuser op Supabase, dus we gebruiken een tabel + helper
-- function in plaats van current_setting().
--
-- pg_cron draait elke ingeplande job in UTC tegen de Supabase database.
-- Functions worden via http_post vanuit Postgres aangeroepen — async,
-- we wachten niet op het antwoord.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Helper: build de Edge Function URL en post er heen met de cron secret.
CREATE OR REPLACE FUNCTION public.invoke_edge(fn TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base TEXT := current_setting('xinix.functions_url', true);
  secret TEXT := current_setting('xinix.cron_secret', true);
  request_id BIGINT;
BEGIN
  IF base IS NULL OR secret IS NULL THEN
    RAISE EXCEPTION 'xinix.functions_url and/or xinix.cron_secret not set in postgres config';
  END IF;
  -- pg_net fire-and-forget; geeft request id terug
  SELECT net.http_post(
    url := base || '/' || fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', secret
    ),
    body := '{}'::jsonb
  ) INTO request_id;
  RETURN request_id;
END;
$$;

-- Verwijder eerst eventuele eerdere jobs zodat herrun idempotent is
DO $$
DECLARE
  j TEXT;
  jobs TEXT[] := ARRAY[
    'xinix-poll-prices',
    'xinix-poll-trials',
    'xinix-poll-edgar',
    'xinix-poll-fda',
    'xinix-poll-biotech-news',
    'xinix-poll-mining-news',
    'xinix-poll-metals',
    'xinix-compute-signals',
    'xinix-compute-scores',
    'xinix-forward-returns',
    'xinix-dispatch-alerts'
  ];
BEGIN
  FOREACH j IN ARRAY jobs LOOP
    PERFORM cron.unschedule(j) FROM cron.job WHERE jobname = j;
  END LOOP;
END$$;

-- Schedules (zelfde als Netlify-versie):
SELECT cron.schedule(
  'xinix-poll-prices', '0 22 * * 1-5',
  $$SELECT public.invoke_edge('poll-prices-background')$$
);
SELECT cron.schedule(
  'xinix-poll-trials', '0 6 * * *',
  $$SELECT public.invoke_edge('poll-trials-background')$$
);
SELECT cron.schedule(
  'xinix-poll-edgar', '*/30 * * * *',
  $$SELECT public.invoke_edge('poll-edgar-background')$$
);
SELECT cron.schedule(
  'xinix-poll-fda', '0 */6 * * *',
  $$SELECT public.invoke_edge('poll-fda-background')$$
);
SELECT cron.schedule(
  'xinix-poll-biotech-news', '20 */2 * * *',
  $$SELECT public.invoke_edge('poll-biotech-news-background')$$
);
SELECT cron.schedule(
  'xinix-poll-mining-news', '15 */2 * * *',
  $$SELECT public.invoke_edge('poll-mining-news-background')$$
);
SELECT cron.schedule(
  'xinix-poll-metals', '30 22 * * 1-5',
  $$SELECT public.invoke_edge('poll-metals-background')$$
);
SELECT cron.schedule(
  'xinix-compute-signals', '0 5 * * *',
  $$SELECT public.invoke_edge('compute-signals-background')$$
);
SELECT cron.schedule(
  'xinix-compute-scores', '0 6 * * *',
  $$SELECT public.invoke_edge('compute-scores-background')$$
);
SELECT cron.schedule(
  'xinix-forward-returns', '30 7 * * *',
  $$SELECT public.invoke_edge('forward-returns-background')$$
);
SELECT cron.schedule(
  'xinix-dispatch-alerts', '*/15 * * * *',
  $$SELECT public.invoke_edge('dispatch-alerts-background')$$
);
