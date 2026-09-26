-- Tijdelijk lijstje: de 100 aandelen die de explosie-motor op 25 september
-- automatisch aan de watchlist toevoegde. De motor draait sinds 26 september
-- alleen nog voor ≥4★, dus ze zijn (op 8 met een open sim-positie na) op
-- inactief gezet. Hier blijven ze zichtbaar tot de gebruiker per aandeel
-- beslist: terug naar de watchlist, of van de lijst af.
CREATE TABLE IF NOT EXISTS public.xinix_temp_list (
  ticker      text PRIMARY KEY,
  list        text NOT NULL DEFAULT 'motor-2026-09-25',
  added_at    timestamptz NOT NULL DEFAULT now(),
  reason      text,
  company     text,
  exchange    text,
  sector      text,
  market      text,
  close_at_add numeric,
  close_date  date
);
ALTER TABLE public.xinix_temp_list ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xinix_temp_list FROM anon, authenticated;

INSERT INTO public.xinix_temp_list (ticker, added_at, reason, company, exchange, sector, market, close_at_add, close_date)
SELECT t.ticker,
       coalesce(u.added_at, t.created_at, now()),
       coalesce(u.add_reason, regexp_replace(t.notes, '^Auto-toegevoegd door de explosie-motor \([0-9-]+\): ([^.]*)\..*$', '\1')),
       t.company, t.exchange, t.sector, u.market,
       coalesce(ps.last_close, u.close),
       ps.updated_at::date
FROM public.signal_tickers t
LEFT JOIN public.xinix_universe u ON u.ticker = t.ticker
LEFT JOIN public.signal_price_summary ps ON ps.ticker = t.ticker
WHERE t.notes LIKE 'Auto-toegevoegd door de explosie-motor%'
ON CONFLICT (ticker) DO NOTHING;
