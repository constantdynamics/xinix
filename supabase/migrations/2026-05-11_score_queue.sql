-- compute-scores omgebouwd naar een slimme round-robin (zoals poll-prices):
-- per run worden max SCORE_BATCH tickers gescoord, gekozen op tier:
--   A (goud_score of buy_limit gezet)            -> herscore als score_at > 1u oud
--   B (factor_count >= 2 of recent signaal 7d)   -> > 12u oud
--   C (de rest, screening-junk zonder data)      -> > 30 dagen oud
-- Binnen een tier: meest-stale eerst (NULL = nooit gescoord = bovenaan).
-- Zo krijgen tickers met kans op een hot/strong-buy positie veel vaker
-- een herscore; de no-data massa rouleert traag door.
ALTER TABLE public.signal_tickers
  ADD COLUMN IF NOT EXISTS score_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_signal_tickers_score_queue
  ON public.signal_tickers (score_at NULLS FIRST)
  WHERE active = true;

-- 'other' is een geldige sector geworden (auto-detect uit bedrijfsnaam);
-- de scores-tabel moet die ook accepteren, anders faalt de upsert.
ALTER TABLE public.signal_scores DROP CONSTRAINT IF EXISTS signal_scores_sector_check;
ALTER TABLE public.signal_scores
  ADD CONSTRAINT signal_scores_sector_check
  CHECK (sector = ANY (ARRAY['biotech'::text, 'mining'::text, 'other'::text]));

-- compute-scores van dagelijks (0 6 * * *) naar elke 30 min.
DO $$ BEGIN
  PERFORM cron.unschedule('xinix-compute-scores') FROM cron.job
    WHERE jobname = 'xinix-compute-scores';
EXCEPTION WHEN undefined_function THEN NULL; END $$;
SELECT cron.schedule(
  'xinix-compute-scores',
  '*/30 * * * *',
  $$SELECT public.invoke_edge('compute-scores-background')$$
);
