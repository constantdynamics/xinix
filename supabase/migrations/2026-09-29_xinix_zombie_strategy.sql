-- Strategie bio_h30_x (id 1674) staat sinds mei actief in de database, maar
-- bestaat niet in STRATEGIES van xinix-sim-background. De sim sloeg hem dus
-- elke avond over: 8 posities met een tijdvenster van 30 dagen stonden sinds
-- juni open, zonder stop of verkoop, en telden gewoon mee in de ranglijst.
-- Sluiten op de huidige slotkoers en met pensioen.
--
-- LITM (patient_mining) heeft geen koers meer: de ticker staat niet meer in de
-- watchlist, dus de sim kan hem nooit sluiten. Sluiten op de instapkoers.

WITH t AS (
  SELECT p.id, p.strategy_id, p.ticker, p.qty, p.avg_price, p.entry_date,
         CASE WHEN p.ticker = 'LITM' THEN p.avg_price ELSE s.last_close END AS px
  FROM xinix_strategy_positions p
  LEFT JOIN signal_price_summary s USING (ticker)
  WHERE p.closed_at IS NULL AND (p.strategy_id = 1674 OR p.ticker = 'LITM')
), log AS (
  INSERT INTO xinix_price_artifact_fix_log
    (kind, ref_id, strategy_id, ticker, old_qty, old_avg_price, old_closed_price, old_return_usd, old_return_pct, old_cash)
  SELECT 'zombie', t.id, t.strategy_id, t.ticker, t.qty, t.avg_price, NULL, NULL, NULL, st.cash
  FROM t JOIN xinix_strategy_state st USING (strategy_id)
  RETURNING ref_id
), upd AS (
  UPDATE xinix_strategy_positions sp SET
    closed_at = now(),
    closed_price = t.px,
    closed_reason = CASE WHEN t.ticker = 'LITM'
      THEN 'Geen koers meer (niet meer in de watchlist) — gesloten op instap'
      ELSE 'Strategie bestaat niet meer in de sim — gesloten op slotkoers' END,
    return_usd = round(t.qty * t.px * 0.999 - t.qty * t.avg_price * 1.001, 4),
    return_pct = round((t.qty * t.px * 0.999 - t.qty * t.avg_price * 1.001) / (t.qty * t.avg_price * 1.001) * 100, 4),
    hold_days = greatest(0, (now()::date - t.entry_date::date))
  FROM t WHERE sp.id = t.id
  RETURNING sp.id
)
UPDATE xinix_strategy_state st SET cash = st.cash + x.opbrengst
FROM (SELECT strategy_id, sum(qty * px * 0.999) AS opbrengst FROM t GROUP BY 1) x
WHERE st.strategy_id = x.strategy_id;

UPDATE xinix_strategies SET active = false, retired_at = now() WHERE id = 1674 AND slug = 'bio_h30_x';
