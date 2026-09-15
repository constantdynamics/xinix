-- Hippos: twee horizonnen naast elkaar (7 en 14 dagen) + een weekplafond op de meldingen.
--
-- 1. Waarom twee horizonnen. De vraag was "+50% binnen 14 dagen"; de vervolgvraag
--    is of 7 dagen bruikbaarder is. Een korter venster is strenger (dezelfde
--    sprong in de helft van de tijd), dus de kansen zakken — maar een sprint die
--    binnen een week loopt is wel handelbaar. In plaats van kiezen meet één scan
--    nu beide, op exact dezelfde dagen en met exact dezelfde kenmerken, zodat het
--    verschil af te lezen is in plaats van te beredeneren. Alleen de uitkomst
--    verschilt: haalde de koers +50% binnen 5 of binnen 10 handelsdagen?
--
-- 2. Weekplafond. De melding gaat bewust buiten de globale afkoelperiode om, maar
--    zonder rem kan een onrustige markt een reeks pings opleveren. Er gaat er nu
--    hoogstens één per week uit, over alle aandelen samen: de hoogste kans wint.

-- Per horizon de tellingen. De losse kolommen blijven de 14-daagse spiegel, zodat
-- bestaande queries en het dashboard blijven werken.
ALTER TABLE public.xinix_hippo_history
  ADD COLUMN IF NOT EXISTS horizons jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.xinix_hippo_history.horizons IS
  'Per horizon-sleutel ("7" / "14") de tellingen: {days_n, hits, days_2y, hits_2y, buckets, calib}. De losse kolommen spiegelen horizon 14.';

-- Scores per horizon. prob/raw_prob/base_rate/factors blijven de 14-daagse.
ALTER TABLE public.xinix_hippo_scores
  ADD COLUMN IF NOT EXISTS prob_7d      numeric,
  ADD COLUMN IF NOT EXISTS raw_prob_7d  numeric,
  ADD COLUMN IF NOT EXISTS base_rate_7d numeric,
  ADD COLUMN IF NOT EXISTS factors_7d   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS alerted_horizon smallint;

-- De kalibratie was één rij; het worden er één per horizon.
DROP TABLE IF EXISTS public.xinix_hippo_calibration;
CREATE TABLE public.xinix_hippo_calibration (
  horizon         smallint PRIMARY KEY,          -- 7 of 14 (dagen)
  computed_at     timestamptz NOT NULL DEFAULT now(),
  base_rate       numeric NOT NULL,
  days_n          bigint NOT NULL,
  hits            bigint NOT NULL,
  tickers_scanned integer NOT NULL,
  favorites       integer NOT NULL,
  lifts           jsonb NOT NULL DEFAULT '{}'::jsonb,
  calib           jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_prob        numeric,
  -- Hoogste frequentie die ooit in een kansbucket gemeten is: hoger dan dit kan
  -- een gekalibreerde kans niet worden, dus een drempel erboven vuurt nooit.
  ceiling         numeric
);
ALTER TABLE public.xinix_hippo_calibration ENABLE ROW LEVEL SECURITY;

-- Op welke horizon wordt gemeld.
ALTER TABLE public.signal_settings
  ADD COLUMN IF NOT EXISTS hippo_alert_horizon smallint NOT NULL DEFAULT 14
  CHECK (hippo_alert_horizon IN (7, 14));
COMMENT ON COLUMN public.signal_settings.hippo_alert_horizon IS
  'Hippos: op welke horizon de meldingsdrempel geldt — 7 of 14 dagen.';

-- Hoogstens zoveel hippo-meldingen per rollend venster van 7 dagen, over alle
-- aandelen samen. 0 = geen plafond.
ALTER TABLE public.signal_settings
  ADD COLUMN IF NOT EXISTS hippo_alert_max_per_week smallint NOT NULL DEFAULT 1;
COMMENT ON COLUMN public.signal_settings.hippo_alert_max_per_week IS
  'Hippos: maximaal aantal meldingen per rollende 7 dagen over alle aandelen samen. 0 = geen plafond.';
