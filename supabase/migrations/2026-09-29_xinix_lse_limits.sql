-- Aankooplimieten van Londense aandelen stonden in pond terwijl de koers in
-- pence staat (de automatische limiet is 5-jaarsbodem × 1,1, en die bodem kwam
-- uit een reeks waarin Yahoo tussen pond en pence wisselde). Een limiet 40–250×
-- onder de koers is een eenheidsfout: ×100, dan staat hij weer in pence. SHR.L
-- noteert in dollars (volgens TradingView) en blijft buiten schot.
WITH fout AS (
  SELECT t.ticker, t.buy_limit
  FROM signal_tickers t JOIN signal_price_summary s USING (ticker)
  WHERE t.active AND t.ticker ~ '\.(L|IL)$' AND t.ticker <> 'SHR.L'
    AND t.buy_limit > 0 AND s.last_close / t.buy_limit BETWEEN 40 AND 250
), log AS (
  INSERT INTO xinix_price_artifact_fix_log (kind, ticker, old_avg_price)
  SELECT 'pence-limiet', ticker, buy_limit FROM fout
  RETURNING ticker
)
UPDATE signal_tickers t SET buy_limit = round(fout.buy_limit * 100, 4)
FROM fout WHERE t.ticker = fout.ticker;
