-- xinix_data_exports — bewaart de laatste volledige data-export zodat hij via
-- het dashboard te downloaden is. Singleton (id = 1), wekelijks overschreven
-- door de xinix-full-export edge function. De Git-repo (docs/data-export/)
-- bewaart de historische versies via de git-historie.

create table if not exists xinix_data_exports (
  id               integer primary key default 1,
  exported_at      timestamptz not null default now(),
  table_count      integer,
  total_rows       integer,
  row_counts       jsonb,
  github_committed boolean not null default false,
  export_data      jsonb,
  constraint xinix_data_exports_singleton check (id = 1)
);

-- Alleen de edge function (service role) raakt deze tabel aan — RLS aan, geen policies.
alter table xinix_data_exports enable row level security;

-- Wekelijkse volledige export: elke maandag 05:00 UTC.
select cron.schedule(
  'weekly-xinix-data-export',
  '0 5 * * 1',
  $$select invoke_edge('xinix-full-export')$$
);
