-- De score-dimensie van het Potje was leeg.
--
-- De sim, de papieren portefeuille en de site lezen de score uit
-- signal_tickers.goud_score (0–100). Dat is een curatieveld dat met de hand
-- ingevuld wordt, en voor 2.547 van de 2.548 actieve aandelen leeg was. Alle
-- A-Score-strategieën (≥0 … ≥90) kochten daardoor precies hetzelfde: alleen
-- aandelen met een rood signaal.
--
-- De scoringsmotor (compute-scores → signal_scores) rekent wel voor elk
-- aandeel een structurele, katalysator- en timingscore uit (elk 0–1), maar
-- vermenigvuldigt die tot final_score: zonder katalysator is die 0, en dat
-- geldt voor alle mijnbouwaandelen en 95% van biotech. Voor de score nemen we
-- daarom een optelsom van dezelfde onderdelen (de helft structureel, een
-- kwart katalysator, een kwart timing, min de risicostraf) en zetten die om
-- naar een rang binnen de sector: 90 = beter dan 90% van de biotech- of
-- mijnbouwaandelen. Zo betekent "score ≥65" in het Potje: de beste 35%.
--
-- Handmatige scores gaan altijd voor. goud_score_auto houdt bij welke scores
-- van het model komen; een trigger zet hem op false zodra iemand de score met
-- de hand wijzigt (en weer op true als die hem leegmaakt). Het dashboard
-- kleurt tegels alleen op handmatige scores, anders zou bijna elke biotech-
-- en mijnbouwtegel geel worden.

ALTER TABLE public.signal_tickers ADD COLUMN IF NOT EXISTS goud_score_auto boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.signal_tickers.goud_score_auto IS
  'true = goud_score komt van xinix_refresh_auto_scores() (rang binnen de sector), false = handmatig of leeg.';

CREATE OR REPLACE FUNCTION public.xinix_goud_score_bron()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.goud_score IS DISTINCT FROM OLD.goud_score
     AND coalesce(current_setting('xinix.auto_score', true), '') <> 'aan' THEN
    NEW.goud_score_auto := NEW.goud_score IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS signal_tickers_goud_score_bron ON public.signal_tickers;
CREATE TRIGGER signal_tickers_goud_score_bron
  BEFORE UPDATE OF goud_score ON public.signal_tickers
  FOR EACH ROW EXECUTE FUNCTION public.xinix_goud_score_bron();

CREATE OR REPLACE FUNCTION public.xinix_refresh_auto_scores()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  PERFORM set_config('xinix.auto_score', 'aan', true);

  WITH laatste AS (
    SELECT DISTINCT ON (s.ticker) s.ticker, s.structural, s.catalyst, s.timing, s.risk_penalty
    FROM signal_scores s
    WHERE s.mode = 'trader' AND s.computed_at > now() - interval '7 days'
    ORDER BY s.ticker, s.computed_at DESC
  ), basis AS (
    SELECT t.ticker, t.sector,
      0.50 * coalesce(l.structural, 0) + 0.25 * coalesce(l.catalyst, 0)
        + 0.25 * coalesce(l.timing, 0) - coalesce(l.risk_penalty, 0) AS samengesteld
    FROM signal_tickers t JOIN laatste l ON l.ticker = t.ticker
    WHERE t.active AND t.sector IN ('biotech', 'mining')
  ), rang AS (
    SELECT ticker, round(100 * percent_rank() OVER (PARTITION BY sector ORDER BY samengesteld))::int AS score
    FROM basis
  )
  UPDATE signal_tickers t SET goud_score = r.score, goud_score_auto = true
  FROM rang r
  WHERE t.ticker = r.ticker
    AND (t.goud_score IS NULL OR t.goud_score_auto)
    AND (t.goud_score IS DISTINCT FROM r.score OR NOT t.goud_score_auto);
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Modelscores van aandelen die niet meer meedoen (inactief, andere sector)
  -- niet laten hangen.
  UPDATE signal_tickers SET goud_score = NULL
  WHERE goud_score_auto AND goud_score IS NOT NULL
    AND (NOT active OR sector IS NULL OR sector NOT IN ('biotech', 'mining'));

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.xinix_refresh_auto_scores() FROM PUBLIC, anon, authenticated;

-- compute-scores draait elke drie uur op het hele uur.
SELECT cron.unschedule('xinix-auto-scores')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-auto-scores');
SELECT cron.schedule('xinix-auto-scores', '20 */3 * * *', $$SELECT public.xinix_refresh_auto_scores()$$);

SELECT public.xinix_refresh_auto_scores();
