-- Families-grafiek: server-side aggregatie + handelsdag-filter.
--
-- WAAROM deze migratie bestaat (twee bugs die telkens terugkwamen):
--
-- Bug A — "aantal lijnen neemt af / pieken aan de rechterkant":
--   xinix-sim-results haalde de VOLLEDIGE xinix_strategy_equity-tabel op
--   (.select(...).order(date)) zonder paginering. De Supabase Data API kapt
--   zo'n response af op 10.000 rijen. Met 553 strategieën × N dagen zit je
--   daar binnen ~18 dagen overheen: de laatste zichtbare dag had dan nog maar
--   ~46/553 strategieën → de meeste familie-lijnen stopten een dag te vroeg en
--   de paar die doorliepen toonden onzin-gemiddelden (over 1-2 strategieën).
--   Recente dagen vielen volledig weg. Server-side aggregeren lost dit
--   definitief op: het resultaat is ~groepen × handelsdagen (honderden rijen),
--   nooit meer in de buurt van de 10k-limiet.
--
-- Bug B — "lijnen lopen te lang horizontaal; weekenden moeten worden overgeslagen":
--   De sim schrijft elke kalenderdag een equity-snapshot, óók in het weekend en
--   op dagen zonder koersbeweging. Op de grafiek-as werden die als platte
--   segmenten getekend. We filteren nu naar échte handelsdagen.
--
--   Definitie handelsdag (bewust GEEN vaste VS-feestdagkalender, want de
--   portefeuilles handelen óók in CA/UK/DE/AU/HK — op bv. Memorial Day is de
--   VS dicht maar bewegen die markten wél):
--     1. Geen zaterdag/zondag (wereldwijd geen enkele beurs open).
--     2. De totale portefeuillewaarde bewoog > 0,03% t.o.v. de vorige werkdag.
--        Op een stale/feestdag zonder koersupdate is de enige beweging
--        TX-ruis (~0,01%); een echte handelsdag beweegt ≥0,1%. Zo blijven
--        internationale handelsdagen (bv. Memorial Day) staan en verdwijnen
--        alleen weekenden + dagen zonder nieuwe koersinformatie.

-- ── RPC 1: per familie (groep) per handelsdag het gemiddelde rendement ────────
CREATE OR REPLACE FUNCTION public.xinix_family_series(p_max_days int DEFAULT 120)
RETURNS TABLE(grp text, d date, avg_return_pct double precision, n integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH eq AS (
    SELECT e.strategy_id, e.date, e.total_equity,
           COALESCE(st.initial_capital, 10000) AS initial
    FROM xinix_strategy_equity e
    JOIN xinix_strategy_state st ON st.strategy_id = e.strategy_id
  ),
  -- Totale portefeuillewaarde per werkdag (za/zo meteen eruit).
  weekday_tot AS (
    SELECT date, SUM(total_equity) AS tot
    FROM eq
    WHERE EXTRACT(ISODOW FROM date) < 6
    GROUP BY date
  ),
  flagged AS (
    SELECT date, tot, LAG(tot) OVER (ORDER BY date) AS prev_tot
    FROM weekday_tot
  ),
  -- Handelsdag = eerste dag, of >0,03% beweging t.o.v. de vorige werkdag.
  trading_days AS (
    SELECT date
    FROM flagged
    WHERE prev_tot IS NULL
       OR abs(tot - prev_tot) > 0.0003 * prev_tot
  ),
  -- Begrens tot de laatste N handelsdagen (houdt het resultaat klein en
  -- ver onder de Data-API-limiet, ook over jaren heen).
  recent_days AS (
    SELECT date FROM trading_days ORDER BY date DESC LIMIT GREATEST(p_max_days, 1)
  )
  SELECT s.grp,
         eq.date AS d,
         AVG((eq.total_equity - eq.initial) / NULLIF(eq.initial, 0) * 100.0)::double precision AS avg_return_pct,
         COUNT(*)::int AS n
  FROM eq
  JOIN xinix_strategies s ON s.id = eq.strategy_id AND s.active
  WHERE eq.date IN (SELECT date FROM recent_days)
  GROUP BY s.grp, eq.date
  ORDER BY s.grp, eq.date;
$$;

COMMENT ON FUNCTION public.xinix_family_series(int) IS
  'Families-grafiek: per groep per handelsdag het gemiddelde rendement%. Server-side geaggregeerd (omzeilt de 10k-rijenlimiet) en gefilterd op echte handelsdagen (geen weekenden / dagen zonder koersbeweging).';

-- ── RPC 2: positieve-dagen per strategie (was óók slachtoffer van de 10k-cap) ──
CREATE OR REPLACE FUNCTION public.xinix_strategy_positive_days()
RETURNS TABLE(strategy_id integer, pos_days integer, total_days integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT e.strategy_id,
         COUNT(*) FILTER (WHERE e.total_equity > COALESCE(st.initial_capital, 10000))::int AS pos_days,
         COUNT(*)::int AS total_days
  FROM xinix_strategy_equity e
  JOIN xinix_strategy_state st ON st.strategy_id = e.strategy_id
  GROUP BY e.strategy_id;
$$;

COMMENT ON FUNCTION public.xinix_strategy_positive_days() IS
  'Aandeel equity-snapshots waarop een strategie boven het startkapitaal stond. Server-side geaggregeerd zodat de 10k-rijenlimiet niet meer bijt.';
