-- SUPERsprinters: twee eisen van de gebruiker aan de lijst (16 november 2026).
-- Onderzoek en keuzes: docs/supersprinters-rapport.md, hoofdstuk 15.
--
-- 1. Geen aandelen die korter dan twee jaar genoteerd zijn. De leeftijd telt vanaf de beursgang of de
--    overstap naar de huidige beurs (keuze 1b); kent TradingView die datum niet (±6% van de aandelen),
--    dan vanaf de eerste koers. Instelbaar: signal_settings.ss_min_age_years (0 = uit).
-- 2. Geen aandelen waarvan het slot boven 95% van hun hoogste koers ooit ligt (gecorrigeerd voor splits).
--    Instelbaar: signal_settings.ss_max_top_pct (0 = uit).
--
-- Zulke aandelen komen niet in de lijst, krijgen geen melding en worden niet vastgelegd in het track record
-- (keuze 2a). Het model en het marktklimaat rekenen nog steeds met de hele markt: de eisen gelden pas bij
-- het kiezen van de kopgroep. Er wordt niets gewist; bestaande voorspellingen worden gewoon afgerekend.

alter table public.signal_settings
  add column if not exists ss_min_age_years numeric not null default 2,
  add column if not exists ss_max_top_pct numeric not null default 95;
comment on column public.signal_settings.ss_min_age_years is 'SUPERsprinters: niet in de lijst als het aandeel korter dan zoveel jaar genoteerd is, gerekend vanaf de beursgang of de overstap naar de huidige beurs (0 = uit).';
comment on column public.signal_settings.ss_max_top_pct is 'SUPERsprinters: niet in de lijst als het slot boven zoveel procent van de hoogste koers ooit ligt (0 = uit).';

-- Per aandeel in de lijst: vanaf wanneer de leeftijd telt en waar het slot staat ten opzichte van de top.
-- Het tabblad toont ze, en het meldmoment en het tabblad passen de eisen er ook op toe, zodat een
-- aangescherpte instelling meteen geldt en niet pas na de volgende ronde.
alter table public.xinix_ss_scores
  add column if not exists listed_since date,
  add column if not exists top_pct numeric;
comment on column public.xinix_ss_scores.listed_since is 'Vanaf wanneer de leeftijd telt: de beursgang of de overstap naar de huidige beurs volgens TradingView, anders de eerste koers.';
comment on column public.xinix_ss_scores.top_pct is 'Slot als percentage van de hoogste koers ooit (gecorrigeerd voor splits).';
