-- GIN full-text index op bedrijfsnaam voor snelle ticker-zoekfunctie.
-- Zoekopdrachten over 3700+ tickers gaan van O(n) naar O(log n).
CREATE INDEX IF NOT EXISTS signal_tickers_company_gin
  ON signal_tickers
  USING gin(to_tsvector('simple', coalesce(company, '')));

-- Btree index op sector voor filterqueries (bijv. sector='biotech').
CREATE INDEX IF NOT EXISTS signal_tickers_sector_idx
  ON signal_tickers (sector)
  WHERE sector IS NOT NULL;

-- Btree index op score voor gesorteerde queries (dashboard ranking).
CREATE INDEX IF NOT EXISTS signal_tickers_score_idx
  ON signal_tickers (score DESC NULLS LAST)
  WHERE score IS NOT NULL;
