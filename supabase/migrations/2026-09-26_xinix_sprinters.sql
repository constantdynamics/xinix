-- Sprinters: aandelen met ≥4★ die binnen 10 handelsdagen ≥ +50% kunnen doen.
-- Rekent op het h14-model van de explosie-motor (10 handelsdagen, +50% en de
-- dag erna nog ≥ +20%) met verse koersen, plus gemeten nieuws-lift.

-- 1) Per nieuwsbericht: volgde er binnen 10 handelsdagen +50%?
--    Gemeten over álle berichten (anders te weinig waarnemingen); het nieuws
--    telt alleen mee bij aandelen met ≥4★.
CREATE TABLE IF NOT EXISTS public.xinix_sprint_news (
  event_id     bigint PRIMARY KEY,
  ticker       text NOT NULL,
  signal_type  text NOT NULL,
  grp          text NOT NULL,
  event_date   date NOT NULL,
  base_rate    numeric,          -- h14-kans van dit aandeel op een willekeurige dag (eigen 10 jaar)
  hit          boolean,          -- null = nog niet afgerekend
  resolved_at  timestamptz,
  error        text
);
CREATE INDEX IF NOT EXISTS xinix_sprint_news_open ON public.xinix_sprint_news (event_date) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS xinix_sprint_news_grp ON public.xinix_sprint_news (grp) WHERE hit IS NOT NULL;
ALTER TABLE public.xinix_sprint_news ENABLE ROW LEVEL SECURITY;

-- 2) Gemeten lift per nieuwsgroep (één rij per groep, elke run ververst).
CREATE TABLE IF NOT EXISTS public.xinix_sprint_news_lift (
  grp          text PRIMARY KEY,
  label        text NOT NULL,
  n            integer NOT NULL,
  hits         integer NOT NULL,
  expected     numeric NOT NULL,  -- som van de basiskansen van dezelfde aandelen
  rate_pct     numeric,
  lift         numeric,           -- hits / expected, gekrompen
  used         boolean NOT NULL DEFAULT false,
  computed_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.xinix_sprint_news_lift ENABLE ROW LEVEL SECURITY;

-- 3) De ranglijst.
CREATE TABLE IF NOT EXISTS public.xinix_sprint_scores (
  ticker        text PRIMARY KEY,
  rating        smallint,
  company       text,
  exchange      text,
  sector        text,
  close         numeric,
  change_1d     numeric,
  perf_w        numeric,
  prob          numeric,           -- eindkans +50% binnen 10 handelsdagen (model × nieuws)
  prob_model    numeric,           -- gekalibreerde h14-kans van de motor, zonder nieuws
  prob_7d       numeric,
  prob_21d      numeric,
  base_rate     numeric,
  news_mult     numeric,
  news          jsonb,             -- recente berichten die meetellen of getoond worden
  factors       jsonb,             -- sterkste kenmerken
  measured      boolean NOT NULL DEFAULT true,
  price_source  text,
  scored_at     timestamptz NOT NULL DEFAULT now(),
  alerted_at    timestamptz,
  alerted_prob  numeric
);
ALTER TABLE public.xinix_sprint_scores ENABLE ROW LEVEL SECURITY;

-- 4) Track record: per aandeel per dag de kans en de instapkoers.
CREATE TABLE IF NOT EXISTS public.xinix_sprint_predictions (
  ticker       text NOT NULL,
  made_on      date NOT NULL,
  prob         numeric NOT NULL,
  prob_model   numeric,
  news_mult    numeric,
  entry_close  numeric NOT NULL,
  alerted      boolean NOT NULL DEFAULT false,
  hit          boolean,
  touched      boolean,           -- +50% aangeraakt, ook als het niet standhield
  resolved_at  timestamptz,
  PRIMARY KEY (ticker, made_on)
);
CREATE INDEX IF NOT EXISTS xinix_sprint_predictions_open ON public.xinix_sprint_predictions (made_on) WHERE resolved_at IS NULL;
ALTER TABLE public.xinix_sprint_predictions ENABLE ROW LEVEL SECURITY;

-- 5) Instellingen.
ALTER TABLE public.signal_settings
  ADD COLUMN IF NOT EXISTS sprint_min_rating smallint NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS sprint_alert_min_prob numeric NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS sprint_alert_max_per_week integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS sprint_override_min_prob numeric NOT NULL DEFAULT 15;

-- 6) Track record per kansklasse.
CREATE OR REPLACE FUNCTION public.xinix_sprint_track_record()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT *, CASE WHEN prob < 2 THEN '0-2' WHEN prob < 5 THEN '2-5' WHEN prob < 10 THEN '5-10'
                   WHEN prob < 15 THEN '10-15' ELSE '15+' END AS bucket,
              CASE WHEN prob < 2 THEN 0 WHEN prob < 5 THEN 1 WHEN prob < 10 THEN 2 WHEN prob < 15 THEN 3 ELSE 4 END AS b
    FROM xinix_sprint_predictions
  )
  SELECT jsonb_build_object(
    'since', (SELECT min(made_on) FROM r),
    'total', (SELECT count(*) FROM r),
    'open', (SELECT count(*) FROM r WHERE resolved_at IS NULL),
    'resolved', (SELECT count(*) FROM r WHERE resolved_at IS NOT NULL),
    'hits', (SELECT count(*) FROM r WHERE hit),
    'alerts', (SELECT jsonb_build_object('n', count(*) FILTER (WHERE resolved_at IS NOT NULL), 'hits', count(*) FILTER (WHERE hit), 'open', count(*) FILTER (WHERE resolved_at IS NULL)) FROM r WHERE alerted),
    'buckets', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'b'), '[]'::jsonb) FROM (
      SELECT jsonb_build_object('b', b, 'bucket', bucket, 'n', count(*) FILTER (WHERE resolved_at IS NOT NULL),
        'hits', count(*) FILTER (WHERE hit), 'touches', count(*) FILTER (WHERE touched),
        'open', count(*) FILTER (WHERE resolved_at IS NULL), 'avg_prob', round(avg(prob), 1),
        'rate_pct', round(100.0 * count(*) FILTER (WHERE hit) / nullif(count(*) FILTER (WHERE resolved_at IS NOT NULL), 0), 1)) x
      FROM r GROUP BY b, bucket) q)
  );
$$;
REVOKE ALL ON FUNCTION public.xinix_sprint_track_record() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xinix_sprint_track_record() TO service_role;

-- 7) Nieuws: groepen, synchronisatie en lift.
--    Alleen echt nieuws; signalen die uit de koers zelf komen (dalingen,
--    spikes, limieten, volume) zitten al als kenmerk in het model.
CREATE OR REPLACE FUNCTION public.xinix_sprint_news_group(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN t IN ('breakthrough_designation','phase_success','topline_positive','licensing_deal','fda_approval','approval') THEN 'bio_goedkeuring'
    WHEN t IN ('pre_catalyst_7d','pre_catalyst_14d') THEN 'bio_catalyst_kort'
    WHEN t IN ('pre_catalyst_30d','pre_catalyst_60d') THEN 'bio_catalyst_lang'
    WHEN t IN ('trial_failed','topline_mixed') THEN 'bio_tegenvaller'
    WHEN t IN ('bonanza_au','bonanza_cu','discovery_announcement','step_out_drill') THEN 'mijn_boring'
    WHEN t IN ('resource_update','pfs','dfs','pea','permit','first_pour') THEN 'mijn_mijlpaal'
    WHEN t IN ('buyout_definitive','takeover_bid') THEN 'overname'
    WHEN t = 'jv_strategic' THEN 'partner'
    WHEN t = 'financing' THEN 'financiering'
    WHEN t = '8k_material' THEN 'sec_8k'
    ELSE NULL END;
$$;

-- Eén rij per aandeel × groep × dag: tien 8-K's op één dag zijn één gebeurtenis.
CREATE UNIQUE INDEX IF NOT EXISTS xinix_sprint_news_day ON public.xinix_sprint_news (ticker, grp, event_date);

CREATE OR REPLACE FUNCTION public.xinix_sprint_news_sync()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  INSERT INTO xinix_sprint_news (event_id, ticker, signal_type, grp, event_date, base_rate)
  SELECT DISTINCT ON (e.ticker, g.grp, e.detected_at::date)
         e.id, e.ticker, e.signal_type, g.grp, e.detected_at::date,
         CASE WHEN u.own_n[1] > 0 THEN u.own_h[2]::numeric / u.own_n[1] END
  FROM signal_events e
  CROSS JOIN LATERAL (SELECT public.xinix_sprint_news_group(e.signal_type) AS grp) g
  LEFT JOIN xinix_universe u ON u.ticker = e.ticker
  WHERE g.grp IS NOT NULL
    AND e.id > coalesce((SELECT max(event_id) FROM xinix_sprint_news), 0)
  ORDER BY e.ticker, g.grp, e.detected_at::date, e.id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.xinix_sprint_news_lift_refresh(p_base numeric)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO xinix_sprint_news_lift (grp, label, n, hits, expected, rate_pct, lift, used, computed_at)
  SELECT grp,
    CASE grp WHEN 'bio_goedkeuring' THEN 'Biotech: goedkeuring, doorbraak of positieve resultaten'
             WHEN 'bio_catalyst_kort' THEN 'Biotech: beslissing of data binnen 14 dagen'
             WHEN 'bio_catalyst_lang' THEN 'Biotech: beslissing of data binnen 30–60 dagen'
             WHEN 'bio_tegenvaller' THEN 'Biotech: mislukte of gemengde studie'
             WHEN 'mijn_boring' THEN 'Mijnbouw: sterke boorresultaten of vondst'
             WHEN 'mijn_mijlpaal' THEN 'Mijnbouw: resource, studie (PEA/PFS/DFS), vergunning of eerste goud'
             WHEN 'overname' THEN 'Overname of bod'
             WHEN 'partner' THEN 'Samenwerking of joint venture'
             WHEN 'financiering' THEN 'Financiering'
             WHEN 'sec_8k' THEN 'Materiële SEC-melding (8-K)'
             ELSE grp END,
    count(*)::int, count(*) FILTER (WHERE hit)::int,
    round(sum(coalesce(base_rate, p_base)), 3),
    round(100.0 * count(*) FILTER (WHERE hit) / count(*), 2),
    -- Gekrompen: 5 verwachte treffers als vooronderstelling "geen effect".
    round((count(*) FILTER (WHERE hit) + 5) / (sum(coalesce(base_rate, p_base)) + 5), 2),
    count(*) >= 30 AND count(*) FILTER (WHERE hit) >= 5 AND (
      (count(*) FILTER (WHERE hit) + 5) / (sum(coalesce(base_rate, p_base)) + 5) >= 1.5 OR
      (count(*) FILTER (WHERE hit) + 5) / (sum(coalesce(base_rate, p_base)) + 5) <= 1 / 1.5),
    now()
  FROM xinix_sprint_news WHERE hit IS NOT NULL
  GROUP BY grp
  ON CONFLICT (grp) DO UPDATE SET label = excluded.label, n = excluded.n, hits = excluded.hits, expected = excluded.expected,
    rate_pct = excluded.rate_pct, lift = excluded.lift, used = excluded.used, computed_at = excluded.computed_at;
$$;
REVOKE ALL ON FUNCTION public.xinix_sprint_news_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xinix_sprint_news_lift_refresh(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xinix_sprint_news_sync() TO service_role;
GRANT EXECUTE ON FUNCTION public.xinix_sprint_news_lift_refresh(numeric) TO service_role;

-- 8) Cron: elke 2 uur op werkdagen (verse TradingView-koersen), en tijdelijk
--    elke 5 minuten een nieuws-inhaalslag tot de achterstand weg is.
SELECT cron.unschedule('xinix-sprint') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-sprint');
SELECT cron.schedule('xinix-sprint', '20 */2 * * 1-5', $$SELECT public.invoke_edge('xinix-sprint?mode=run')$$);
SELECT cron.unschedule('xinix-sprint-news') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-sprint-news');
SELECT cron.schedule('xinix-sprint-news', '*/5 * * * *', $$SELECT public.invoke_edge('xinix-sprint?mode=news')$$);
