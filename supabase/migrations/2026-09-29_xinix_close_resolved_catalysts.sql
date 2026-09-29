-- Verouderde katalysatoren.
--
-- poll-trials zet de verwachte datum van een fase 2/3-uitslag op de "primary
-- completion date" van clinicaltrials.gov. Komt de uitslag eerder (of mislukt
-- de studie), dan blijft de katalysator op 'pending' staan tot die datum plus
-- een week. Zo kreeg TENX nog wekenlang dagelijks een pre_catalyst-signaal voor
-- een fase 3 die op 11 augustus al mislukt was, en kocht de sim daarop.
--
-- Een uitslagbericht (mislukt, topline, fase-succes; bij PDUFA goedkeuring of
-- CRL) sluit nu de dichtstbijzijnde openstaande katalysator van hetzelfde
-- aandeel die binnen 120 dagen na het bericht verwacht werd, mits het bericht
-- echt over die studie gaat:
--  1. een onderscheidend woord uit de studietitel (middel, ziekte, studienaam)
--     staat in het bericht, of
--  2. het aandeel heeft maar één openstaande uitslag en de fase in het bericht
--     (als die genoemd wordt) klopt.
-- Zonder die eis sloot een bericht over de mislukte fase 3 van pelacarsen de
-- donidalorsen-studie van Ionis af, en positief nieuws over brelovitug de
-- maralixibat-studie van Mirum.

CREATE OR REPLACE FUNCTION public.xinix_catalyst_matches(p_description text, p_type text, p_text text, p_alleen_deze boolean)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM regexp_split_to_table(lower(coalesce(p_description, '')), '[^a-z0-9]+') w
      WHERE length(w) >= 6
        AND w NOT IN ('study', 'studies', 'patient', 'patients', 'treatment', 'treating', 'efficacy', 'safety',
                      'randomized', 'randomised', 'placebo', 'controlled', 'evaluate', 'evaluation', 'evaluating',
                      'assess', 'assessing', 'clinical', 'subjects', 'participants', 'compared', 'comparing',
                      'versus', 'extension', 'adults', 'children', 'pediatric', 'paediatric', 'disease', 'diseases',
                      'therapy', 'therapies', 'associated', 'general', 'previously', 'treated', 'untreated',
                      'advanced', 'multicenter', 'multicentre', 'double', 'single', 'multiple', 'investigate',
                      'investigating', 'effect', 'effects', 'improve', 'improving', 'healthy', 'volunteers',
                      'combination', 'monotherapy', 'standard', 'months', 'prophylactic', 'prevention', 'preventing',
                      'severe', 'moderate', 'chronic', 'primary', 'secondary', 'outcome', 'outcomes',
                      'tolerability', 'pharmacokinetics', 'following', 'receiving', 'cancer', 'cancers', 'tumors',
                      'tumours', 'people', 'persons', 'subject', 'intravenous', 'subcutaneous', 'weekly',
                      'compare', 'determine', 'confirm', 'confirmatory', 'pivotal', 'global', 'international')
        AND position(w IN lower(p_text)) > 0
    )
    OR (p_alleen_deze AND (
      CASE
        WHEN lower(p_text) ~ 'phase\s*(3|iii)\M' THEN p_type ILIKE 'phase3%'
        WHEN lower(p_text) ~ 'phase\s*(2|ii)(b|a)?\M' THEN p_type ILIKE 'phase2%'
        ELSE true
      END));
$$;

CREATE OR REPLACE FUNCTION public.xinix_close_resolved_catalysts()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  gesloten bigint[];
  n_signalen integer;
BEGIN
  WITH ev AS (
    SELECT e.ticker, e.signal_type, e.detected_at,
           coalesce(e.title, '') || ' ' || coalesce(e.detail, '') AS tekst
    FROM signal_events e
    WHERE e.signal_type IN ('trial_failed', 'topline_positive', 'topline_mixed', 'topline_negative',
                            'phase_success', 'fda_approval', 'crl')
      AND e.detected_at > now() - interval '200 days'
  ), open_per_ticker AS (
    SELECT ticker, count(*) AS n FROM signal_catalysts
    WHERE status = 'pending' AND (catalyst_type ILIKE '%readout%' OR catalyst_type = 'PDUFA')
    GROUP BY ticker
  ), kandidaat AS (
    SELECT DISTINCT ON (ev.ticker, ev.detected_at) c.id, ev.signal_type, ev.detected_at
    FROM ev
    JOIN signal_catalysts c ON c.ticker = ev.ticker
    JOIN open_per_ticker o ON o.ticker = c.ticker
    WHERE c.status = 'pending'
      AND c.expected_date BETWEEN ev.detected_at::date - 7 AND ev.detected_at::date + 120
      AND ((c.catalyst_type ILIKE '%readout%' AND ev.signal_type NOT IN ('fda_approval', 'crl'))
        OR (c.catalyst_type = 'PDUFA' AND ev.signal_type IN ('fda_approval', 'crl')))
      AND xinix_catalyst_matches(c.description, c.catalyst_type, ev.tekst, o.n = 1)
    ORDER BY ev.ticker, ev.detected_at, abs(c.expected_date - ev.detected_at::date)
  ), eerste AS (
    SELECT DISTINCT ON (id) id, signal_type, detected_at FROM kandidaat ORDER BY id, detected_at
  ), upd AS (
    UPDATE signal_catalysts c
    SET status = 'occurred', occurred_at = eerste.detected_at, outcome = eerste.signal_type, updated_at = now()
    FROM eerste WHERE c.id = eerste.id
    RETURNING c.id
  )
  SELECT coalesce(array_agg(id), '{}') INTO gesloten FROM upd;

  IF cardinality(gesloten) = 0 THEN
    RETURN 0;
  END IF;

  -- De aftel-signalen voor die katalysatoren vervallen meteen; de sim koopt
  -- alleen op signalen die nog niet verlopen zijn.
  UPDATE signal_events SET expires_at = now()
  WHERE signal_type LIKE 'pre_catalyst%'
    AND (payload->>'catalyst_id')::bigint = ANY (gesloten)
    AND (expires_at IS NULL OR expires_at > now());
  GET DIAGNOSTICS n_signalen = ROW_COUNT;

  INSERT INTO signal_runs (job, ok, message, finished_at, metrics)
  VALUES ('xinix-close-catalysts', true,
    format('%s katalysator(en) afgesloten na een uitslagbericht, %s aftel-signalen vervallen', cardinality(gesloten), n_signalen),
    now(), jsonb_build_object('catalysts', gesloten, 'signals_expired', n_signalen));
  RETURN cardinality(gesloten);
END;
$$;

REVOKE ALL ON FUNCTION public.xinix_close_resolved_catalysts() FROM PUBLIC, anon, authenticated;

-- Na elke nieuwsronde (biotech-nieuws draait om :20 elke twee uur).
SELECT cron.unschedule('xinix-close-catalysts')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-close-catalysts');
SELECT cron.schedule('xinix-close-catalysts', '35 */2 * * *', $$SELECT public.xinix_close_resolved_catalysts()$$);
