-- xinix_ui_settings: single-row config voor UI-aanpassingen (tab-volgorde,
-- hernoemde labels, verborgen tabs). Read = openbaar; write = via edge function
-- met admin-token.
create table if not exists public.xinix_ui_settings (
  id smallint primary key default 1,
  tab_order text[] not null default '{}'::text[],
  tab_labels jsonb not null default '{}'::jsonb,
  tab_hidden text[] not null default '{}'::text[],
  updated_at timestamptz not null default now(),
  constraint xinix_ui_settings_single_row check (id = 1)
);

insert into public.xinix_ui_settings (id) values (1)
  on conflict (id) do nothing;

alter table public.xinix_ui_settings enable row level security;
drop policy if exists "ui_settings_read_all" on public.xinix_ui_settings;
create policy "ui_settings_read_all" on public.xinix_ui_settings for select using (true);

comment on table public.xinix_ui_settings is
  'UI-aanpassingen voor de Xinix dashboard: tab-volgorde, hernoemde labels, verborgen tabs. Single-row config.';
