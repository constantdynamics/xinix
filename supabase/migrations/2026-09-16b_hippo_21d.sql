-- Hippos: drie weken erbij als derde horizon.
--
-- De vraag was of een langer venster helpt. Dat is geen kwestie van redeneren
-- maar van meten, dus 21 kalenderdagen (15 handelsdagen) komt naast de 7 en de
-- 14 te staan. Alle drie op exact dezelfde dagen en met dezelfde kenmerken;
-- alleen de uitkomst verschilt. Een langer venster is per definitie soepeler:
-- de koers krijgt meer tijd voor diezelfde +50%, dus de kansen liggen hoger.
--
-- Let op wat dit níét oplost. Ook met drie weken blijft de gemeten kans ver
-- onder de 80% die als drempel staat; het plafond schuift mee omhoog maar lang
-- niet zo ver. Het venster verlengen maakt het signaal ruimer, niet zekerder.

ALTER TABLE public.xinix_hippo_scores
  ADD COLUMN IF NOT EXISTS prob_21d      numeric,
  ADD COLUMN IF NOT EXISTS raw_prob_21d  numeric,
  ADD COLUMN IF NOT EXISTS base_rate_21d numeric,
  ADD COLUMN IF NOT EXISTS factors_21d   jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.xinix_hippo_predictions
  ADD COLUMN IF NOT EXISTS prob_21d     numeric,
  ADD COLUMN IF NOT EXISTS raw_prob_21d numeric,
  ADD COLUMN IF NOT EXISTS touched_21d  boolean,
  ADD COLUMN IF NOT EXISTS held_21d     boolean,
  ADD COLUMN IF NOT EXISTS resolved_21d boolean NOT NULL DEFAULT false;

-- De "nog niet afgewikkeld"-index volgt de langste horizon.
DROP INDEX IF EXISTS public.xinix_hippo_predictions_open_idx;
CREATE INDEX IF NOT EXISTS xinix_hippo_predictions_open_idx
  ON public.xinix_hippo_predictions (made_on)
  WHERE NOT resolved_21d;

-- De drempel mag voortaan ook op 21 dagen slaan.
ALTER TABLE public.signal_settings DROP CONSTRAINT IF EXISTS signal_settings_hippo_alert_horizon_check;
ALTER TABLE public.signal_settings
  ADD CONSTRAINT signal_settings_hippo_alert_horizon_check
  CHECK (hippo_alert_horizon IN (7, 14, 21));
COMMENT ON COLUMN public.signal_settings.hippo_alert_horizon IS
  'Hippos: op welke horizon de meldingsdrempel geldt — 7, 14 of 21 dagen.';

-- De voorspellingen van vandaag zijn nog geen uur oud en hebben nog geen
-- 21-daagse kans. Opnieuw laten aanmaken door de eerstvolgende run levert een
-- compleet track record vanaf dag één, in plaats van een gat in de reeks.
DELETE FROM public.xinix_hippo_predictions WHERE made_on = CURRENT_DATE;

-- De samenvatting telt voortaan drie vensters.
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
    UNION ALL
    SELECT '21', prob_21d, held_21d, touched_21d
    FROM xinix_hippo_predictions WHERE resolved_21d AND prob_21d IS NOT NULL
  ),
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
    'open', (SELECT count(*) FROM xinix_hippo_predictions WHERE NOT resolved_21d),
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
