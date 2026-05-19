-- Poefies — aandelen die in maximaal 7 dagen minimaal 125% (= 2.25×) zijn gegroeid.
-- Vergelijkbaar met feniks maar veel kortere window en lagere drempel.
-- We slaan voor elke ticker op: of het ooit een poefie was, datum van laatste
-- poefie, totaal aantal incidenten, en counts per tijdvenster (6m/1j/2j/5j).
ALTER TABLE signal_tickers
  ADD COLUMN IF NOT EXISTS is_poefie boolean,
  ADD COLUMN IF NOT EXISTS is_poefie_at timestamptz,
  ADD COLUMN IF NOT EXISTS poefie_last_date date,
  ADD COLUMN IF NOT EXISTS poefie_incident_count integer,
  ADD COLUMN IF NOT EXISTS poefie_median_date date,
  ADD COLUMN IF NOT EXISTS poefie_max_growth_pct numeric,
  ADD COLUMN IF NOT EXISTS poefie_days_to_peak integer,
  ADD COLUMN IF NOT EXISTS poefie_count_6m integer,
  ADD COLUMN IF NOT EXISTS poefie_count_1y integer,
  ADD COLUMN IF NOT EXISTS poefie_count_2y integer,
  ADD COLUMN IF NOT EXISTS poefie_count_5y integer,
  ADD COLUMN IF NOT EXISTS poefie_incidents jsonb,
  ADD COLUMN IF NOT EXISTS poefie_loose_data jsonb;

CREATE INDEX IF NOT EXISTS idx_signal_tickers_is_poefie
  ON signal_tickers (is_poefie) WHERE is_poefie = true;

-- Elke 2 uur draaien, offset van phoenix (0 */2) en hikkertjes (30 */2)
SELECT cron.unschedule('xinix-compute-poefies')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-compute-poefies');

SELECT cron.schedule(
  'xinix-compute-poefies', '15 */2 * * *',
  $$SELECT public.invoke_edge('compute-poefies-background')$$
);
