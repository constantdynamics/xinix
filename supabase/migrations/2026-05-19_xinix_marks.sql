-- Favorieten + gezien-status per ticker (gebruikerspersoonlijke markeringen).
-- Geen user-login: één set markeringen voor de admin-gebruiker.

create table if not exists xinix_favorites (
  ticker      text primary key,
  created_at  timestamptz not null default now()
);

create table if not exists xinix_seen (
  ticker      text primary key,
  created_at  timestamptz not null default now()
);

create index if not exists xinix_favorites_created_idx on xinix_favorites (created_at desc);
create index if not exists xinix_seen_created_idx on xinix_seen (created_at desc);
