-- Hippos: een track record. Wat voorspelde het model, en kwam het uit?
--
-- De kalibratie toetst het model op zijn eigen historie. Dat is eerlijk gemeten,
-- maar het blijft terugkijken op dezelfde data waar de lifts uit komen. Een
-- track record kijkt vooruit: elke handelsdag wordt per favoriet de kans van dat
-- moment vastgelegd met de koers erbij, en daarna wordt bijgehouden wat er
-- werkelijk gebeurde. Geen enkele parameter kan daar achteraf nog aan sleutelen.
--
-- Meten gebeurt op slotkoersen, net als in de historische meting: elke run legt
-- de hoogste slotkoers vast die sinds de voorspelling is waargenomen. Intraday
-- pieken tellen dus niet mee, in de historie ook niet. Consistent, en aan de
-- voorzichtige kant.
--
-- Twee uitkomsten per horizon, omdat de historische meting ook twee eisen stelt:
--   touched = de koers raakte +50% aan
--   held    = en stond daarna nog minstens +20% boven de instap
-- `held` is de echte treffer; `touched` staat erbij zodat zichtbaar is hoe vaak
-- een sprong meteen weer wegviel.

CREATE TABLE IF NOT EXISTS public.xinix_hippo_predictions (
  ticker        text NOT NULL,
  made_on       date NOT NULL,                  -- één voorspelling per aandeel per dag
  made_at       timestamptz NOT NULL DEFAULT now(),
  entry_close   numeric NOT NULL,               -- slotkoers op het moment van voorspellen
  prob_7d       numeric,
  prob_14d      numeric,
  raw_prob_7d   numeric,
  raw_prob_14d  numeric,
  rating        smallint,
  tradeable     boolean NOT NULL DEFAULT true,
  -- Hoogste slotkoers sinds de voorspelling, en de eerste keer dat +50% geraakt werd.
  max_close     numeric NOT NULL,
  max_close_at  timestamptz,
  touched_at    timestamptz,
  -- Eerste waarneming minstens een dag ná de aanraking waarop de koers nog
  -- ≥ +20% stond. Dat is de "hield stand"-eis uit de historische meting.
  held_at       timestamptz,
  -- Uitkomst per horizon: NULL = nog niet beslist.
  touched_7d    boolean,
  held_7d       boolean,
  touched_14d   boolean,
  held_14d      boolean,
  resolved_7d   boolean NOT NULL DEFAULT false,
  resolved_14d  boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, made_on)
);

-- Openstaande voorspellingen ophalen is de hete query.
CREATE INDEX IF NOT EXISTS xinix_hippo_predictions_open_idx
  ON public.xinix_hippo_predictions (made_on)
  WHERE NOT resolved_14d;

ALTER TABLE public.xinix_hippo_predictions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.xinix_hippo_predictions IS
  'Track record van het Hippos-model: per favoriet per dag de voorspelde kans en de koers, met achteraf de werkelijke uitkomst binnen 7 en 14 dagen. Gevuld en afgewikkeld door xinix-hippo-background.';

-- Samenvatting voor het tabblad. Aggregeren in de database in plaats van
-- duizenden rijen naar de edge function trekken: het gaat om tellingen, niet
-- om de losse voorspellingen.
CREATE OR REPLACE FUNCTION public.xinix_hippo_track_record()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH per_horizon AS (
    SELECT '7' AS horizon, prob_7d AS prob, held_7d AS held, touched_7d AS touched
    FROM xinix_hippo_predictions WHERE resolved_7d AND prob_7d IS NOT NULL
    UNION ALL
    SELECT '14', prob_14d, held_14d, touched_14d
    FROM xinix_hippo_predictions WHERE resolved_14d AND prob_14d IS NOT NULL
  ),
  -- Dezelfde kansbuckets als de kalibratie, zodat voorspeld en werkelijk
  -- naast elkaar te leggen zijn.
  bucketed AS (
    SELECT horizon,
           CASE WHEN prob < 1 THEN '0-1'   WHEN prob < 2 THEN '1-2'
                WHEN prob < 3 THEN '2-3'   WHEN prob < 5 THEN '3-5'
                WHEN prob < 8 THEN '5-8'   WHEN prob < 12 THEN '8-12'
                WHEN prob < 20 THEN '12-20' WHEN prob < 30 THEN '20-30'
                WHEN prob < 50 THEN '30-50' ELSE '50-100' END AS bucket,
           prob, held, touched
    FROM per_horizon
  ),
  by_bucket AS (
    SELECT horizon, bucket,
           count(*) AS n,
           count(*) FILTER (WHERE held) AS hits,
           count(*) FILTER (WHERE touched) AS touches,
           round(avg(prob)::numeric, 1) AS avg_prob,
           round((100.0 * count(*) FILTER (WHERE held) / NULLIF(count(*), 0))::numeric, 1) AS rate_pct
    FROM bucketed GROUP BY 1, 2
  ),
  totals AS (
    SELECT horizon,
           count(*) AS n,
           count(*) FILTER (WHERE held) AS hits,
           count(*) FILTER (WHERE touched) AS touches,
           round(avg(prob)::numeric, 2) AS avg_prob,
           round((100.0 * count(*) FILTER (WHERE held) / NULLIF(count(*), 0))::numeric, 2) AS rate_pct
    FROM per_horizon GROUP BY 1
  )
  SELECT jsonb_build_object(
    'since', (SELECT min(made_on) FROM xinix_hippo_predictions),
    'open', (SELECT count(*) FROM xinix_hippo_predictions WHERE NOT resolved_14d),
    'total', (SELECT count(*) FROM xinix_hippo_predictions),
    'horizons', COALESCE((
      SELECT jsonb_object_agg(t.horizon, jsonb_build_object(
        'n', t.n, 'hits', t.hits, 'touches', t.touches,
        'avg_prob', t.avg_prob, 'rate_pct', t.rate_pct,
        'buckets', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'bucket', b.bucket, 'n', b.n, 'hits', b.hits, 'touches', b.touches,
            'avg_prob', b.avg_prob, 'rate_pct', b.rate_pct) ORDER BY b.avg_prob)
          FROM by_bucket b WHERE b.horizon = t.horizon), '[]'::jsonb)
      )) FROM totals t), '{}'::jsonb)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.xinix_hippo_track_record() FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.xinix_hippo_track_record() TO service_role;
