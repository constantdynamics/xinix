-- xinix_price_flags — koers-artefact monitor voor de strategie-simulatie.
--
-- Aanleiding: een paar tickers met een onmogelijke koers t.o.v. de aankoopprijs
-- (VOX.L = pence/pond-glitch 100×, NAKA/CDLX = stock split) bliezen het
-- families-klassement op tot +795%. De sim waardeert open posities en realiseert
-- exits tegen de huidige koers, dus één glitch-positie van $2k werd "$200k".
--
-- xinix-sim-background neutraliseert sinds deze ronde zulke posities naar
-- break-even (waardeert tegen aankoopprijs i.p.v. de glitch-koers) en logt ze
-- hier, zodat ze handmatig of door de wekelijkse monitor split-adjusted kunnen
-- worden. Drempel: koers/avg_price >= 8 of <= 1/8 — ruim boven de hoogste echte
-- take-profit (+500% = 6×) en stop (-50%), dus echte uitkomsten worden niet geraakt.

CREATE TABLE IF NOT EXISTS xinix_price_flags (
  ticker            text PRIMARY KEY,
  avg_price         numeric,
  last_close        numeric,
  factor            numeric,
  n_positions       int,
  first_flagged_at  timestamptz NOT NULL DEFAULT now(),
  last_flagged_at   timestamptz NOT NULL DEFAULT now(),
  resolved          boolean NOT NULL DEFAULT false,
  note              text
);

-- RLS aan zonder policy = alleen de service-role (edge functions) mag erbij.
ALTER TABLE xinix_price_flags ENABLE ROW LEVEL SECURITY;
