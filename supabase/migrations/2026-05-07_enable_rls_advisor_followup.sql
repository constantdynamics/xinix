-- Briefing audit followup: RLS was uit op signal_macro + signal_backtest_results.
-- Service-role schrijft (pollers / scoring) en bypasst RLS hoe dan ook.
-- Anon krijgt read-only access zodat de UI macro/backtest data kan tonen.

ALTER TABLE public.signal_macro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_backtest_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_signal_macro"
  ON public.signal_macro FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "anon_read_signal_backtest_results"
  ON public.signal_backtest_results FOR SELECT
  TO anon, authenticated
  USING (true);
