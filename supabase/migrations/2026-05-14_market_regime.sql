-- market_regime: eén rij met de dagelijkse S&P 500 marktfase (bull/bear).
-- Wordt bijgewerkt door xinix-market-regime (21:30 UTC cron).
-- xinix-sim en xinix-trade lezen is_bull vóór elke buy-ronde.
CREATE TABLE IF NOT EXISTS market_regime (
  id          integer PRIMARY KEY DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  spy_close   numeric,
  ma_200      numeric,
  is_bull     boolean NOT NULL DEFAULT true
);
INSERT INTO market_regime (id, is_bull) VALUES (1, true) ON CONFLICT (id) DO NOTHING;

-- Drawdown-tracking per strategie voor Calmar-fitness in xinix-evolve.
ALTER TABLE xinix_strategy_state
  ADD COLUMN IF NOT EXISTS max_equity       numeric,
  ADD COLUMN IF NOT EXISTS max_drawdown_pct numeric NOT NULL DEFAULT 0;

-- Dagelijkse cron voor marktregime (vóór trade en sim om 22:05 UTC).
SELECT cron.schedule(
  'xinix-market-regime-daily',
  '30 21 * * *',
  $$
  SELECT net.http_post(
    url    := current_setting('app.supabase_url') || '/functions/v1/xinix-market-regime',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', current_setting('app.cron_secret')
    ),
    body   := '{}'::jsonb
  )
  $$
) ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule;
