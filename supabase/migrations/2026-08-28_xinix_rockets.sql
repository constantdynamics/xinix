-- Raketten (xinix-rocket-background) — vervangt het verdubbel-model in het
-- tabblad Favorieten → Raketten (voorheen "Verdubbelaars").
--
-- Andere vraag dan het oude model. Oud: "verdubbelt dit binnen 12 maanden?"
-- Nieuw: "maakt dit de komende 6 maanden ergens een maand door van +150%?"
-- Dat is een veel extremere gebeurtenis en vraagt een ander mechanisme.
--
-- Het model rust op één gemeten regelmaat uit het 10-jarige poefie-archief
-- (2506 incidenten): explosies clusteren, en dat effect dooft meetbaar uit.
-- Kans op een nieuwe >=150%-explosie binnen 6 maanden, naar tijd sinds de
-- vorige explosie:
--     30d -> 12.1%   90d -> 10.2%   180d -> 9.2%
--    365d ->  7.0%   730d ->  5.2%  1460d -> 4.2%
-- (n ~ 500-2300 per punt). Een aandeel zonder explosie-historie zit op 2.1%.
-- De basiskans voor een willekeurig watchlist-aandeel is 4.6% per 6 maanden.
--
-- De curve wordt bij ELKE run opnieuw uit de data gemeten (zie
-- xinix_rocket_calibration), zodat het model meegroeit met het archief in
-- plaats van vast te roesten op ingebakken constanten.

CREATE TABLE IF NOT EXISTS public.xinix_rocket_scores (
  ticker              text PRIMARY KEY,
  rank                integer NOT NULL,
  -- Geschatte kans (%) op >=150% binnen ~30 dagen, ergens in de komende 6 maanden.
  prob_6m             numeric NOT NULL,
  -- Basiskans uit de vervalcurve, vóór de vermenigvuldigers.
  base_prob           numeric NOT NULL,
  days_since_explosion integer,
  company             text,
  sector              text,
  exchange            text,
  last_close          numeric,
  market_cap_usd      bigint,
  dollar_volume       numeric,
  pct_change_22d      numeric,
  pct_below_high5y    numeric,
  max_explosion_pct   numeric,
  catalyst_date       date,
  catalyst_type       text,
  explosion_count     integer NOT NULL DEFAULT 0,
  is_favorite         boolean NOT NULL DEFAULT false,
  rating              smallint,
  tradeable           boolean NOT NULL DEFAULT true,
  -- Elke vermenigvuldiger met label en waarde, voor de uitleg in de UI.
  factors             jsonb NOT NULL DEFAULT '[]'::jsonb,
  flags               text[] NOT NULL DEFAULT '{}',
  computed_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS xinix_rocket_scores_rank_idx ON public.xinix_rocket_scores (rank);
CREATE INDEX IF NOT EXISTS xinix_rocket_scores_fav_idx  ON public.xinix_rocket_scores (is_favorite) WHERE is_favorite;

-- Kalibratie per run: de gemeten vervalcurve + de dekking waarop hij rust.
-- Hiermee is achteraf te zien op hoeveel waarnemingen een ranglijst stoelde.
CREATE TABLE IF NOT EXISTS public.xinix_rocket_calibration (
  id           bigserial PRIMARY KEY,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  curve        jsonb NOT NULL,        -- [{days, prob_pct, n, hits}]
  base_rate_6m numeric,               -- basiskans zonder explosie-historie
  incidents    integer,               -- omvang van het archief
  tickers_scored integer
);

-- RLS aan zonder policy = alleen de service-role (edge functions) erbij;
-- de frontend leest via de rocket-scores edge function.
ALTER TABLE public.xinix_rocket_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xinix_rocket_calibration ENABLE ROW LEVEL SECURITY;

-- Elke 30 dagen verversen. Cron kent geen "elke 30 dagen", dus: de 1e van de
-- maand 07:00 UTC. Dat is na de koersenpull (22:05 UTC) en na de
-- kennisexport (06:00 UTC), zodat de ranglijst op verse data staat.
SELECT cron.unschedule('xinix-rockets')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-rockets');

SELECT cron.schedule(
  'xinix-rockets', '0 7 1 * *',
  $$SELECT public.invoke_edge('xinix-rocket-background')$$
);
