-- xinix_knowledge_exports: maandelijkse snapshots van alle strategie-kennis,
-- watchlist-stand en positie-inzichten voor cumulatieve kennisopbouw over de tijd.

CREATE TABLE IF NOT EXISTS xinix_knowledge_exports (
  id             SERIAL PRIMARY KEY,
  exported_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_start   TIMESTAMPTZ,
  period_end     TIMESTAMPTZ,
  type           TEXT NOT NULL DEFAULT 'manual',   -- 'monthly_auto' | 'manual' | 'reminder'
  -- Samenvatting (altijd aanwezig, ook voor reminder-entries)
  strategy_count        INTEGER,
  ticker_count          INTEGER,
  closed_positions_count INTEGER,
  open_positions_count  INTEGER,
  best_strategy_name    TEXT,
  best_strategy_return  NUMERIC(10,4),
  worst_strategy_name   TEXT,
  worst_strategy_return NUMERIC(10,4),
  avg_portfolio_return  NUMERIC(10,4),
  strategies_in_profit  INTEGER,
  evolution_cycles      INTEGER,
  -- Volledige JSON-snapshot (null bij 'reminder')
  export_data    JSONB,
  -- Mensleesbare markdown samenvatting
  summary        TEXT
);

CREATE INDEX IF NOT EXISTS idx_xinix_knowledge_exports_at
  ON xinix_knowledge_exports (exported_at DESC);

-- ── Maandelijkse auto-export: elke 1e van de maand om 06:00 UTC ──────────────
SELECT cron.schedule(
  'monthly-xinix-knowledge-export',
  '0 6 1 * *',
  $$SELECT invoke_edge('xinix-knowledge-export')$$
);

-- ── Maandelijkse herinnering: 25e van de maand om 08:00 UTC ──────────────────
-- Stuurt een notificatie: "export over 6 dagen — download de huidige stand"
SELECT cron.schedule(
  'monthly-xinix-knowledge-reminder',
  '0 8 25 * *',
  $$SELECT invoke_edge('xinix-knowledge-reminder')$$
);
