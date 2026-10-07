-- Crypto-tabblad (Favorieten → 🪙 Crypto), keuzes van de gebruiker op 2026-10-07:
--   1e  miners, schatkistbedrijven, beurzen/brokers/wallets en blockchain-techniek, elk met een eigen label
--   2abc alle DEGIRO-beurzen (VS, Canada, Japan, Hongkong, Europa, Australië), geen OTC
--   3e  alle fases, met een score die de fase laat zien; eis: minstens één keer +400% binnen een maand
--   4c  nieuws over een cryptostrategie weegt het zwaarst
--   5ad beurswaarde ≥ $20 mln, omzet ≥ $1 mln per dag, geen SPAC's
--   6d  één keer per week
--   7ac hartje = favoriet + op de watchlist, maar niet in het Potje, de papieren portefeuille en het Dagadvies
--   8b  melding bij een nieuwe kandidaat met score ≥ 80
--   10b rood CRYPTO-label in de 5-sterren-scanner en de Favorieten-tabel
-- De formule staat los van de 5-sterren-scanner en de andere lijsten.

alter table public.signal_tickers
  add column if not exists crypto_cat text check (crypto_cat in ('miner', 'treasury', 'exchange', 'tech')),
  add column if not exists no_sim boolean not null default false;
comment on column public.signal_tickers.crypto_cat is
  'Crypto-categorie (miner/treasury/exchange/tech), gezet door xinix-crypto; null = geen crypto. Geeft het rode CRYPTO-label.';
comment on column public.signal_tickers.no_sim is
  'Niet in het Potje, de papieren portefeuille en het Dagadvies (hartje in het crypto-tabblad).';

create table if not exists public.xinix_crypto_scan (
  ticker text primary key,                -- Yahoo-notatie, zoals signal_tickers
  tv_symbol text,
  market text,
  exchange text,
  name text,
  currency text,
  category text check (category in ('miner', 'treasury', 'exchange', 'tech')),
  qualifies boolean not null default false,
  reason text,                            -- waarom hij (nog) niet meedoet
  score numeric,
  best_score numeric,
  phase text,                             -- groot | uitbraak | comeback | vroeg | na_piek | rustig
  components jsonb,                       -- {nieuws, fase, explosie, omzet}
  close numeric,
  mcap_usd numeric,
  dollar_vol_usd numeric,
  perf_w numeric,
  perf_1m numeric,
  perf_3m numeric,
  perf_6m numeric,
  hi52 numeric,
  lo52 numeric,
  hi5y numeric,
  lo5y numeric,
  best_month_pct numeric,                 -- grootste stijging binnen vier weken in tien jaar, in %
  best_month_end date,
  months_400 int,                         -- aantal losse keren ≥ +400% binnen vier weken
  last_400_end date,
  history_at timestamptz,                 -- dagkoersen van tien jaar opgehaald
  news jsonb,                             -- [{title, url, publisher, at, kind}]
  news_at timestamptz,
  in_watchlist boolean,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  notified_at timestamptz
);
alter table public.xinix_crypto_scan enable row level security;
revoke all on public.xinix_crypto_scan from anon, authenticated;

-- Eén keer per week, zaterdag na de 5-sterren-scan (08:10 UTC).
select cron.schedule('xinix-crypto-scan', '25 9 * * 6', $$select public.invoke_edge('xinix-crypto?mode=scan')$$);
