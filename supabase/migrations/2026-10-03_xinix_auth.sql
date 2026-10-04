-- Inlogpagina: op een onbekend apparaat opent Xinix pas na het wachtwoord.
--
-- Stap 1 (nu): de site staat achter het inlogscherm; de gegevens via de API
-- zijn nog niet afgeschermd (stap 2 volgt later). Alleen de edge function
-- xinix-auth (service_role) komt bij deze tabellen: RLS aan, geen policies.
--
-- Het wachtwoord staat nergens, ook niet in de repo: alleen een PBKDF2-hash,
-- buiten de migraties om gezet.

create table if not exists public.xinix_auth_password (
  id int primary key default 1 check (id = 1),
  hash text not null,                       -- pbkdf2_sha256$<iteraties>$<salt b64>$<hash b64>
  updated_at timestamptz not null default now()
);

-- Een apparaat blijft bekend tot het wordt ingetrokken (of zichzelf uitlogt).
create table if not exists public.xinix_auth_devices (
  id bigserial primary key,
  token_hash text not null unique,          -- sha256 van de sleutel; de sleutel zelf staat alleen op het apparaat
  name text not null,                       -- "iPhone · Safari"
  user_agent text,
  ip text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Inlogpogingen: 3 foute vanaf één IP binnen een uur = een uur dicht.
create table if not exists public.xinix_auth_attempts (
  id bigserial primary key,
  at timestamptz not null default now(),
  ip text,
  device text,
  ok boolean not null
);
create index if not exists xinix_auth_attempts_ip_at on public.xinix_auth_attempts (ip, at desc);
create index if not exists xinix_auth_attempts_at on public.xinix_auth_attempts (at desc);

-- Herstellinks (wachtwoord vergeten/wijzigen): eenmalig, 1 uur geldig.
create table if not exists public.xinix_auth_resets (
  id bigserial primary key,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  channel text                              -- email | push
);

alter table public.xinix_auth_password enable row level security;
alter table public.xinix_auth_devices enable row level security;
alter table public.xinix_auth_attempts enable row level security;
alter table public.xinix_auth_resets enable row level security;
revoke all on public.xinix_auth_password, public.xinix_auth_devices, public.xinix_auth_attempts, public.xinix_auth_resets
  from anon, authenticated;
