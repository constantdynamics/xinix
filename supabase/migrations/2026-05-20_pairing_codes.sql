-- Kortlevende koppelcodes om een tweede apparaat (telefoon) veilig aan
-- het account te koppelen zonder het admin-token over te typen.
-- De code wordt op de laptop gegenereerd, is 5 minuten geldig en
-- eenmalig inwisselbaar via de `pair` edge function.

create table if not exists xinix_pairing_codes (
  code        text primary key,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists xinix_pairing_codes_expires_idx
  on xinix_pairing_codes (expires_at);

-- Geen enkele client mag deze tabel direct lezen of schrijven — alleen de
-- `pair` edge function (service role) raakt 'm aan. RLS aan, geen policies.
alter table xinix_pairing_codes enable row level security;
