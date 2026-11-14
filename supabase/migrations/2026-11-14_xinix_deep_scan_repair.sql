-- xinix-deep-scan liep sinds 2 november bij elke run vast (72 keer per dag), met de fout
-- 'null value in column "prob" of relation "xinix_event_predictions" violates not-null constraint'.
-- Elke run haalde dezelfde 21 aandelen opnieuw bij Yahoo op (ruim 1.500 verzoeken per dag) en het
-- track record van de explosie-motor werd niet bijgewerkt. Hersteld in de database, zonder de functie
-- opnieuw uit te rollen. Na de reparatie: 90 voorspellingen van 25 september afgerekend, wachtrij leeg.

-- 1. Het afrekenen (xinix-engine/deep.ts) schrijft alleen event, ticker, made_on, resolved, hit en
--    resolved_at terug, als "invoegen of bijwerken". Postgres keurt eerst de in te voegen rij, en die
--    miste drie verplichte kolommen. Met een standaardwaarde is die rij geldig; ingevoegd wordt er nooit
--    iets, want de rij bestaat altijd al (hij is net uit deze tabel gelezen).
alter table public.xinix_event_predictions
  alter column prob set default 0,
  alter column source set default 'onbekend',
  alter column due_on set default current_date;

-- 2. De wachtrij zette een aandeel erin zodra een voorspelling verlopen was. Maar de rekenkern kan pas
--    afrekenen als er genoeg koersen ná de voorspelling zijn: 26 handelsdagen voor de korte events,
--    150 voor k90, p90 en rk (GROUP_FWD in _shared/engine.ts). Tot dan zou elke run dezelfde aandelen
--    opnieuw ophalen zonder iets te kunnen afrekenen, en na 30 dagen zou de voorspelling als "niet
--    uitgekomen" worden afgesloten zonder dat ernaar gekeken is. Nu komt een aandeel pas in de wachtrij
--    als afrekenen kan: 45 dagen na de voorspelling, of 225 dagen voor k90, p90 en rk.
create or replace function public.xinix_deep_scan_queue(p_limit integer)
returns table(ticker text, reason text)
language sql
stable
as $function$
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
      AND p.made_on <= current_date - (CASE WHEN p.event IN ('k90', 'p90', 'rk') THEN 225 ELSE 45 END)
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
