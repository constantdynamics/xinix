-- Splits bronze medals into 5-year total (existing) and last-year count.
-- The dispatch filter now uses bronze_1y so that only tickers with ≥4 bronze
-- rallies in the past 12 months pass the quality threshold — not stale history.
ALTER TABLE signal_tickers
  ADD COLUMN IF NOT EXISTS medal_bronze_1y INT NOT NULL DEFAULT 0;
