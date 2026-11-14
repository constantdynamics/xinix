-- SUPERsprinters: een aparte omzeteis voor meldingen, en de meldgrens naar 20% (keuzes van de gebruiker,
-- 14 november 2026: "Ik volg jouw adviezen").
--
-- De lijst blijft alle aandelen met minstens $10.000 omzet per dag tonen. Een melding gaat alleen uit
-- als de omzet minstens ss_alert_min_dvol dollar per dag is: bij minder beweegt een order van een paar
-- duizend euro de koers. In de test kostte $100.000 niets aan trefkans (2025–2026: 42 van 230 = 18,3%
-- raak tegen 18,1%; 2020–2024: 18,3% tegen 18,8%). 0 zet de eis uit.
alter table public.signal_settings
  add column if not exists ss_alert_min_dvol numeric not null default 100000;

comment on column public.signal_settings.ss_alert_min_dvol is 'SUPERsprinters: minimale omzet per dag in dollars voor een melding (0 = geen eis). De lijst zelf begint bij $10.000.';

-- Meldgrens van 15 naar 20%: ongeveer één melding per week in plaats van drie, en in beide testperioden
-- ongeveer 24% raak in plaats van 18%.
update public.signal_settings set ss_alert_min_prob = 20 where id = 1 and ss_alert_min_prob = 15;
