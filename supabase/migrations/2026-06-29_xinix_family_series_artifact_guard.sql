-- Families-grafiek: koers-artefacten kunnen het ploegengemiddelde NOOIT meer
-- laten uitschieten. Dit is de derde keer dat één glitch-aandeel (split /
-- pence-pond-print, bv. VOX.L / WHIP.CN / NAKA) de grafiek opblies; deze ronde
-- maken we het structureel onmogelijk i.p.v. weer een drempel op te schroeven.
--
-- WAT GING ER MIS (2026-06-08 → 2026-06-16)
--   Een paar microcaps kregen een onmogelijke koers (8×–100× hun echte prijs).
--   xinix-sim-background waardeerde open posities én verkocht deelwinst tegen
--   die glitch-koers, dus de equity-snapshots in xinix_strategy_equity liepen op
--   tot +1.200% à +2.287% per strategie. Een handmatige fix op 2026-06-16 zette
--   de *huidige* cash/posities recht (zie xinix_price_artifact_fix_log) maar liet
--   de *historische* equity-rijen staan. De families-grafiek leest die historie,
--   dus de piek bleef zichtbaar. De 8×-guard in de sim kwam pas ná de glitch live
--   en beschermt alleen toekomstige waarderingen — niet de historie en niet het
--   leesmoment van de grafiek.
--
-- KALIBRATIE (waarom +300% de drempel is)
--   Gemeten op 2026-06-29: hoogste *echte* strategie-rendement = +31% (p99 +30%);
--   geen enkele actieve strategie staat ≥ +100%. In de zwaarst getroffen familie
--   (X-Hikkertjes, glitch-dag) was de verdeling: 14 strategieën ~+1.200%, 6 < +100%,
--   en NIETS daartussenin. Een papieren portefeuille die in een paar weken meer dan
--   verviervoudigt is in dit systeem nog nooit zonder data-artefact voorgekomen.
--   +300% ligt dus ~10× boven elk echt resultaat en ver onder de ~+1.000%+ artefacten:
--   midden in het lege gat. (De hoogste echte take-profit is +500% = 6× op één
--   positie, wat een hele portefeuille hooguit ~+60% geeft — ruim onder 300%.)
--
-- DRIE LAGEN VERDEDIGING (elk afdoende op zichzelf):
--   1. xinix_family_series sluit artefact-rendementen uit het ploegengemiddelde
--      (deze migratie). De grafiek kan wiskundig niet meer pieken, ongeacht de bron.
--   2. xinix_heal_equity_artifacts() interpoleert vervuilde historische equity-rijen
--      weg (deze migratie; eenmalig + dagelijks via pg_cron).
--   3. xinix-sim-background bevriest gevlagde glitch-tickers (aparte function-deploy).

-- Drempel: één bron van waarheid voor RPC én heal.
-- (Inline als constante; PostgREST-aanroep met alleen p_max_days blijft werken.)

-- ── RPC 1: per familie per handelsdag het gemiddelde rendement (artefact-vrij) ──
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
  trading_days AS (
    SELECT date
    FROM flagged
    WHERE prev_tot IS NULL
       OR abs(tot - prev_tot) > 0.0003 * prev_tot
  ),
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
    -- Artefact-guard: sluit onmogelijke per-strategie-rendementen uit het
    -- gemiddelde (en de telling) uit. Een dag waarop elke strategie in de groep
    -- een artefact is, levert geen rij op -> de grafiek tekent een gat i.p.v. een
    -- piek (de lijn verbindt over het gat heen). 300% = ver boven elk echt
    -- resultaat (max +31%), ver onder de ~+1.000%+ glitch-rendementen.
    AND eq.total_equity > 0
    AND (eq.total_equity - eq.initial) / NULLIF(eq.initial, 0) * 100.0 < 300.0
  GROUP BY s.grp, eq.date
  ORDER BY s.grp, eq.date;
$$;

COMMENT ON FUNCTION public.xinix_family_series(int) IS
  'Families-grafiek: per groep per handelsdag het gemiddelde rendement%. Server-side geaggregeerd (omzeilt de 10k-rijenlimiet), gefilterd op echte handelsdagen, en met artefact-guard: per-strategie-rendementen >= 300% (koers-glitch/split) tellen niet mee in het ploegengemiddelde.';

-- ── RPC 2: positieve-dagen per strategie (zelfde artefact-guard) ───────────────
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
  WHERE e.total_equity > 0
    AND (e.total_equity - COALESCE(st.initial_capital, 10000))
        / NULLIF(COALESCE(st.initial_capital, 10000), 0) * 100.0 < 300.0
  GROUP BY e.strategy_id;
$$;

COMMENT ON FUNCTION public.xinix_strategy_positive_days() IS
  'Aandeel equity-snapshots boven startkapitaal. Server-side geaggregeerd; artefact-dagen (>= 300% rendement) tellen niet mee.';

-- ── HEAL: vervuilde historische equity-rijen interpoleren ─────────────────────
-- Een artefact-rij (rendement >= 300% of equity <= 0) wordt vervangen door
-- lineaire interpolatie tussen de dichtstbijzijnde schóne dagen van diezelfde
-- strategie. Geen schone buur ervoor/erna → carry-forward/-back; helemaal geen
-- schone rij → startkapitaal. Idempotent: een geheelde rij is daarna < 300% en
-- wordt niet opnieuw aangeraakt. Niet-destructief: we vervangen onzin door de
-- best mogelijke waarheid i.p.v. te verwijderen.
CREATE OR REPLACE FUNCTION public.xinix_heal_equity_artifacts(p_cap double precision DEFAULT 300.0)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  healed int;
BEGIN
  WITH base AS (
    SELECT e.strategy_id, e.date, e.total_equity,
           COALESCE(st.initial_capital, 10000) AS initial,
           (e.total_equity > 0
            AND (e.total_equity - COALESCE(st.initial_capital, 10000))
                / NULLIF(COALESCE(st.initial_capital, 10000), 0) * 100.0 < p_cap) AS is_clean
    FROM xinix_strategy_equity e
    JOIN xinix_strategy_state st ON st.strategy_id = e.strategy_id
  ),
  art AS (SELECT * FROM base WHERE NOT is_clean),
  bounds AS (
    SELECT a.strategy_id, a.date, a.initial,
      (SELECT c.total_equity FROM base c WHERE c.is_clean AND c.strategy_id = a.strategy_id AND c.date < a.date ORDER BY c.date DESC LIMIT 1) AS prev_eq,
      (SELECT c.date         FROM base c WHERE c.is_clean AND c.strategy_id = a.strategy_id AND c.date < a.date ORDER BY c.date DESC LIMIT 1) AS prev_d,
      (SELECT c.total_equity FROM base c WHERE c.is_clean AND c.strategy_id = a.strategy_id AND c.date > a.date ORDER BY c.date ASC  LIMIT 1) AS next_eq,
      (SELECT c.date         FROM base c WHERE c.is_clean AND c.strategy_id = a.strategy_id AND c.date > a.date ORDER BY c.date ASC  LIMIT 1) AS next_d
    FROM art a
  ),
  calc AS (
    SELECT strategy_id, date,
      CASE
        WHEN prev_eq IS NOT NULL AND next_eq IS NOT NULL
          THEN prev_eq + (next_eq - prev_eq) * ((date - prev_d)::numeric / NULLIF((next_d - prev_d), 0))
        WHEN prev_eq IS NOT NULL THEN prev_eq
        WHEN next_eq IS NOT NULL THEN next_eq
        ELSE initial
      END AS new_eq
    FROM bounds
  )
  UPDATE xinix_strategy_equity e
  SET total_equity    = c.new_eq,
      cash            = LEAST(e.cash, c.new_eq),
      positions_value = GREATEST(0, c.new_eq - LEAST(e.cash, c.new_eq))
  FROM calc c
  WHERE e.strategy_id = c.strategy_id AND e.date = c.date;

  GET DIAGNOSTICS healed = ROW_COUNT;

  INSERT INTO signal_runs (job, ok, message, finished_at)
  VALUES ('xinix-heal-equity-artifacts', true,
          format('%s artefact-equity-rijen geheeld (drempel %s%%)', healed, p_cap), NOW());

  RETURN healed;
END;
$$;

COMMENT ON FUNCTION public.xinix_heal_equity_artifacts(double precision) IS
  'Vervangt koers-artefact-equity-rijen (rendement >= drempel) door interpolatie tussen schone buurdagen. Idempotent. Loopt eenmalig + dagelijks via pg_cron als vangnet.';

-- Eenmalig de bestaande vervuiling (2026-06-08 → 06-16) opruimen.
SELECT public.xinix_heal_equity_artifacts(300.0);

-- Dagelijks vangnet om 23:30 UTC (ná sim 22:05 en equity-heal 23:00). In normale
-- werking een no-op; vangt een eventueel nieuw artefact dat door de sim-guard glipt.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-artifact-heal-daily') THEN
    PERFORM cron.unschedule('xinix-artifact-heal-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'xinix-artifact-heal-daily',
  '30 23 * * *',
  $$SELECT public.xinix_heal_equity_artifacts(300.0)$$
);
