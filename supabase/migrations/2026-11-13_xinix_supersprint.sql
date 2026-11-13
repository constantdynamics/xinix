-- SUPERsprinters (Favorieten → SUPERsprinters): aandelen op de Saxo-beurzen die binnen 10 handelsdagen
-- +50% kunnen maken. Edge function xinix-supersprint, model in public/ss-model.json.
--
-- Zuinig ontwerp (de database draait op Micro-compute, zie 2026-11-02_xinix_disk_io.sql):
--   * de hele markt (±20.000 aandelen) wordt in het geheugen van de functie gescoord; alleen de
--     kopgroep per ronde (hoogstens 100 aandelen) wordt weggeschreven, in één opdracht;
--   * er is geen index op kolommen die elke dag veranderen, zodat bijwerken op dezelfde pagina kan;
--   * niets wordt gewist: scores worden per aandeel overschreven, het track record groeit met
--     hoogstens 300 kleine rijen per handelsdag;
--   * een dagbudget (xinix_ss_budget) dat de functie zelf bewaakt, een schakelaar (ss_enabled) en een
--     rem die na drie mislukte runs een etmaal pauzeert (xinix_ss_state, sleutel 'brake').

alter table public.signal_settings
  add column if not exists ss_enabled boolean not null default true,
  add column if not exists ss_alerts boolean not null default false,
  add column if not exists ss_alert_min_prob numeric not null default 15,
  add column if not exists ss_alert_max_per_week integer not null default 3,
  add column if not exists ss_override_min_prob numeric not null default 15;

comment on column public.signal_settings.ss_enabled is 'SUPERsprinters: false zet alle runs uit (het tabblad blijft leesbaar).';
comment on column public.signal_settings.ss_alerts is 'SUPERsprinters: meldingen aan/uit. Staat dit aan, dan hoort sprint_alert_min_prob op 0 (Sprinters meldt dan niet).';

-- Stand per aandeel: alleen de kopgroep van de laatste ronde van zijn regio is actueel (session_date).
create table if not exists public.xinix_ss_scores (
  ticker text primary key,
  tv_symbol text,
  market text not null,
  region smallint not null,              -- 0 = VS, 1 = Canada, 2 = Europa, 3 = Azië-Pacific
  exchange text,
  name text,
  currency text,
  sector text,
  close numeric,                         -- slotkoers in de noteringsmunt
  close_usd numeric,
  change_1d numeric,
  perf_1m numeric,
  vol_m numeric,                         -- gemiddelde dagbeweging (hoog/laag) over een maand, in %
  rel_vol numeric,                       -- volume t.o.v. het gemiddelde van 10 dagen
  dvol_usd numeric,                      -- omzet per dag: slot × gemiddeld volume (30 dagen)
  mcap_usd numeric,
  float_shares numeric,
  prob numeric(5,2) not null,            -- kans in %, na ijking, bijsturing en demping
  prob_base numeric(5,2),                -- kans in % vóór de bijsturing met het eigen track record
  raw real,                              -- modeluitkomst (0–1): bepaalt de volgorde
  rank smallint,                         -- plaats binnen de ronde
  reasons jsonb,                         -- hoogstens 5 × {g, label, f, t}
  news jsonb,                            -- hoogstens 3 × {t, u, p, d, g}
  news_at timestamptz,
  session_date date not null,
  scored_at timestamptz not null default now(),
  first_seen date,
  alerted_at timestamptz,
  alerted_prob numeric(5,2),
  alert_pending boolean not null default false,   -- melding wacht tot na de stille uren
  alert_note text
) with (fillfactor = 80);

-- Track record: per aandeel per handelsdag de kans en de instapkoers; bij een melding ook de kans en
-- koers van dat moment (bij Sprinters ontbrak dat: daar telt de eerste run van de dag).
create table if not exists public.xinix_ss_predictions (
  ticker text not null,
  made_on date not null,                 -- sessiedatum in de tijdzone van de beurs
  region smallint not null,
  prob numeric(5,2) not null,
  prob_base numeric(5,2),
  raw real,
  rank smallint,
  entry_close numeric not null,
  news_grp text[],                       -- soorten nieuws van de laatste 3 dagen (alleen de top van de ronde)
  alerted_at timestamptz,
  alerted_prob numeric(5,2),
  alert_close numeric,
  hit boolean,                           -- +50% binnen 10 handelsdagen en de dag erna nog ≥ +20%
  touched boolean,                       -- +50% aangeraakt (ook zonder standhouden)
  resolved_at timestamptz,
  error text,
  primary key (ticker, made_on)
) with (fillfactor = 90);
create index if not exists xinix_ss_predictions_open_idx on public.xinix_ss_predictions (made_on) where resolved_at is null;
create index if not exists xinix_ss_predictions_alerted_idx on public.xinix_ss_predictions (alerted_at) where alerted_at is not null;

-- Marktklimaat per regio per sessie: aandeel van de meedoende aandelen dat hard gaat.
create table if not exists public.xinix_ss_breadth (
  region smallint not null,
  day date not null,
  n integer not null,                    -- 0 = startwaarde uit het onderzoek (public/ss-breadth-seed.json)
  b1_20 real not null,                   -- ≥ +20% vandaag
  b1_10 real not null,                   -- ≥ +10% vandaag
  bm_50 real not null,                   -- ≥ +50% in een maand
  bm_100 real not null,                  -- ≥ +100% in een maand
  bvw_15 real not null,                  -- gemiddelde dagbeweging deze week ≥ 15%
  primary key (region, day)
);

-- Kleine toestand: 'round:<ronde>' (vingerafdruk per markt, om een beursvrije dag te herkennen),
-- 'calib' (bijsturing uit het eigen track record), 'brake' (rem na mislukte runs).
create table if not exists public.xinix_ss_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Verbruik per dag, door de functie zelf bijgehouden en bewaakt.
create table if not exists public.xinix_ss_budget (
  day date primary key,
  runs integer not null default 0,
  tv integer not null default 0,           -- verzoeken aan TradingView
  yahoo integer not null default 0,        -- verzoeken aan Yahoo
  rows_written integer not null default 0,
  ms integer not null default 0,           -- rekentijd in de functie
  errors integer not null default 0,
  alerts integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Gemeten effect van nieuws: treffers gedeeld door wat het model zonder nieuws al verwachtte.
create table if not exists public.xinix_ss_news_lift (
  grp text primary key,
  n integer not null,
  hits integer not null,
  expected numeric not null,
  lift numeric,
  computed_at timestamptz not null default now()
);

alter table public.xinix_ss_scores enable row level security;
alter table public.xinix_ss_predictions enable row level security;
alter table public.xinix_ss_breadth enable row level security;
alter table public.xinix_ss_state enable row level security;
alter table public.xinix_ss_budget enable row level security;
alter table public.xinix_ss_news_lift enable row level security;

create or replace function public.xinix_ss_budget_add(p_day date, p_runs integer, p_tv integer, p_yahoo integer, p_rows integer, p_ms integer, p_errors integer, p_alerts integer)
returns public.xinix_ss_budget
language sql
set search_path = public
as $$
  insert into public.xinix_ss_budget as b (day, runs, tv, yahoo, rows_written, ms, errors, alerts, updated_at)
  values (p_day, p_runs, p_tv, p_yahoo, p_rows, p_ms, p_errors, p_alerts, now())
  on conflict (day) do update set
    runs = b.runs + excluded.runs, tv = b.tv + excluded.tv, yahoo = b.yahoo + excluded.yahoo,
    rows_written = b.rows_written + excluded.rows_written, ms = b.ms + excluded.ms,
    errors = b.errors + excluded.errors, alerts = b.alerts + excluded.alerts, updated_at = now()
  returning b.*;
$$;

-- Track record afrekenen: alle uitkomsten van een run in één opdracht.
create or replace function public.xinix_ss_resolve(p_rows jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare n integer;
begin
  update public.xinix_ss_predictions p
     set hit = r.hit, touched = r.touched, error = r.error, resolved_at = now()
    from jsonb_to_recordset(p_rows) as r(ticker text, made_on date, hit boolean, touched boolean, error text)
   where p.ticker = r.ticker and p.made_on = r.made_on and p.resolved_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Bijsturing: verhouding tussen wat uitkwam en wat voorspeld was over de laatste 120 dagen (plus de
-- 16 dagen die een voorspelling nodig heeft). Zonder eigen uitkomsten geldt de waarde uit het onderzoek.
create or replace function public.xinix_ss_calib_refresh(p_seed numeric)
returns jsonb
language plpgsql
set search_path = public
as $$
declare sp numeric; sy numeric; n integer; m numeric; v jsonb;
begin
  select coalesce(sum(prob_base) / 100.0, 0), coalesce(sum(case when hit then 1 else 0 end), 0), count(*)
    into sp, sy, n
    from public.xinix_ss_predictions
   where resolved_at is not null and hit is not null and made_on >= current_date - 136;
  m := least(2.0, greatest(0.5, (sy + 15 * p_seed) / (sp + 15)));
  v := jsonb_build_object('mult', round(m, 3), 'n', n, 'expected', round(sp, 2), 'hits', sy, 'seed', p_seed, 'at', now());
  insert into public.xinix_ss_state (key, value, updated_at) values ('calib', v, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v;
end $$;

create or replace function public.xinix_ss_news_lift_refresh()
returns integer
language plpgsql
set search_path = public
as $$
declare n integer;
begin
  insert into public.xinix_ss_news_lift as l (grp, n, hits, expected, lift, computed_at)
  select g, count(*), count(*) filter (where p.hit), round(sum(p.prob) / 100.0, 3),
         round((count(*) filter (where p.hit) + 5.0) / (sum(p.prob) / 100.0 + 5.0), 3), now()
    from public.xinix_ss_predictions p, unnest(p.news_grp) as g
   where p.resolved_at is not null and p.hit is not null
   group by g
  on conflict (grp) do update set n = excluded.n, hits = excluded.hits, expected = excluded.expected, lift = excluded.lift, computed_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.xinix_ss_track_record()
returns jsonb
language sql
stable
set search_path = public
as $$
  with r as (
    select *, case when prob < 2 then 0 when prob < 5 then 1 when prob < 10 then 2 when prob < 15 then 3 when prob < 20 then 4 else 5 end as b,
           (resolved_at is not null and hit is not null) as done
      from public.xinix_ss_predictions
  )
  select jsonb_build_object(
    'since', (select min(made_on) from r),
    'total', (select count(*) from r),
    'open', (select count(*) from r where resolved_at is null),
    'resolved', (select count(*) from r where done),
    'hits', (select count(*) from r where hit),
    'alerts', (select jsonb_build_object('n', count(*) filter (where done), 'hits', count(*) filter (where hit),
                 'open', count(*) filter (where resolved_at is null), 'avg_prob', round(avg(alerted_prob) filter (where done), 1))
               from r where alerted_at is not null),
    'buckets', (select coalesce(jsonb_agg(x order by (x->>'b')::int), '[]'::jsonb) from (
      select jsonb_build_object('b', b, 'bucket', (array['0-2','2-5','5-10','10-15','15-20','20+'])[b + 1],
        'n', count(*) filter (where done), 'hits', count(*) filter (where hit), 'touches', count(*) filter (where touched),
        'open', count(*) filter (where resolved_at is null), 'avg_prob', round(avg(prob) filter (where done), 1),
        'rate_pct', round(100.0 * count(*) filter (where hit) / nullif(count(*) filter (where done), 0), 1)) x
      from r group by b) q)
  );
$$;

revoke execute on function public.xinix_ss_budget_add(date, integer, integer, integer, integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.xinix_ss_resolve(jsonb) from public, anon, authenticated;
revoke execute on function public.xinix_ss_calib_refresh(numeric) from public, anon, authenticated;
revoke execute on function public.xinix_ss_news_lift_refresh() from public, anon, authenticated;
revoke execute on function public.xinix_ss_track_record() from public, anon, authenticated;

-- Geplande taken (UTC, werkdagen). Elke ronde kort na het slot van de eigen beurzen, op minuten waarop
-- geen andere taak start; het afrekenen en de uitgestelde meldingen in de rustige ochtenduren.
--   09:18  Azië-Pacific (Tokio sluit 06:30, Hongkong 08:00, Singapore 09:00, Sydney 05:00–06:00)
--   17:10  Europa (slot 16:30–16:35 in de winter, een uur eerder in de zomer)
--   21:36  VS en Canada (slot 21:00 in de winter, 20:00 in de zomer)
--   04:12  meldingen die in de stille uren (21–04 UTC) bleven wachten
--   05:38  track record afrekenen + bijsturing + nieuwsmeting
-- Uitzetten: update signal_settings set ss_enabled = false; of cron.alter_job(<jobid>, active := false).
select cron.schedule('xinix-ss-apac', '18 9 * * 1-5', $$select public.invoke_edge('xinix-supersprint?mode=round&region=apac')$$);
select cron.schedule('xinix-ss-europa', '10 17 * * 1-5', $$select public.invoke_edge('xinix-supersprint?mode=round&region=europa')$$);
select cron.schedule('xinix-ss-amerika', '36 21 * * 1-5', $$select public.invoke_edge('xinix-supersprint?mode=round&region=amerika')$$);
select cron.schedule('xinix-ss-flush', '12 4 * * 2-6', $$select public.invoke_edge('xinix-supersprint?mode=flush')$$);
select cron.schedule('xinix-ss-resolve', '38 5 * * 2-6', $$select public.invoke_edge('xinix-supersprint?mode=resolve')$$);
