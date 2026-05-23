-- Voegt per-tab kolominstellingen toe aan de UI-config. Per tabblad-tabel
-- bewaren we welke kolommen zichtbaar zijn en in welke volgorde ze staan,
-- zodat de keuze over devices synchroniseert (net als de tab-instellingen).
alter table public.xinix_ui_settings
  add column if not exists table_columns jsonb not null default '{}'::jsonb;

comment on column public.xinix_ui_settings.table_columns is
  'Per-tab kolominstellingen: { [tabKey]: { order: string[], hidden: string[] } }.';
