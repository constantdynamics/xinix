-- AI als vierde sector, een instelbare limiet-suggestie en een breedte-keuze
-- per tabblad.
--
-- 1. sector='ai' — AI/semiconductor-aandelen zijn geen biotech en geen mining,
--    maar wél een eigen groep die je apart wilt kunnen filteren. Net als
--    'other' worden ze niet gescoord (de scoring-gewichten kennen alleen
--    biotech en mining) en niet gebrieft (poll-briefing filtert op
--    sector in ('biotech','mining')).
alter table public.signal_tickers drop constraint if exists signal_tickers_sector_chk;
alter table public.signal_tickers add constraint signal_tickers_sector_chk
  check (sector = any (array['biotech'::text, 'mining'::text, 'other'::text, 'ai'::text]));

alter table public.signal_scores drop constraint if exists signal_scores_sector_check;
alter table public.signal_scores add constraint signal_scores_sector_check
  check (sector = any (array['biotech'::text, 'mining'::text, 'other'::text, 'ai'::text]));

-- Nieuwe ai-tickers hoeven niet door de biotech-briefing heen.
update public.signal_tickers set briefing_status = 'not_applicable'
 where sector = 'ai' and (briefing_status is null or briefing_status = 'pending');

-- 2. Voorgestelde aankooplimiet bij het inladen: X% boven de 5-jaarsbodem.
--    Tot nu toe was dit hardcoded in de scan-functies (eerst 5y-low × 1,10,
--    sinds 2026-05-20 exact de 5y-low). Nu instelbaar, met 5% als standaard.
alter table public.signal_settings
  add column if not exists limit_suggest_pct numeric not null default 5;

comment on column public.signal_settings.limit_suggest_pct is
  'Standaard-suggestie voor de aankooplimiet bij het inladen van aandelen: percentage boven de 5-jaarsbodem (5 = 5y-low x 1,05). Per inlaadsessie te overrulen.';

-- 3. Breedte per tabblad: 'normaal' (1280px) / 'breed' (1800px) / 'vol'
--    (volledige schermbreedte). Leeg = de app-default (breed).
alter table public.xinix_ui_settings
  add column if not exists tab_width jsonb not null default '{}'::jsonb;

comment on column public.xinix_ui_settings.tab_width is
  'Per tab-key de gekozen paginabreedte: normaal | breed | vol. Ontbrekende tabs vallen terug op de app-default.';
