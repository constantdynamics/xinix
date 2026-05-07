-- xinix Supabase: enable RLS on tables flagged by Supabase advisor
--
-- Run this in the Supabase SQL editor (project: maikel /
-- zfcjugqgufsyltxhvkuu). Service-role keys bypass RLS automatically, so
-- the Netlify pollers + admin endpoints keep working. The policies below
-- only allow anon (public client) read access — no writes from the
-- browser. Adjust if you ever need anon writes.

ALTER TABLE public.signal_macro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_backtest_results ENABLE ROW LEVEL SECURITY;

-- Public read-only access (matches the policy already used on the other
-- signal_* tables). Skip if your app reads via a backend proxy and you
-- want to lock anon out completely.
CREATE POLICY "anon_read_signal_macro"
  ON public.signal_macro
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "anon_read_signal_backtest"
  ON public.signal_backtest_results
  FOR SELECT
  TO anon, authenticated
  USING (true);
