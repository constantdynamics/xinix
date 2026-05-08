-- ALTER DATABASE SET vereist superuser op Supabase free/pro tier, en
-- de Supabase Management MCP draait niet als superuser. Plaats de
-- runtime config daarom in een tabel die alleen via SECURITY DEFINER
-- functie leesbaar is.
--
-- Deze migratie is reeds toegepast op het project tijdens de port —
-- staat hier ook in git zodat een verse Supabase setup hetzelfde kan.

CREATE TABLE IF NOT EXISTS public._xinix_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public._xinix_config ENABLE ROW LEVEL SECURITY;
-- Geen policies = niemand kan via PostgREST lezen. Service-role bypasst RLS.

-- Vervang invoke_edge met de tabel-versie. De vorige versie uit
-- 2026-05-09_pg_cron_jobs.sql gebruikte current_setting() wat niet
-- werkt zonder superuser.
CREATE OR REPLACE FUNCTION public.invoke_edge(fn TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base TEXT;
  secret TEXT;
  request_id BIGINT;
BEGIN
  SELECT value INTO base FROM public._xinix_config WHERE key = 'functions_url';
  SELECT value INTO secret FROM public._xinix_config WHERE key = 'cron_secret';
  IF base IS NULL OR secret IS NULL THEN
    RAISE EXCEPTION '_xinix_config rows for functions_url and/or cron_secret missing';
  END IF;
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

-- Initial seed — pas de waarden aan aan jouw setup. De cron_secret hier
-- móét matchen met de CRON_SECRET die je via `supabase secrets set` op
-- de Edge Functions zet.
INSERT INTO public._xinix_config (key, value) VALUES
  ('functions_url', 'https://zfcjugqgufsyltxhvkuu.supabase.co/functions/v1'),
  ('cron_secret', 'd59af9416c38aa6c25f9647efb51f21a7d8233ac6b3fc41891f3918322d75718')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
