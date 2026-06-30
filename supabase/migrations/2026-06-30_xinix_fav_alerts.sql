-- Favorieten-alerts (xinix-fav-alerts-background)
--
-- Dedicated ntfy-meldingen voor het Favorieten-tabblad. De algemene
-- dispatch-alerts onderdrukt favorieten juist (die ken je al), maar de
-- gebruiker wil voor zijn favorieten wél gericht gepingd worden bij:
--   1. >30% daling op één dag
--   2. nieuw 5-jaars low
--   3. nieuw 3-jaars low
--   4. nieuw in de top 10 (gesorteerd op afstand tot aankooplimiet)
--   5. nieuw in de top 20 (idem)
--   6. onder de aankooplimiet gezakt
--   7. ≥4 sterren én >20% daling op één dag
--   8. ≥4 sterren én >50% daling in een week
--
-- Deze migratie voegt de benodigde kolom + dedup-tabel + cron toe.

-- 1) 3-jaars low naast de bestaande 1y/5y extremes. compute-extremes-background
--    haalt toch al een 5y weekly reeks op, dus de 3y-low komt uit dezelfde fetch.
ALTER TABLE public.signal_price_summary
  ADD COLUMN IF NOT EXISTS low_3y numeric;

-- 2) Dedup-/baseline-state per (ticker, alert_type). Voorkomt dat een aandeel
--    dat bv. weken op een 5y-low of onder de limiet staat elke dag pingt.
--    last_alert_at = wanneer er voor het laatst gepingd (of bij de eerste run
--    stilletjes gebaseline'd) is. ref_close = de koers bij die ping, zodat we
--    bij een materieel nieuwe low (≥10% lager) opnieuw mogen pingen.
CREATE TABLE IF NOT EXISTS public.xinix_fav_alert_state (
  ticker        text NOT NULL,
  alert_type    text NOT NULL,
  last_alert_at timestamptz NOT NULL DEFAULT now(),
  ref_close     numeric,
  PRIMARY KEY (ticker, alert_type)
);

-- RLS aan zonder policy = alleen de service-role (edge functions) erbij.
ALTER TABLE public.xinix_fav_alert_state ENABLE ROW LEVEL SECURITY;

-- 3) Dagelijkse cron om 07:00 UTC (= 09:00 NL zomertijd / 08:00 wintertijd).
--    Buiten de quiet hours (21–4 UTC) en op een humaan tijdstip; de koersdata
--    is sowieso dagelijks (poll-prices draait 22:00 UTC op werkdagen), dus
--    vaker draaien voegt niets toe. Idempotent: eerst unschedule.
SELECT cron.unschedule('xinix-fav-alerts')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-fav-alerts');

SELECT cron.schedule(
  'xinix-fav-alerts', '0 7 * * *',
  $$SELECT public.invoke_edge('xinix-fav-alerts-background')$$
);
