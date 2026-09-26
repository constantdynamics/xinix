-- Explosie-motor alleen nog voor favorieten met ≥ sprint_min_rating sterren
-- (default 4). De gebruiker wil de motor, het nieuws en de meldingen voor geen
-- enkel ander aandeel laten draaien. De gepoolde 10-jaarsstatistiek blijft
-- staan (daar komen de lifts en de kalibratie uit), maar er wordt niets nieuws
-- meer gemeten of gescoord voor andere aandelen.

-- 1. Geen dagelijkse sweep van ~20k aandelen en geen automatisch toevoegen.
UPDATE public.signal_settings SET universe_auto_add = false WHERE id = 1;
ALTER TABLE public.signal_settings ALTER COLUMN universe_auto_add SET DEFAULT false;

DO $$
DECLARE j text;
BEGIN
  FOREACH j IN ARRAY ARRAY['xinix-universe','xinix-universe-0','xinix-universe-1','xinix-universe-2','xinix-universe-3','xinix-universe-4','xinix-universe-finish'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN PERFORM cron.unschedule(j); END IF;
  END LOOP;
END $$;

-- 2. Deep-scan-wachtrij: alleen ≥4★.
CREATE OR REPLACE FUNCTION public.xinix_deep_scan_queue(p_limit integer)
 RETURNS TABLE(ticker text, reason text)
 LANGUAGE sql
 STABLE
AS $function$
  -- Alleen favorieten met minstens sprint_min_rating sterren (default 4):
  -- de gebruiker wil de motor voor geen enkel ander aandeel laten draaien.
  WITH fav AS (
    SELECT f.ticker FROM xinix_favorites f
    WHERE f.rating >= (SELECT coalesce(sprint_min_rating, 4) FROM signal_settings WHERE id = 1)
  ),
  cand AS (
    SELECT f.ticker, 'nieuw' AS reason, 1 AS prio, 0::numeric AS ord
    FROM fav f LEFT JOIN xinix_universe u ON u.ticker = f.ticker
    WHERE u.deep_at IS NULL
    UNION ALL
    SELECT DISTINCT p.ticker, 'track-record', 2, 0
    FROM xinix_event_predictions p JOIN fav f ON f.ticker = p.ticker
    WHERE NOT p.resolved AND p.due_on <= current_date
    UNION ALL
    SELECT h.ticker, 'kalibratie', 2, extract(epoch FROM h.scanned_at)::numeric
    FROM xinix_event_history h JOIN fav f ON f.ticker = h.ticker
    WHERE h.ok AND h.needs_calib AND EXISTS (SELECT 1 FROM xinix_event_models)
    UNION ALL
    SELECT u.ticker, 'herscan', 3, extract(epoch FROM u.deep_at)::numeric
    FROM xinix_universe u JOIN fav f ON f.ticker = u.ticker
    WHERE u.deep_at < now() - interval '30 days'
  )
  SELECT c.ticker, (array_agg(c.reason ORDER BY c.prio, c.ord))[1]
  FROM cand c GROUP BY c.ticker
  ORDER BY min(c.prio), min(c.ord)
  LIMIT p_limit;
$function$;

-- 3. Kansen, treffers en open voorspellingen van andere aandelen opruimen.
UPDATE public.xinix_universe u
SET p_h7 = NULL, p_h14 = NULL, p_h21 = NULL, p_k30 = NULL, p_k90 = NULL, p_p30 = NULL, p_p90 = NULL, p_rk = NULL,
    hits = '{}', add_hint = NULL, strength = NULL, requeue_at = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.xinix_favorites f
  WHERE f.ticker = u.ticker AND f.rating >= (SELECT coalesce(sprint_min_rating, 4) FROM public.signal_settings WHERE id = 1)
);
DELETE FROM public.xinix_event_predictions p
WHERE NOT p.resolved AND NOT EXISTS (
  SELECT 1 FROM public.xinix_favorites f
  WHERE f.ticker = p.ticker AND f.rating >= (SELECT coalesce(sprint_min_rating, 4) FROM public.signal_settings WHERE id = 1)
);
