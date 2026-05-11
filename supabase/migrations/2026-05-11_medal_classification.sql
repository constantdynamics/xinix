-- Medailleklassement: gold/silver/bronze per ticker, berekend door
-- compute-extremes-background uit de 5y weekly price series (zigzag
-- met 50% terugval-drempel, 1 medaille per leg = hoogste tier:
-- >=500% goud, 250-500% zilver, 100-250% brons; koers moet >=2 weken
-- boven de tier-drempel hebben gestaan).
ALTER TABLE public.signal_tickers
  ADD COLUMN IF NOT EXISTS medal_gold INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS medal_silver INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS medal_bronze INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS medals_computed_at TIMESTAMPTZ;

-- compute-extremes vaker laten draaien: van dagelijks naar elke 30 min
-- (3600 tickers / 80 per run / 48 runs per dag = ~1 dag full pass).
DO $$ BEGIN
  PERFORM cron.unschedule('xinix-compute-extremes') FROM cron.job
    WHERE jobname = 'xinix-compute-extremes';
EXCEPTION WHEN undefined_function THEN NULL; END $$;
SELECT cron.schedule(
  'xinix-compute-extremes',
  '*/30 * * * *',
  $$SELECT public.invoke_edge('compute-extremes-background')$$
);
