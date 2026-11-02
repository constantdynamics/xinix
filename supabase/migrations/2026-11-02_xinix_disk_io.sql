-- Disk IO (2026-11-02). Supabase meldde dat het project zijn Disk IO-budget opmaakte, en maandag
-- 2 nov. liep de database van 05:01 tot 06:38 vast (Supabase heeft hem herstart). Oorzaak: de
-- wekelijkse volledige export (xinix-full-export, maandag 05:00) schreef een JSON van ±33 MB als
-- één rij in xinix_data_exports, terwijl het budget na de zware weekendtaken al op was.
--
-- 1. De wekelijkse export staat uit (keuze gebruiker). De cronjob blijft bestaan met active = false;
--    met de hand exporteren via Instellingen kan nog.
-- 2. signal_runs (log van elke run) bewaart 30 dagen, maar altijd de 20 nieuwste runs per job:
--    xinix-evolve leest zijn vorige run terug (cyclusbewaking en stagnatie) en de kennisexport de
--    laatste 20 evoluties. Elke nacht om 03:10 UTC, na purge-cron-logs.
-- 3. Index op started_at: het dashboard leest de runs van de laatste 5 dagen over alle jobs heen
--    en deed daarvoor een seq scan over de hele tabel.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'weekly-xinix-data-export') then
    perform cron.alter_job((select jobid from cron.job where jobname = 'weekly-xinix-data-export'), active := false);
  end if;
end $$;

create index if not exists signal_runs_started_at_idx on public.signal_runs (started_at desc);

create or replace function public.xinix_purge_signal_runs()
returns integer
language sql
set search_path = ''
as $$
  with old as (
    select id from (
      select id, started_at,
             row_number() over (partition by job order by started_at desc, id desc) as rn
      from public.signal_runs
    ) r
    where r.rn > 20 and r.started_at < now() - interval '30 days'
  ), del as (
    delete from public.signal_runs s using old where s.id = old.id returning 1
  )
  select count(*)::integer from del;
$$;

revoke all on function public.xinix_purge_signal_runs() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'xinix-purge-signal-runs') then
    perform cron.unschedule('xinix-purge-signal-runs');
  end if;
  perform cron.schedule('xinix-purge-signal-runs', '10 3 * * *', 'select public.xinix_purge_signal_runs()');
end $$;
