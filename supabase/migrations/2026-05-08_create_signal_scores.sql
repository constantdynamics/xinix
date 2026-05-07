-- xinix v1.1 fase 1+2: scoring engine fundament + trader mode + TradeSetup
--
-- Per ticker (active in signal_tickers) wordt dagelijks één score per mode
-- (investor/trader) opgeslagen. Briefing §4.1: drie sub-scores S/C/T met
-- geometric mean confluence; risk penalty asymmetrisch afgetrokken;
-- mining krijgt cycle multiplier; action label uit thresholds.

CREATE TABLE IF NOT EXISTS public.signal_scores (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  sector TEXT NOT NULL CHECK (sector IN ('biotech','mining')),
  scan_date DATE NOT NULL,
  mode TEXT NOT NULL DEFAULT 'trader' CHECK (mode IN ('investor','trader')),

  -- Sub-scores [0..1] (raw / theoretical_max, clipped)
  structural NUMERIC(5,4),
  catalyst   NUMERIC(5,4),
  timing     NUMERIC(5,4),

  -- Aggregation
  confluence       NUMERIC(5,4),  -- geometric mean of S,C,T
  risk_penalty     NUMERIC(5,4) NOT NULL DEFAULT 0,
  cycle_multiplier NUMERIC(5,4) NOT NULL DEFAULT 1.0,
  final_score      NUMERIC(5,4),

  -- Output
  action TEXT CHECK (action IN ('STRONG_BUY','BUY','WATCH','HOLD','AVOID')),
  flagged_warnings TEXT[] NOT NULL DEFAULT '{}',

  -- Breakdown for UI
  components       JSONB,  -- {structural:[{name,weight,triggered}],catalyst:[…],timing:[…]}
  trade_setup      JSONB,  -- {entry,target,stop,rr,position_size_usd,max_hold_days,exits:[…]}
  expected_outcome JSONB,  -- fase 5: peak/T+90/baseline/exit_window

  data_completeness NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(ticker, scan_date, mode)
);

CREATE INDEX IF NOT EXISTS signal_scores_ticker_date_idx
  ON public.signal_scores (ticker, scan_date DESC);

CREATE INDEX IF NOT EXISTS signal_scores_actionable_idx
  ON public.signal_scores (scan_date DESC, final_score DESC)
  WHERE action IN ('STRONG_BUY','BUY');

ALTER TABLE public.signal_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_signal_scores"
  ON public.signal_scores
  FOR SELECT
  TO anon, authenticated
  USING (true);
