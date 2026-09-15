-- Hippos (xinix-hippo-background) — sub-tabblad Favorieten → Hippos.
--
-- Vraag: welke favorieten (hartje) hebben nú de grootste kans om binnen 14
-- dagen minimaal +50% te stijgen? En: stuur meteen een ntfy-melding zodra die
-- kans boven een instelbare drempel komt (standaard 80%).
--
-- Het model is volledig gemeten, niet bedacht:
--   1. Per favoriet worden 10 jaar dagkoersen bij Yahoo opgehaald. Voor élke
--      handelsdag wordt gekeken: haalde de koers in de 10 handelsdagen daarna
--      (≈ 14 kalenderdagen) minimaal +50% en hield dat minstens één dag stand?
--      Dat is de gebeurtenis. Per dag worden ook vijf toestandskenmerken
--      vastgelegd (5-daags rendement, 22-daags rendement, volume t.o.v. het
--      30-daags gemiddelde, dagen sinds de vorige +50%-piek, afstand tot de
--      1-jaarstop). Per kenmerk en per bucket tellen we n en treffers.
--   2. Die tellingen worden over alle favorieten samengevoegd tot één basiskans
--      en per bucket een gemeten lift. De actuele toestand van een favoriet
--      (uit signal_price_summary, dagelijks vers) bepaalt welke buckets gelden.
--      Kans = basiskans × eigen-historie-lift × Π bucket-lifts (in odds).
--   3. Omdat de kenmerken elkaar overlappen (een aandeel midden in een sprint
--      scoort op alles tegelijk) overdrijft die vermenigvuldiging. Daarom een
--      kalibratielaag: bij elke herscan wordt de modelkans voor élke
--      historische dag berekend en per kansbucket geteld hoe vaak het écht
--      gebeurde. De getoonde kans is de gemeten frequentie in die bucket.
--
-- De scan is gebudgetteerd (Yahoo, ~100 favorieten per run, herscan per 30
-- dagen); het scoren en melden gebeurt elke run, op verse koersen.

-- 1) Per favoriet de gemeten historie (tellingen, geen ruwe koersen).
CREATE TABLE IF NOT EXISTS public.xinix_hippo_history (
  ticker          text PRIMARY KEY,
  scanned_at      timestamptz NOT NULL DEFAULT now(),
  ok              boolean NOT NULL DEFAULT true,
  error           text,
  bars            integer NOT NULL DEFAULT 0,     -- aantal dagkoersen (max ~2500)
  days_n          integer NOT NULL DEFAULT 0,     -- beoordeelde dagen
  hits            integer NOT NULL DEFAULT 0,     -- dagen waarop binnen 10 handelsdagen +50% volgde
  hits_2y         integer NOT NULL DEFAULT 0,     -- idem, laatste 2 jaar
  days_2y         integer NOT NULL DEFAULT 0,
  peak_count      integer NOT NULL DEFAULT 0,     -- aantal +50%-pieken (10-daags venster) in 10 jaar
  last_peak_date  date,
  first_date      date,
  -- {r5:{bucket:{n,h}}, r22:{...}, vol:{...}, since:{...}, hi:{...}}
  buckets         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {kansbucket:{n,h}} — modelkans per historische dag vs. wat er echt gebeurde
  calib           jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- 2) De ranglijst: één rij per favoriet met historie.
CREATE TABLE IF NOT EXISTS public.xinix_hippo_scores (
  ticker          text PRIMARY KEY,
  rank            integer NOT NULL,
  prob            numeric NOT NULL,               -- gekalibreerde kans (%) op +50% binnen 14 dagen
  raw_prob        numeric NOT NULL,               -- modelkans vóór kalibratie (%)
  base_rate       numeric NOT NULL,               -- gepoolde basiskans (%)
  own_rate        numeric,                        -- eigen basiskans (%) van dit aandeel
  company         text,
  sector          text,
  exchange        text,
  last_close      numeric,
  dollar_volume   numeric,
  pct_change_5d   numeric,
  pct_change_22d  numeric,
  volume_ratio    numeric,
  days_since_peak integer,
  pct_below_high1y numeric,
  peak_count      integer NOT NULL DEFAULT 0,
  rating          smallint,
  tradeable       boolean NOT NULL DEFAULT true,
  factors         jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{label, detail, mult}]
  flags           text[] NOT NULL DEFAULT '{}',
  scanned_at      timestamptz,                    -- wanneer de historie gemeten is
  alerted_at      timestamptz,                    -- laatste hippo-melding
  alerted_prob    numeric,                        -- kans bij die melding
  computed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS xinix_hippo_scores_rank_idx ON public.xinix_hippo_scores (rank);

-- 3) Kalibratie van de laatste run (één rij, wordt overschreven).
CREATE TABLE IF NOT EXISTS public.xinix_hippo_calibration (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  computed_at     timestamptz NOT NULL DEFAULT now(),
  base_rate       numeric NOT NULL,               -- gepoolde kans (%) per dag
  days_n          bigint NOT NULL,
  hits            bigint NOT NULL,
  tickers_scanned integer NOT NULL,
  favorites       integer NOT NULL,
  -- per kenmerk: [{bucket, n, hits, rate_pct, lift}]
  lifts           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{bucket, lo, hi, n, hits, rate_pct}] — modelkans vs. werkelijkheid
  calib           jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_prob        numeric                         -- hoogste gekalibreerde kans in deze run
);

ALTER TABLE public.xinix_hippo_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xinix_hippo_scores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xinix_hippo_calibration ENABLE ROW LEVEL SECURITY;

-- 4) Meldingsdrempel (%). Een hippo-melding gaat buiten de globale cooldown om
--    (de gebeurtenis is te kortstondig om 100 dagen te wachten), maar
--    respecteert demping en "gezien", en meldt per aandeel hoogstens één keer
--    per 14 dagen tenzij de kans sindsdien ≥10 punten is gestegen.
ALTER TABLE public.signal_settings
  ADD COLUMN IF NOT EXISTS hippo_alert_min_prob numeric NOT NULL DEFAULT 80;
COMMENT ON COLUMN public.signal_settings.hippo_alert_min_prob IS
  'Hippos: stuur een ntfy-melding zodra de gekalibreerde kans op +50% binnen 14 dagen voor een favoriet minimaal dit percentage is. 0 = uit.';

-- 5) Elke 2 uur (om :45, na de poefie-scan om :15). Elke run scant een batch
--    favorieten bij Yahoo en herberekent daarna de hele ranglijst op verse
--    koersen, zodat een melding hoogstens 2 uur na de koersupdate volgt.
SELECT cron.unschedule('xinix-hippos')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-hippos');
SELECT cron.schedule(
  'xinix-hippos', '45 */2 * * *',
  $$SELECT public.invoke_edge('xinix-hippo-background')$$
);
