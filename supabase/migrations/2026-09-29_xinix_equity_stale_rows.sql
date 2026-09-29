-- De equity-backfill schrijft alleen handelsdagen (dagen waarop Yahoo koersen
-- heeft). De zaterdag- en zondagrijen die de sim zelf wegschreef, bleven dus
-- staan met de cash van vóór de correcties van vandaag: een piek van +$8.700
-- op 26 en 27 september bij alle strategieën met een BMGL-nepwinst. Weg met
-- alles wat de backfill van 29 september niet opnieuw berekend heeft; de sim
-- schrijft vanaf vanavond weer gewone rijen.
DELETE FROM xinix_strategy_equity e
USING xinix_strategies s
WHERE s.id = e.strategy_id
  AND s.active
  AND e.date < '2026-09-29'
  AND (e.computed_at IS NULL OR e.computed_at < '2026-09-29 15:40:00+00');

-- Hoogste equity en maximale terugval opnieuw uit de schone reeks.
WITH e AS (
  SELECT strategy_id, total_equity,
         max(total_equity) OVER (PARTITION BY strategy_id ORDER BY date ROWS UNBOUNDED PRECEDING) AS piek
  FROM xinix_strategy_equity
), d AS (
  SELECT strategy_id, max(total_equity) AS max_eq,
         max((piek - total_equity) / nullif(piek, 0)) * 100 AS dd
  FROM e GROUP BY 1
)
UPDATE xinix_strategy_state s
SET max_equity = round(d.max_eq, 2), max_drawdown_pct = round(coalesce(d.dd, 0), 4)
FROM d WHERE s.strategy_id = d.strategy_id;
