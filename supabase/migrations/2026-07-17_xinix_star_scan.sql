-- 5-sterren-scanner (xinix-star-scan-background)
--
-- Wekelijkse weekend-scan (za + zo) over de volledige watchlist die zoekt
-- naar aandelen met het "5-sterren-DNA" (zie docs/scan-briefing-5sterren.md):
--   • bewezen explosiviteit: 5y top/bodem-ratio ≥ 10× (ideaal ≥ 20×)
--   • diep gecrasht: 60–99% onder de 5-jaarstop
--   • verse dip: flink gedaald in de laatste ~22 handelsdagen
--   • substantie: market cap $25 mln – $10 mrd, voldoende liquiditeit
-- Elke kandidaat krijgt een fit-score 0–100 en een archetype. De ranking
-- blijft staan tussen runs ("blijft aanvullen"): first_seen_at laat zien
-- wanneer een kandidaat voor het eerst opdook; qualifies=false wanneer hij
-- niet meer aan de criteria voldoet (of favoriet is geworden).

CREATE TABLE IF NOT EXISTS public.xinix_star_scan_results (
  ticker           text PRIMARY KEY,
  qualifies        boolean NOT NULL DEFAULT true,
  score            numeric NOT NULL,
  best_score       numeric NOT NULL,
  archetype        text NOT NULL,
  reason           text,
  company          text,
  sector           text,
  exchange         text,
  yahoo_industry   text,
  last_close       numeric,
  market_cap_usd   bigint,
  range_5y         numeric,
  pct_vs_high5y    numeric,
  x_above_low5y    numeric,
  pct_change_22d   numeric,
  dollar_volume    numeric,
  medal_gold       integer,
  medal_silver     integer,
  breakdown        jsonb,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now()
);

-- RLS aan zonder policy = alleen de service-role (edge functions) erbij;
-- de frontend leest via de scan-results edge function.
ALTER TABLE public.xinix_star_scan_results ENABLE ROW LEVEL SECURITY;

-- Weekend-cron: zaterdag en zondag 08:10 UTC. De koersdata is dan de
-- vrijdagslot (poll-prices draait werkdagen 22:00 UTC), dus beide runs zien
-- dezelfde week-afsluiting; de zondagsrun vangt vooral zaterdagse
-- watchlist-aanvullingen van scan-losers/scan-bottoms mee.
SELECT cron.unschedule('xinix-star-scan')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-star-scan');

SELECT cron.schedule(
  'xinix-star-scan', '10 8 * * 6,0',
  $$SELECT public.invoke_edge('xinix-star-scan-background')$$
);
