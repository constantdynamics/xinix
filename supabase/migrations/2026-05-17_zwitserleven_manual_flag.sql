-- Voeg is_manual kolom toe aan zwitserleven_stocks zodat handmatig
-- toegevoegde aandelen (die niet aan alle criteria voldoen) zichtbaar
-- blijven in het standaardfilter "Voldoet aan criteria".
alter table public.zwitserleven_stocks
  add column if not exists is_manual boolean not null default false;

comment on column public.zwitserleven_stocks.is_manual is
  'true = handmatig toegevoegd via de UI, blijft zichtbaar ook zonder meets_criteria';

create index if not exists zwitserleven_stocks_is_manual_idx
  on public.zwitserleven_stocks (is_manual) where is_manual = true;
