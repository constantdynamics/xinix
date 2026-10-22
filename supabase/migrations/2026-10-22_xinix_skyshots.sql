-- Skyshots (Favorieten → 🌠 Skyshots), keuzes van de gebruiker op 2026-10-22:
--   1a    skyshot = de hoogste koers van een handelsdag ligt minstens +80% boven het slot van de handelsdag ervoor
--   2a    de stijging moet uit minstens 10 koersstapjes bestaan (geen Martello-sprongen van één tik)
--   3abce dagen zonder handel en sprongen ≥ 40× (eenheidsfouten) tellen nooit; het volume moet minstens 2× de
--         mediaan van de 20 handelsdagen ervoor zijn; TradingView moet dezelfde stijging laten zien; knop "telt niet"
--   4a    elke dag telt apart
--   6d    één keer per week (zaterdag)
--   7a    geen pushmelding
--   8abd  12 maanden, plus kolommen voor 3 jaar en 3 maanden
--   9abc  standaard +80%, in het tabblad 50/80/100/200%, plus kolommen ≥ +100% en ≥ +200%
--   10ab  los van alle andere scores, plus een kolom in de favorietenlijst
-- Niet alleen aandelen met een hartje: de hele actieve watchlist, met een filter in het tabblad.

create table if not exists public.xinix_skyshots (
  ticker text not null,                   -- Yahoo-notatie, zoals signal_tickers
  day date not null,                      -- handelsdag in de tijdzone van de beurs
  prev_close numeric not null,
  open numeric,
  high numeric not null,
  low numeric,
  close numeric not null,
  volume numeric,
  pct numeric not null,                   -- (hoogste / slot dag ervoor − 1) × 100, volgens Yahoo
  close_pct numeric,                      -- slot t.o.v. het slot ervoor, in %
  ticks numeric,                          -- de stijging in koersstapjes
  vol_ratio numeric,                      -- volume ÷ mediaan van de 20 handelsdagen ervoor (null = mediaan 0)
  tv_pct numeric,                         -- dezelfde stijging volgens TradingView
  tv_status text check (tv_status in ('ok', 'afwijkend', 'onbekend')),
  reason text check (reason in ('eenheid', 'geen_handel', 'tick', 'volume', 'tradingview')), -- null = telt mee
  after_1d numeric,                       -- slot 1, 5 en 20 handelsdagen later t.o.v. het slot van de skyshot-dag, in %
  after_5d numeric,
  after_20d numeric,
  rejected_at timestamptz,                -- door de gebruiker afgekeurd ("telt niet")
  updated_at timestamptz not null default now(),
  primary key (ticker, day)
);
comment on table public.xinix_skyshots is
  'Skyshots: handelsdagen waarop de hoogste koers ≥ +50% boven het vorige slot lag (het tabblad kiest de drempel). Gevuld door xinix-skyshots.';

create table if not exists public.xinix_skyshot_tickers (
  ticker text primary key,
  tv_symbol text,                         -- waarmee TradingView de dagkoersen gaf
  currency text,
  bars int,                               -- aantal dagkoersen van Yahoo
  first_day date,
  candidates int,                         -- dagen ≥ +50%, ook de afgevallen
  scanned_at timestamptz,
  claimed_at timestamptz,                 -- in behandeling bij een run (verloopt na 10 minuten)
  tries int not null default 0,           -- mislukte pogingen deze week (TradingView of Yahoo onbereikbaar)
  error text
);

alter table public.xinix_skyshots enable row level security;
alter table public.xinix_skyshot_tickers enable row level security;
revoke all on public.xinix_skyshots from anon, authenticated;
revoke all on public.xinix_skyshot_tickers from anon, authenticated;

-- Geeft een portie aandelen die deze week nog niet gemeten zijn (favorieten eerst) en zet ze op
-- "in behandeling", zodat twee runs tegelijk elkaar niet in de weg zitten.
create or replace function public.xinix_skyshot_claim(p_n int, p_since timestamptz)
returns table (claimed_ticker text, is_favorite boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform pg_advisory_xact_lock(hashtext('xinix_skyshot_claim'));
  return query
  with pool as (
    select t.ticker as tk, exists (select 1 from xinix_favorites f where f.ticker = t.ticker) as fav
    from signal_tickers t
    where t.active or exists (select 1 from xinix_favorites f where f.ticker = t.ticker)
  ), due as (
    select p.tk, p.fav
    from pool p
    left join xinix_skyshot_tickers s on s.ticker = p.tk
    where (s.scanned_at is null or s.scanned_at < p_since)
      and (s.claimed_at is null or s.claimed_at < now() - interval '10 minutes')
    order by p.fav desc, s.scanned_at nulls first, p.tk
    limit greatest(p_n, 0)
  ), claimed as (
    insert into xinix_skyshot_tickers as s (ticker, claimed_at)
    select d.tk, now() from due d
    on conflict (ticker) do update set claimed_at = excluded.claimed_at
    returning s.ticker
  )
  select d.tk, d.fav from due d where d.tk in (select c.ticker from claimed c);
end;
$$;
revoke all on function public.xinix_skyshot_claim(int, timestamptz) from public, anon, authenticated;
grant execute on function public.xinix_skyshot_claim(int, timestamptz) to service_role;

-- Elke zaterdag van 06:00 tot 10:50 UTC elke 10 minuten een portie van ~100 aandelen
-- (≈ 2.600 aandelen op de watchlist past ruim in die 30 runs).
select cron.schedule('xinix-skyshots-weekly', '*/10 6-10 * * 6', $$select public.invoke_edge('xinix-skyshots?mode=scan')$$);
