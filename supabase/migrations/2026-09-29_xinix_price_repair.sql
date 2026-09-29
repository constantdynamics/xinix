-- Eenmalige opschoning van koers-artefacten in het Potje (29 september).
-- Alle oude waarden staan in xinix_split_adjustments (splits) of
-- xinix_price_artifact_fix_log (de rest), zodat alles terug te draaien is.

-- ── 1. Reverse splits ────────────────────────────────────────────────────────
-- ENLV (1:15 op 9 juli) viel daarna ~90%: posities die in augustus en
-- september sloten staan op een koers die toevallig dicht bij de oude ligt,
-- zodat de algemene regel ze niet als "ná de split" herkent. Hier expliciet.
WITH t AS (
  SELECT id, strategy_id, qty, avg_price, return_usd, return_pct,
         qty * closed_price * 0.999 * (1.0 / 15 - 1) AS delta
  FROM xinix_strategy_positions
  WHERE ticker = 'ENLV' AND entry_date::date < '2026-07-09' AND closed_at::date >= '2026-07-09'
    AND coalesce(closed_reason, '') NOT LIKE '%artefact%'
), log AS (
  INSERT INTO xinix_split_adjustments
    (ticker, split_date, kind, position_id, strategy_id, factor, old_qty, old_avg_price, old_return_usd, old_return_pct, cash_delta)
  SELECT 'ENLV', '2026-07-09', 'sim', id, strategy_id, 15, qty, avg_price, return_usd, return_pct, delta FROM t
  RETURNING position_id
), upd AS (
  UPDATE xinix_strategy_positions sp SET
    qty = sp.qty / 15, avg_price = sp.avg_price * 15,
    stop_loss_price = sp.stop_loss_price * 15, take_profit_price = sp.take_profit_price * 15,
    return_usd = sp.return_usd + t.delta,
    return_pct = (sp.return_usd + t.delta) / (sp.qty * sp.avg_price * 1.001) * 100
  FROM t WHERE sp.id = t.id
  RETURNING sp.id
)
UPDATE xinix_strategy_state st SET cash = st.cash + x.delta
FROM (SELECT strategy_id, sum(delta) AS delta FROM t GROUP BY 1) x
WHERE st.strategy_id = x.strategy_id;

-- De rest doet xinix_apply_splits(): BMGL (gesloten 23 sept. op de nieuwe
-- koers; de sluitingen van 22 juni en 7 juli stonden nog op de oude en blijven),
-- en de open posities in AEHL, NFE en CIIT. NFE werd op de splitdag zelf gekocht
-- op de oude koers; ref_close is de eerste koers na de split.
INSERT INTO xinix_splits (ticker, split_date, numerator, denominator, ref_close, source, note) VALUES
  ('ENLV', '2026-07-09', 1, 15, NULL,  'handmatig', 'reverse split 1:15'),
  ('BMGL', '2026-06-22', 1, 12, NULL,  'handmatig', 'reverse split 1:12'),
  ('AEHL', '2026-08-10', 1, 16, NULL,  'handmatig', 'reverse split 1:16'),
  ('NFE',  '2026-09-14', 1, 50, 12.77, 'handmatig', 'reverse split 1:50'),
  ('CIIT', '2026-07-20', 1, 10, NULL,  'handmatig', 'reverse split 1:10')
ON CONFLICT (ticker, split_date) DO NOTHING;
SELECT public.xinix_apply_splits();

-- ── 2. Londen: pence/pond ───────────────────────────────────────────────────
-- Yahoo wisselt per opvraging tussen pence en pond. Voortaan staat alles in
-- pence (zoals TradingView en DEGIRO); deze posities en koersen stonden in pond.
INSERT INTO xinix_price_artifact_fix_log
  (kind, ref_id, strategy_id, ticker, old_qty, old_avg_price, old_closed_price, old_return_usd, old_return_pct)
SELECT 'pence', id, strategy_id, ticker, qty, avg_price, closed_price, return_usd, return_pct
FROM xinix_strategy_positions
WHERE (ticker IN ('FADL.L', 'FKE.L', 'KCR.L', 'MII.L', 'SAVE.L') OR (ticker = 'VOX.L' AND avg_price < 0.01))
  AND coalesce(closed_reason, '') NOT LIKE '%artefact%';

UPDATE xinix_strategy_positions SET
  qty = qty / 100, avg_price = avg_price * 100, closed_price = closed_price * 100,
  stop_loss_price = stop_loss_price * 100, take_profit_price = take_profit_price * 100,
  partial_exits = (SELECT coalesce(jsonb_agg(e || jsonb_build_object('qty_sold', (e->>'qty_sold')::numeric / 100)), '[]'::jsonb)
                   FROM jsonb_array_elements(partial_exits) e)
WHERE (ticker IN ('FADL.L', 'FKE.L', 'KCR.L', 'MII.L', 'SAVE.L') OR (ticker = 'VOX.L' AND avg_price < 0.01))
  AND coalesce(closed_reason, '') NOT LIKE '%artefact%';

INSERT INTO xinix_price_artifact_fix_log
  (kind, ref_id, ticker, old_qty, old_avg_price, old_closed_price, old_return_usd, old_return_pct)
SELECT 'pence-paper', id, ticker, qty, avg_price, closed_price, return_usd, return_pct
FROM xinix_paper_positions WHERE ticker IN ('FADL.L', 'FKE.L', 'KCR.L', 'MII.L', 'SAVE.L');

UPDATE xinix_paper_positions SET
  qty = qty / 100, avg_price = avg_price * 100, closed_price = closed_price * 100,
  stop_loss_price = stop_loss_price * 100,
  partial_exits = (SELECT coalesce(jsonb_agg(e || jsonb_build_object('qty_sold', (e->>'qty_sold')::numeric / 100)), '[]'::jsonb)
                   FROM jsonb_array_elements(partial_exits) e)
WHERE ticker IN ('FADL.L', 'FKE.L', 'KCR.L', 'MII.L', 'SAVE.L');

-- VOX.L: acht posities gekocht op 0,175 (pence) en verkocht op 0,00175 (pond)
-- — geen −99%, maar ±0%. Slotkoers naar pence, opbrengst en cash mee.
WITH t AS (
  SELECT id, strategy_id, qty, avg_price, closed_price, return_usd, return_pct,
         qty * closed_price * 0.999 * 99 AS delta
  FROM xinix_strategy_positions
  WHERE ticker = 'VOX.L' AND avg_price >= 0.1 AND closed_price < 0.01 AND closed_at IS NOT NULL
), log AS (
  INSERT INTO xinix_price_artifact_fix_log
    (kind, ref_id, strategy_id, ticker, old_qty, old_avg_price, old_closed_price, old_return_usd, old_return_pct, old_cash)
  SELECT 'pence-slotkoers', t.id, t.strategy_id, 'VOX.L', t.qty, t.avg_price, t.closed_price, t.return_usd, t.return_pct, st.cash
  FROM t JOIN xinix_strategy_state st USING (strategy_id)
  RETURNING ref_id
), upd AS (
  UPDATE xinix_strategy_positions sp SET
    closed_price = sp.closed_price * 100,
    return_usd = sp.return_usd + t.delta,
    return_pct = (sp.return_usd + t.delta) / (sp.qty * sp.avg_price * 1.001) * 100
  FROM t WHERE sp.id = t.id
  RETURNING sp.id
)
UPDATE xinix_strategy_state st SET cash = st.cash + x.delta
FROM (SELECT strategy_id, sum(delta) AS delta FROM t GROUP BY 1) x
WHERE st.strategy_id = x.strategy_id;

-- Opgeslagen koersen die nog in pond stonden (TradingView als ijkpunt: FADL.L
-- en TNE.L; MII.L en SAVE.L aan de hand van hun eigen pence-uitschieters).
INSERT INTO xinix_price_artifact_fix_log (kind, ticker, old_closed_price)
SELECT 'pence-koers', ticker, last_close FROM signal_price_summary
WHERE ticker IN ('FADL.L', 'TNE.L', 'MII.L', 'SAVE.L');
UPDATE signal_price_summary SET last_close = last_close * 100
WHERE ticker IN ('FADL.L', 'TNE.L', 'MII.L', 'SAVE.L');

-- 5-jaarsbodem, -top en medailles van alle Londense aandelen opnieuw laten
-- berekenen, nu met de eenheidscorrectie in compute-extremes.
UPDATE signal_price_summary SET last_extremes_at = NULL WHERE ticker ~ '\.(L|IL|JO|TA)$';

-- ── 3. Eerder geneutraliseerde artefact-trades ──────────────────────────────
-- Op 16 juni op 0% gezet, maar met de glitch-slotkoers laten staan. De
-- equity-backfill rekent vanuit de slotkoers en zag daardoor +9.000%. Slotkoers
-- op break-even, zodat alles weer bij het rendement van 0 past. VOX.L gaat
-- daarbij ook naar pence.
INSERT INTO xinix_price_artifact_fix_log
  (kind, ref_id, strategy_id, ticker, old_qty, old_avg_price, old_closed_price, old_return_usd, old_return_pct)
SELECT 'break-even', id, strategy_id, ticker, qty, avg_price, closed_price, return_usd, return_pct
FROM xinix_strategy_positions WHERE closed_reason LIKE '%artefact%';

UPDATE xinix_strategy_positions SET
  qty = qty / 100, avg_price = avg_price * 100,
  stop_loss_price = stop_loss_price * 100, take_profit_price = take_profit_price * 100
WHERE closed_reason LIKE '%artefact%' AND ticker = 'VOX.L' AND avg_price < 0.01;

UPDATE xinix_strategy_positions SET closed_price = round(avg_price * 1.001 / 0.999, 6)
WHERE closed_reason LIKE '%artefact%' AND coalesce(return_usd, 0) = 0;

-- ── 4. SDEV: dividend-artefact ──────────────────────────────────────────────
-- De sim telt bij verkoop een geschat dividend (yield × looptijd) bij het
-- rendement op. SDEV had tijdelijk een absurde yield, waardoor stop-loss-trades
-- van −15% als +40% te boek staan. De cash kreeg dat dividend nooit; alleen het
-- rendement klopt niet.
WITH t AS (
  SELECT id, strategy_id, ticker, qty, avg_price, closed_price, return_usd, return_pct,
    coalesce((SELECT sum((e->>'net_proceeds')::numeric) FROM jsonb_array_elements(partial_exits) e), 0)
      + qty * closed_price * 0.999
      - (qty + coalesce((SELECT sum((e->>'qty_sold')::numeric) FROM jsonb_array_elements(partial_exits) e), 0)) * avg_price * 1.001 AS herberekend,
    (qty + coalesce((SELECT sum((e->>'qty_sold')::numeric) FROM jsonb_array_elements(partial_exits) e), 0)) * avg_price * 1.001 AS kost
  FROM xinix_strategy_positions
  WHERE ticker = 'SDEV' AND closed_at IS NOT NULL
), fout AS (SELECT * FROM t WHERE return_usd - herberekend > 0.10 * kost), log AS (
  INSERT INTO xinix_price_artifact_fix_log
    (kind, ref_id, strategy_id, ticker, old_qty, old_avg_price, old_closed_price, old_return_usd, old_return_pct)
  SELECT 'dividend', id, strategy_id, ticker, qty, avg_price, closed_price, return_usd, return_pct FROM fout
  RETURNING ref_id
)
UPDATE xinix_strategy_positions sp SET
  return_usd = round(fout.herberekend, 4),
  return_pct = round(fout.herberekend / fout.kost * 100, 4)
FROM fout WHERE sp.id = fout.id;

-- Yields boven 30% zijn eenheidsfouten (dividend in pence, koers in pond) of
-- eenmalige uitkeringen; poll-prices weert ze voortaan ook.
UPDATE signal_tickers SET dividend_yield = 0 WHERE dividend_yield > 0.30;

-- ── 5. Vlaggen ──────────────────────────────────────────────────────────────
UPDATE xinix_price_flags SET resolved = true, note = 'opgeschoond 2026-09-29 (pence/pond of verouderde vlag)'
WHERE ticker IN ('FADL.L', 'FKE.L', 'KCR.L', 'MII.L', 'VOX.L', 'BTAI') AND NOT coalesce(resolved, false);
