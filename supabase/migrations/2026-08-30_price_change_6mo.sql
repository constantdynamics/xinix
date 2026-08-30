-- Koersverandering over ~6 maanden in de koers-samenvatting.
-- 1d/5d/22d stonden er al; 6 maanden ontbrak, terwijl de Favorieten-tab
-- die kolom wil tonen naast dag-, week- en maandverandering.
-- Gevuld door poll-prices-background (datum-gebaseerd: laatste slotkoers
-- op of vóór 182 dagen geleden, zodat dun verhandelde tickers met gaten
-- in de reeks niet veel verder terugkijken dan een half jaar).
alter table public.signal_price_summary
  add column if not exists pct_change_6mo numeric;

comment on column public.signal_price_summary.pct_change_6mo is
  'Koersverandering in % t.o.v. de laatste slotkoers van >=182 dagen geleden (~6 maanden). NULL = te korte historie.';
