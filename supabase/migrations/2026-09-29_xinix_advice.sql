-- Dagadvies: een papieren portefeuille van €10.000 bij DEGIRO, met dagelijks
-- koop- en verkoopadvies en een melding zodra er iets moet gebeuren.
--
-- Zes "boeken" die elk met €10.000 beginnen:
--   live     de portefeuille waarvoor je meldingen krijgt; volgt de bron die op
--            dit moment het beste track record heeft (begint op 'mix')
--   mix      alle bronnen samen (een aandeel dat door meer bronnen wordt
--            aangewezen weegt zwaarder)
--   potje    wat de tien beste Potje-strategieën van de laatste 60 dagen net
--            gekocht hebben
--   hippo    kans op +50% binnen 14 dagen (Hippos, hele watchlist)
--   sprint   ≥4★-favorieten met de Sprinter-kans (model × nieuws)
--   signaal  modelscore + positieve signalen, rond de aankooplimiet
-- De schaduwboeken draaien exact dezelfde regels (kosten, valuta, limieten,
-- stops) en vormen het track record waarmee xinix-advice elke maand de bron van
-- 'live' kiest.
--
-- Alle bedragen van een boek staan in euro. Koersen, limieten en stops staan in
-- de munt waarin de beurs noteert (Londen in pence, net als bij DEGIRO).

CREATE TABLE IF NOT EXISTS public.xinix_fx_rates (
  currency   text        PRIMARY KEY,
  per_eur    numeric     NOT NULL CHECK (per_eur > 0),   -- eenheden per 1 euro (ECB-referentiekoers)
  as_of      date        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.xinix_fx_rates ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.xinix_advice_books (
  book           text        PRIMARY KEY,
  label          text        NOT NULL,
  source         text        NOT NULL,              -- live: de bron die hij nu volgt; schaduwboek: zichzelf
  source_since   timestamptz NOT NULL DEFAULT now(),
  cash_eur       numeric     NOT NULL,
  start_eur      numeric     NOT NULL DEFAULT 10000,
  started_at     timestamptz NOT NULL DEFAULT now(),
  fees_eur       numeric     NOT NULL DEFAULT 0,    -- transactie- en verwerkingskosten
  fx_cost_eur    numeric     NOT NULL DEFAULT 0,    -- AutoFX-opslag
  tax_eur        numeric     NOT NULL DEFAULT 0,    -- zegelrecht (Londen, Hongkong)
  connect_eur    numeric     NOT NULL DEFAULT 0,    -- aansluitkosten per beurs per jaar
  exchanges_paid jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- {"2026": ["NASDAQ", "TSXV"]}
  last_daily_at  timestamptz,
  last_select_at timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.xinix_advice_books ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.xinix_advice_orders (
  id           bigserial   PRIMARY KEY,
  book         text        NOT NULL REFERENCES public.xinix_advice_books(book) ON DELETE CASCADE,
  ticker       text        NOT NULL,
  tv_symbol    text,
  market       text,                                -- TradingView-regio (america, canada, uk, …)
  exchange     text,                                -- beurs voor de aansluitkosten (NASDAQ, TSXV, LSE, …)
  currency     text        NOT NULL,                -- munt van de notering (GBp = pence)
  side         text        NOT NULL DEFAULT 'buy' CHECK (side IN ('buy')),
  limit_price  numeric     NOT NULL CHECK (limit_price > 0),
  qty          numeric     NOT NULL CHECK (qty > 0),
  reserved_eur numeric     NOT NULL,                -- wat de order aan cash vasthoudt, incl. kosten
  close_at     numeric,                             -- slotkoers toen de order werd aangemaakt
  watch_limit  numeric,                             -- aankooplimiet uit de watchlist op dat moment
  conviction   numeric,
  source       text,
  reason       text,
  valid_from   timestamptz NOT NULL,                -- opening van de eerste sessie waarin hij kan vullen
  snap         jsonb,                               -- koersbeeld bij aanmaken (tegen oude sessiedata op feestdagen)
  misses       int         NOT NULL DEFAULT 0,      -- dagelijkse runs op rij zonder dat het aandeel nog kandidaat is
  status       text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  fill_price   numeric,
  cancel_reason text,
  position_id  bigint
);
CREATE INDEX IF NOT EXISTS xinix_advice_orders_open ON public.xinix_advice_orders (book) WHERE status = 'open';
ALTER TABLE public.xinix_advice_orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.xinix_advice_positions (
  id             bigserial   PRIMARY KEY,
  book           text        NOT NULL REFERENCES public.xinix_advice_books(book) ON DELETE CASCADE,
  ticker         text        NOT NULL,
  tv_symbol      text,
  market         text,
  exchange       text,
  currency       text        NOT NULL,
  qty            numeric     NOT NULL CHECK (qty > 0),
  entry_price    numeric     NOT NULL,              -- in de munt van de notering
  entry_per_eur  numeric     NOT NULL,              -- wisselkoers bij aankoop (munt per euro)
  cost_eur       numeric     NOT NULL,              -- totaal betaald, incl. alle kosten
  stop_price     numeric,                           -- de GTC stop-loss die bij DEGIRO hoort te staan
  high_price     numeric,                           -- hoogste waargenomen koers sinds aankoop (voor het meetrekken)
  last_price     numeric,
  last_price_at  timestamptz,
  source         text,
  conviction     numeric,
  reason         text,
  opened_at      timestamptz NOT NULL DEFAULT now(),
  opened_session timestamptz,                       -- opening van de sessie waarin hij vulde
  snap           jsonb,                             -- koersbeeld bij de vulling (zelfde doel als bij orders)
  exit_pending   text,                              -- verkoopadvies dat nog uitgevoerd moet worden (tijd, nieuws)
  exit_pending_at timestamptz,
  stop_noticed_at timestamptz,
  closed_at      timestamptz,
  exit_price     numeric,
  exit_per_eur   numeric,
  proceeds_eur   numeric,
  pnl_eur        numeric,
  pnl_pct        numeric,
  exit_reason    text
);
CREATE INDEX IF NOT EXISTS xinix_advice_positions_open ON public.xinix_advice_positions (book) WHERE closed_at IS NULL;
ALTER TABLE public.xinix_advice_positions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.xinix_advice_events (
  id          bigserial   PRIMARY KEY,
  book        text        NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  kind        text        NOT NULL,   -- order_new, order_cancel, fill, stop_raise, stop_hit, sell_advice, sell_done, source_switch, limit_hint, news
  ticker      text,
  message     text        NOT NULL,
  payload     jsonb,
  urgent      boolean     NOT NULL DEFAULT false,
  notified_at timestamptz
);
CREATE INDEX IF NOT EXISTS xinix_advice_events_book_at ON public.xinix_advice_events (book, at DESC);
CREATE INDEX IF NOT EXISTS xinix_advice_events_unsent ON public.xinix_advice_events (at) WHERE book = 'live' AND notified_at IS NULL;
ALTER TABLE public.xinix_advice_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.xinix_advice_equity (
  book         text    NOT NULL,
  date         date    NOT NULL,
  equity_eur   numeric NOT NULL,
  cash_eur     numeric NOT NULL,
  invested_eur numeric NOT NULL,
  positions    int     NOT NULL,
  PRIMARY KEY (book, date)
);
ALTER TABLE public.xinix_advice_equity ENABLE ROW LEVEL SECURITY;

-- Nieuws over aandelen die in een boek zitten of waarop een order staat
-- (Yahoo, elke 2 uur), met een eenvoudige toonbepaling op trefwoorden.
CREATE TABLE IF NOT EXISTS public.xinix_advice_news (
  id           bigserial   PRIMARY KEY,
  ticker       text        NOT NULL,
  published_at timestamptz,
  title        text        NOT NULL,
  link         text,
  publisher    text,
  tone         text        NOT NULL CHECK (tone IN ('positief', 'negatief', 'let_op', 'neutraal')),
  kind         text,
  seen_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticker, title)
);
CREATE INDEX IF NOT EXISTS xinix_advice_news_ticker ON public.xinix_advice_news (ticker, published_at DESC);
ALTER TABLE public.xinix_advice_news ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.signal_tickers ADD COLUMN IF NOT EXISTS advice_news_at timestamptz;

ALTER TABLE public.signal_settings ADD COLUMN IF NOT EXISTS advice_notify boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.signal_settings.advice_notify IS
  'Dagadvies: ntfy-meldingen voor de live-portefeuille aan/uit (buiten de afkoelperiode om).';

-- Bron 'potje': de tien strategieën met het beste rendement over 60 dagen (met
-- minstens 5 gesloten trades in 90 dagen, anders is het geluk) en wat ze de
-- afgelopen week gekocht hebben en nog vasthouden. Hoe meer toppers hetzelfde
-- aandeel kochten, hoe groter de overtuiging.
CREATE OR REPLACE FUNCTION public.xinix_advice_potje_picks(p_top int DEFAULT 10, p_days int DEFAULT 7)
RETURNS TABLE (ticker text, holders int, slugs text[], avg_r60 numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH nu AS (
    SELECT DISTINCT ON (strategy_id) strategy_id, total_equity
    FROM xinix_strategy_equity WHERE date >= current_date - 7
    ORDER BY strategy_id, date DESC
  ), toen AS (
    SELECT DISTINCT ON (strategy_id) strategy_id, total_equity
    FROM xinix_strategy_equity WHERE date BETWEEN current_date - 75 AND current_date - 60
    ORDER BY strategy_id, date DESC
  ), trades AS (
    SELECT strategy_id, count(*) AS n FROM xinix_strategy_positions
    WHERE closed_at > now() - interval '90 days' GROUP BY 1
  ), top AS (
    SELECT s.id, s.slug, nu.total_equity / toen.total_equity - 1 AS r60
    FROM xinix_strategies s
    JOIN nu ON nu.strategy_id = s.id
    JOIN toen ON toen.strategy_id = s.id AND toen.total_equity > 0
    JOIN trades t ON t.strategy_id = s.id AND t.n >= 5
    WHERE s.active AND s.retired_at IS NULL
    ORDER BY r60 DESC
    LIMIT p_top
  )
  SELECT p.ticker, count(DISTINCT p.strategy_id)::int, array_agg(DISTINCT top.slug), round(avg(top.r60) * 100, 1)
  FROM xinix_strategy_positions p JOIN top ON top.id = p.strategy_id
  WHERE p.closed_at IS NULL AND p.entry_date >= now() - make_interval(days => p_days)
  GROUP BY p.ticker;
$$;
REVOKE ALL ON FUNCTION public.xinix_advice_potje_picks(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xinix_advice_potje_picks(int, int) TO service_role;

INSERT INTO public.xinix_advice_books (book, label, source, cash_eur) VALUES
  ('live',    'Jouw portefeuille', 'mix',     10000),
  ('mix',     'Mix van alle bronnen', 'mix',  10000),
  ('potje',   'Potje-toppers',     'potje',   10000),
  ('hippo',   'Hippos',            'hippo',   10000),
  ('sprint',  'Sprinters (≥4★)',   'sprint',  10000),
  ('signaal', 'Signalen',          'signaal', 10000)
ON CONFLICT (book) DO NOTHING;

-- Kwartier-ronde (vullingen, stops, meetrekken, nieuws) en de dagelijkse run
-- na de Potje-simulatie (22:30 UTC): nieuwe orders, afloop, maandkeuze.
SELECT cron.unschedule('xinix-advice-watch') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-advice-watch');
SELECT cron.schedule('xinix-advice-watch', '*/15 * * * *', $$SELECT public.invoke_edge('xinix-advice?mode=watch')$$);
SELECT cron.unschedule('xinix-advice-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-advice-daily');
SELECT cron.schedule('xinix-advice-daily', '10 23 * * 1-5', $$SELECT public.invoke_edge('xinix-advice?mode=daily')$$);
