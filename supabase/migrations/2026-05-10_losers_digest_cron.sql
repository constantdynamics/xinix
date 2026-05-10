-- Cron job voor losers-digest-background. Draait dagelijks 09:00 UTC
-- (= 11:00 NL CEST). De function beslist zelf of er wat verstuurd
-- wordt: zaterdag (UTC dayOfWeek=6) -> weekly digest top 5 dalers 7d,
-- 1e van de maand -> monthly digest top 5 dalers 30d. Beide kunnen
-- op dezelfde dag vallen.

DO $$ BEGIN
  PERFORM cron.unschedule('xinix-losers-digest') FROM cron.job
    WHERE jobname = 'xinix-losers-digest';
EXCEPTION WHEN undefined_function THEN NULL; END $$;

SELECT cron.schedule(
  'xinix-losers-digest',
  '0 9 * * *',
  $$SELECT public.invoke_edge('losers-digest-background')$$
);
