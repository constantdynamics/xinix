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

-- 2. Voorgestelde aankooplimiet: X% boven de 5-jaarsbodem, nu instelbaar.
--    Er waren twee regels naast elkaar: compute-extremes-background vult
--    automatisch 5y-low × 1,10 voor tickers zonder limiet, terwijl de
--    scan-functies sinds 2026-05-20 exact de 5y-low zetten (die scans
--    selecteren juist aandelen bij hun bodem, dus 10% erboven was daar al
--    geraakt). Deze instelling stuurt vanaf nu zowel het inlaad-paneel op
--    Favorieten als compute-extremes. Default 10 = het bestaande gedrag,
--    zodat de dagelijkse job niet stilzwijgend verandert.
alter table public.signal_settings
  add column if not exists limit_suggest_pct numeric not null default 10;

comment on column public.signal_settings.limit_suggest_pct is
  'Percentage boven de 5-jaarsbodem voor de aankooplimiet-suggestie (10 = 5y-low x 1,10). Gebruikt door het inlaad-paneel op Favorieten en door compute-extremes-background voor tickers zonder limiet. Per inlaadsessie te overrulen.';

-- 3. Breedte per tabblad: 'normaal' (1280px) / 'breed' (1800px) / 'vol'
--    (volledige schermbreedte). Leeg = de app-default (breed).
alter table public.xinix_ui_settings
  add column if not exists tab_width jsonb not null default '{}'::jsonb;

comment on column public.xinix_ui_settings.tab_width is
  'Per tab-key de gekozen paginabreedte: normaal | breed | vol. Ontbrekende tabs vallen terug op de app-default.';
