-- Explosie-motor: één meting voor hippos, raketten, hikkertjes, poefies,
-- 5-sterren-scanner en feniksen, over de watchlist én het hele Saxo-universum.
--
-- Stroom:
--   xinix-engine/universe (dagelijks 22:40 UTC)
--     TradingView-sweep over ~20 beurzen (~22k primaire gewone aandelen) →
--     live kenmerken in xinix_universe → alle aandelen scoren op 8 events →
--     treffers per onderdeel (vaste criteria) automatisch naar de watchlist.
--   xinix-engine/deep (elke 20 min, gebudgetteerd)
--     10 jaar Yahoo-dagkoersen per aandeel, in prioriteitsvolgorde (eerst de
--     watchlist, dan het universum, beweeglijkste eerst) → tellingen per
--     kenmerk/bucket/event in xinix_event_history + samenvatting in
--     xinix_universe. Rekent ook het track record af.
--
-- Zie supabase/functions/_shared/engine.ts voor de definities.

-- 1) Het universum: één rij per aandeel (Yahoo-symbool).
CREATE TABLE IF NOT EXISTS public.xinix_universe (
  ticker            text PRIMARY KEY,
  tv_symbol         text,
  market            text,
  exchange          text,
  name              text,
  currency          text,
  tv_sector         text,
  tv_industry       text,
  in_watchlist      boolean NOT NULL DEFAULT false,
  is_favorite       boolean NOT NULL DEFAULT false,
  -- live (TradingView, dagelijks na de Amerikaanse slotbel)
  close             numeric,
  change_1d         numeric,
  perf_w            numeric,
  perf_1m           numeric,
  perf_6m           numeric,
  volume            numeric,
  avg_vol_30d       numeric,
  mcap_usd          numeric,
  hi52              numeric,
  lo52              numeric,
  hi3m              numeric,
  lo3m              numeric,
  hi_all            numeric,
  lo_all            numeric,
  volat_m           numeric,
  tv_at             timestamptz,
  -- wachtrij van de deep-scan
  tier              smallint,          -- 1 beweeglijk, 2 middel, 3 rustig (niet gescand)
  priority          numeric,
  requeue_at        timestamptz,       -- sprong gezien → opnieuw meten vanaf dit moment
  -- deep-scan (10 jaar Yahoo)
  deep_at           timestamptz,
  deep_ok           boolean,
  deep_error        text,
  bars              integer,
  first_date        date,
  last_peak_date    date,
  peak_count        integer,
  spikes_1y         integer,
  spike_dates       date[],
  last_spike_date   date,
  poefie_count      integer,
  poefie_count_2y   integer,
  last_poefie_date  date,
  poefie_max_growth numeric,
  hist_peak         numeric,
  hi5y              numeric,
  lo5y              numeric,
  phoenix_run       boolean,
  phoenix_peak      numeric,
  phoenix_peak_date date,
  volat22           numeric,
  own_n             integer[],         -- eigen beoordeelde dagen per groep (kort, lang)
  own_h             integer[],         -- eigen treffers per event
  -- scores: gekalibreerde kans in %
  p_h7  numeric, p_h14 numeric, p_h21 numeric,
  p_k30 numeric, p_k90 numeric,
  p_p30 numeric, p_p90 numeric,
  p_rk  numeric,
  raw               real[],            -- modelkans vóór kalibratie, per event
  fb                smallint[],        -- actuele bucket per kenmerk (factoren zijn hieruit af te leiden)
  star_fit          numeric,
  hits              text[],            -- onderdelen waarvan het aandeel nu de criteria haalt
  add_hint          text,              -- waarom (voor de toevoeg-notitie)
  strength          numeric,           -- sterkste treffer eerst bij het dagplafond
  tradeable         boolean,           -- koers ≥ $0,05 en ≥ $10k omzet per dag
  scored_at         timestamptz,
  added_at          timestamptz,       -- door de motor aan de watchlist toegevoegd
  add_reason        text
);
CREATE INDEX IF NOT EXISTS xinix_universe_deep_idx ON public.xinix_universe (deep_at NULLS FIRST);
CREATE INDEX IF NOT EXISTS xinix_universe_added_idx ON public.xinix_universe (added_at) WHERE added_at IS NOT NULL;
ALTER TABLE public.xinix_universe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xinix_universe SET (autovacuum_vacuum_scale_factor = 0.05, fillfactor = 85);

-- 2) Tellingen per aandeel (vaste layout, zie engine.ts: LAYOUT/LEN).
CREATE TABLE IF NOT EXISTS public.xinix_event_history (
  ticker      text PRIMARY KEY,
  layout      smallint NOT NULL,
  scanned_at  timestamptz NOT NULL DEFAULT now(),
  ok          boolean NOT NULL DEFAULT true,
  counts      integer[] NOT NULL
);
ALTER TABLE public.xinix_event_history ENABLE ROW LEVEL SECURITY;

-- 3) De gepoolde tellingen (één rij). De deep-scan werkt hem per run
--    incrementeel bij; de dagelijkse run telt alles opnieuw op.
CREATE TABLE IF NOT EXISTS public.xinix_event_pool (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  layout      smallint NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  tickers     integer NOT NULL DEFAULT 0,
  counts      bigint[] NOT NULL
);
ALTER TABLE public.xinix_event_pool ENABLE ROW LEVEL SECURITY;

-- 4) Per event het gemeten model: basiskans, lifts per kenmerk (met welke er
--    meetellen), kalibratie, plafond en de backtest van de vaste criteria.
CREATE TABLE IF NOT EXISTS public.xinix_event_models (
  event        text PRIMARY KEY,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  label        text NOT NULL,
  base_rate    numeric NOT NULL,     -- % van de beoordeelde dagen
  days_n       bigint NOT NULL,
  hits         bigint NOT NULL,
  tickers      integer NOT NULL,
  features     jsonb NOT NULL DEFAULT '[]'::jsonb,
  calib        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ceiling      numeric,
  backtest     jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_prob     numeric,
  scored       integer
);
ALTER TABLE public.xinix_event_models ENABLE ROW LEVEL SECURITY;

-- 5) Track record: wat zei het model, en kwam het uit? Per event dagelijks
--    de kopgroep plus favorieten met een verhoogde kans; afgewikkeld op de
--    echte dagkoersen zodra de horizon voorbij is.
CREATE TABLE IF NOT EXISTS public.xinix_event_predictions (
  event        text NOT NULL,
  ticker       text NOT NULL,
  made_on      date NOT NULL,
  made_at      timestamptz NOT NULL DEFAULT now(),
  prob         numeric NOT NULL,
  raw_prob     numeric,
  base_rate    numeric,
  entry_close  numeric,
  source       text NOT NULL,        -- 'top' of 'favoriet'
  due_on       date NOT NULL,
  resolved     boolean NOT NULL DEFAULT false,
  hit          boolean,
  resolved_at  timestamptz,
  PRIMARY KEY (event, ticker, made_on)
);
CREATE INDEX IF NOT EXISTS xinix_event_predictions_open_idx ON public.xinix_event_predictions (due_on) WHERE NOT resolved;
ALTER TABLE public.xinix_event_predictions ENABLE ROW LEVEL SECURITY;

-- 6) Instellingen.
ALTER TABLE public.signal_settings
  ADD COLUMN IF NOT EXISTS universe_auto_add boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS universe_max_add_per_day integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS engine_hippo_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS engine_rocket_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.signal_settings.universe_auto_add IS
  'Explosie-motor: voeg aandelen uit het universum die de criteria van een onderdeel halen automatisch toe aan de watchlist.';
COMMENT ON COLUMN public.signal_settings.universe_max_add_per_day IS
  'Explosie-motor: hoogstens zoveel automatische toevoegingen per dag (sterkste treffers eerst).';
COMMENT ON COLUMN public.signal_settings.engine_hippo_enabled IS
  'Explosie-motor: vul de Hippos-ranglijst, -kalibratie, -meldingen en het track record vanuit de motor in plaats van xinix-hippo-background.';
COMMENT ON COLUMN public.signal_settings.engine_rocket_enabled IS
  'Explosie-motor: vul de Raketten-ranglijst vanuit de motor in plaats van xinix-rocket-background.';

-- 7) De wachtrij van de deep-scan, in de database zodat de functie niet het
--    hele universum hoeft op te halen.
CREATE OR REPLACE FUNCTION public.xinix_deep_scan_queue(p_limit integer)
RETURNS TABLE (ticker text, reason text)
LANGUAGE sql STABLE AS $$
  WITH wl AS (
    SELECT t.ticker, (f.ticker IS NOT NULL) AS fav
    FROM signal_tickers t LEFT JOIN xinix_favorites f ON f.ticker = t.ticker
    WHERE t.active
  ),
  cand AS (
    -- 1. watchlist die de motor nog nooit zag (favorieten eerst)
    SELECT w.ticker, 'watchlist-nieuw' AS reason, 1 AS prio, CASE WHEN w.fav THEN 0 ELSE 1 END AS sub, 0::numeric AS ord
    FROM wl w LEFT JOIN xinix_universe u ON u.ticker = w.ticker
    WHERE u.deep_at IS NULL
    UNION ALL
    -- 2. voorspellingen waarvan de horizon voorbij is
    SELECT DISTINCT p.ticker, 'track-record', 2, 0, 0
    FROM xinix_event_predictions p
    WHERE NOT p.resolved AND p.due_on <= current_date
    UNION ALL
    -- 3. sprong gezien in de sweep
    SELECT u.ticker, 'sprong', 2, 1, extract(epoch FROM u.requeue_at)::numeric
    FROM xinix_universe u WHERE u.requeue_at IS NOT NULL AND u.requeue_at <= now()
    UNION ALL
    -- 4. universum nieuw, beweeglijkste eerst
    SELECT u.ticker, 'universum-nieuw', 3, u.tier, -coalesce(u.priority, 0)
    FROM xinix_universe u
    WHERE u.deep_at IS NULL AND NOT u.in_watchlist AND u.tier IN (1, 2)
    UNION ALL
    -- 5. watchlist herscan (favorieten per 30, rest per 60 dagen)
    SELECT w.ticker, 'watchlist-herscan', 4, 0, extract(epoch FROM u.deep_at)::numeric
    FROM wl w JOIN xinix_universe u ON u.ticker = w.ticker
    WHERE u.deep_at < now() - CASE WHEN w.fav THEN interval '30 days' ELSE interval '60 days' END
    UNION ALL
    -- 6. universum herscan
    SELECT u.ticker, 'universum-herscan', 5, u.tier, extract(epoch FROM u.deep_at)::numeric
    FROM xinix_universe u
    WHERE NOT u.in_watchlist AND u.deep_at IS NOT NULL AND u.tier IN (1, 2)
      AND u.deep_at < now() - CASE u.tier WHEN 1 THEN interval '60 days' ELSE interval '180 days' END
  )
  SELECT c.ticker, (array_agg(c.reason ORDER BY c.prio, c.sub, c.ord))[1]
  FROM cand c
  GROUP BY c.ticker
  ORDER BY min(c.prio), min(c.sub), min(c.ord)
  LIMIT p_limit;
$$;

-- 8) Alles opnieuw optellen (dagelijks, herstelt eventuele drift van de
--    incrementele bijwerking).
CREATE OR REPLACE FUNCTION public.xinix_event_pool_refresh(p_layout integer)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v bigint[]; nt integer;
BEGIN
  SELECT count(*) INTO nt FROM xinix_event_history WHERE ok AND layout = p_layout;
  SELECT array_agg(s ORDER BY i) INTO v FROM (
    SELECT u.i, sum(u.c)::bigint AS s
    FROM xinix_event_history h, unnest(h.counts) WITH ORDINALITY AS u(c, i)
    WHERE h.ok AND h.layout = p_layout
    GROUP BY u.i
  ) x;
  INSERT INTO xinix_event_pool (id, layout, computed_at, tickers, counts)
  VALUES (1, p_layout, now(), nt, coalesce(v, '{}'))
  ON CONFLICT (id) DO UPDATE SET layout = excluded.layout, computed_at = excluded.computed_at,
    tickers = excluded.tickers, counts = excluded.counts;
  RETURN nt;
END $$;

-- 9) Track record per event en per kansbucket (tellingen, geen losse rijen).
CREATE OR REPLACE FUNCTION public.xinix_event_track_record()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT event, source,
      CASE WHEN prob < 2 THEN '0-2' WHEN prob < 5 THEN '2-5' WHEN prob < 10 THEN '5-10'
           WHEN prob < 20 THEN '10-20' WHEN prob < 35 THEN '20-35' ELSE '35+' END AS bucket,
      prob, base_rate, resolved, hit
    FROM xinix_event_predictions
  )
  SELECT coalesce(jsonb_object_agg(event, body), '{}'::jsonb) FROM (
    SELECT event, jsonb_build_object(
      'made', count(*),
      'resolved', count(*) FILTER (WHERE resolved),
      'hits', count(*) FILTER (WHERE resolved AND hit),
      'avg_prob', round(avg(prob) FILTER (WHERE resolved), 1),
      'avg_base', round(avg(base_rate) FILTER (WHERE resolved), 2),
      'buckets', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('bucket', b.bucket, 'n', b.n, 'hits', b.h, 'avg_prob', b.ap) ORDER BY b.minp), '[]'::jsonb)
        FROM (SELECT bucket, count(*) n, count(*) FILTER (WHERE hit) h, round(avg(prob), 1) ap, min(prob) minp
              FROM r r2 WHERE r2.event = r.event AND r2.resolved GROUP BY bucket) b
      )
    ) AS body
    FROM r GROUP BY event
  ) x;
$$;

-- Alleen de service-rol (edge functions) mag deze aanroepen; de pool-refresh
-- is zwaar en hoort niet publiek aanroepbaar te zijn.
REVOKE ALL ON FUNCTION public.xinix_deep_scan_queue(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xinix_event_pool_refresh(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xinix_event_track_record() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xinix_deep_scan_queue(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.xinix_event_pool_refresh(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.xinix_event_track_record() TO service_role;

-- 10) Cron. De deep-scan draait elke 20 minuten en stopt vanzelf zodra de
--     wachtrij leeg is; de sweep één keer per dag na de Amerikaanse slotbel.
SELECT cron.unschedule('xinix-deep-scan') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-deep-scan');
SELECT cron.schedule('xinix-deep-scan', '5,25,45 * * * *', $$SELECT public.invoke_edge('xinix-engine/deep')$$);
-- De sweep past niet in één aanroep (CPU-limiet): vijf delen per marktgroep
-- en een afronding (track record, modellen, toevoegen).
DO $$ DECLARE j text; BEGIN
  FOREACH j IN ARRAY ARRAY['xinix-universe','xinix-universe-0','xinix-universe-1','xinix-universe-2','xinix-universe-3','xinix-universe-4','xinix-universe-finish'] LOOP
    PERFORM cron.unschedule(j) WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = j);
  END LOOP;
END $$;
SELECT cron.schedule('xinix-universe-0', '40 22 * * *', $$SELECT public.invoke_edge('xinix-engine/universe?part=0')$$);
SELECT cron.schedule('xinix-universe-1', '42 22 * * *', $$SELECT public.invoke_edge('xinix-engine/universe?part=1')$$);
SELECT cron.schedule('xinix-universe-2', '44 22 * * *', $$SELECT public.invoke_edge('xinix-engine/universe?part=2')$$);
SELECT cron.schedule('xinix-universe-3', '46 22 * * *', $$SELECT public.invoke_edge('xinix-engine/universe?part=3')$$);
SELECT cron.schedule('xinix-universe-4', '48 22 * * *', $$SELECT public.invoke_edge('xinix-engine/universe?part=4')$$);
SELECT cron.schedule('xinix-universe-finish', '52 22 * * *', $$SELECT public.invoke_edge('xinix-engine/universe?part=finish')$$);
