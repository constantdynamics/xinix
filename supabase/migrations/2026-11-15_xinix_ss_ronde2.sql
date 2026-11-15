-- SUPERsprinters, tweede ronde (15 november 2026). Onderzoek: docs/supersprinters-rapport.md, hoofdstuk 14.
--
-- 1. Grens op heel beweeglijke aandelen. Een aandeel dat deze week gemiddeld meer dan 30% per dag
--    uitsloeg (hoogste tegen laagste koers van de dag) was in de test even vaak raak als de rest, maar
--    eindigde veel vaker 30% of meer lager: onder de kandidaten vanaf 15% was dat 17% (2020–2024) en 42%
--    (2025–2026), tegen 6–12% en 9–26% bij de rustiger aandelen. Zulke aandelen krijgen geen melding
--    meer. Instelbaar: signal_settings.ss_alert_max_volw (0 = geen grens).
-- 2. Track record vanaf de opening. Bij het afrekenen wordt nu ook vastgelegd wat er gebeurde vanaf de
--    opening van de dag na de voorspelling (het eerste moment waarop je kunt kopen): hoe hoog hij opende,
--    of +50% vanaf die opening gehaald werd, het rendement na 10 handelsdagen, en het laagste en hoogste
--    slot onderweg. Geen extra verzoeken: dezelfde dagkoersen van Yahoo.
-- 3. Azië en Australië direct melden. De ochtendmelding (04:12 UTC) kwam voor die markten als de
--    volgende sessie al uren liep. Een tweede meldmoment om 09:33 UTC, een kwartier na de ronde van
--    09:18, stuurt die kandidaten dezelfde dag, ruim vóór hun volgende opening.

alter table public.xinix_ss_scores add column if not exists vol_w numeric;
comment on column public.xinix_ss_scores.vol_w is 'Gemiddelde dagbeweging (hoogste tegen laagste koers) over de laatste week, in %. Boven ss_alert_max_volw gaat er geen melding uit.';

alter table public.xinix_ss_predictions
  add column if not exists vol_w numeric,
  add column if not exists gap_open numeric,
  add column if not exists hit_open boolean,
  add column if not exists ret10_open numeric,
  add column if not exists min10_open numeric,
  add column if not exists max10_open numeric;
comment on column public.xinix_ss_predictions.vol_w is 'Gemiddelde dagbeweging over de week vóór de voorspelling, in % (bepaalt de risicoklasse).';
comment on column public.xinix_ss_predictions.gap_open is 'Opening van de eerste handelsdag na de voorspelling t.o.v. het slot van de voorspeldag, in %.';
comment on column public.xinix_ss_predictions.hit_open is 'Raak gerekend vanaf die opening: binnen 10 handelsdagen een slot ≥ +50% en de dag erna nog ≥ +20%.';
comment on column public.xinix_ss_predictions.ret10_open is 'Slot na 10 handelsdagen t.o.v. die opening, in %.';
comment on column public.xinix_ss_predictions.min10_open is 'Laagste slot in die 10 handelsdagen t.o.v. de opening, in %.';
comment on column public.xinix_ss_predictions.max10_open is 'Hoogste slot in die 10 handelsdagen t.o.v. de opening, in %.';

alter table public.signal_settings add column if not exists ss_alert_max_volw numeric not null default 30;
comment on column public.signal_settings.ss_alert_max_volw is 'SUPERsprinters: geen melding als het aandeel deze week gemiddeld meer dan zoveel procent per dag bewoog (0 = geen grens).';

-- Afrekenen: de uitkomsten vanaf de opening gaan mee in dezelfde opdracht. Een oudere versie van de
-- functie stuurt die velden niet mee; ze blijven dan leeg.
create or replace function public.xinix_ss_resolve(p_rows jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare n integer;
begin
  update public.xinix_ss_predictions p
     set hit = r.hit, touched = r.touched, error = r.error, resolved_at = now(),
         gap_open = r.gap_open, hit_open = r.hit_open, ret10_open = r.ret10_open,
         min10_open = r.min10_open, max10_open = r.max10_open
    from jsonb_to_recordset(p_rows) as r(ticker text, made_on date, hit boolean, touched boolean, error text,
           gap_open numeric, hit_open boolean, ret10_open numeric, min10_open numeric, max10_open numeric)
   where p.ticker = r.ticker and p.made_on = r.made_on and p.resolved_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Track record: naast "raak vanaf het slot" ook wat kopen bij de opening opleverde, en de uitkomsten
-- per risicoklasse (alle voorspellingen vanaf 15%, zoals in het onderzoek).
create or replace function public.xinix_ss_track_record()
returns jsonb
language sql
stable
set search_path = public
as $$
  with r as (
    select *, case when prob < 2 then 0 when prob < 5 then 1 when prob < 10 then 2 when prob < 15 then 3 when prob < 20 then 4 else 5 end as b,
           (resolved_at is not null and hit is not null) as done,
           case when vol_w is null then 4 when vol_w <= 12 then 0 when vol_w <= 21 then 1 when vol_w <= 30 then 2 else 3 end as rk
      from public.xinix_ss_predictions
  )
  select jsonb_build_object(
    'since', (select min(made_on) from r),
    'total', (select count(*) from r),
    'open', (select count(*) from r where resolved_at is null),
    'resolved', (select count(*) from r where done),
    'hits', (select count(*) from r where hit),
    'alerts', (select jsonb_build_object('n', count(*) filter (where done), 'hits', count(*) filter (where hit),
                 'open', count(*) filter (where resolved_at is null), 'avg_prob', round(avg(alerted_prob) filter (where done), 1),
                 'n_open', count(*) filter (where done and ret10_open is not null), 'hits_open', count(*) filter (where done and hit_open),
                 'avg_ret10', round(avg(ret10_open) filter (where done), 1),
                 'med_ret10', round((percentile_cont(0.5) within group (order by ret10_open) filter (where done))::numeric, 1),
                 'big_loss', count(*) filter (where done and ret10_open <= -30),
                 'avg_gap', round(avg(gap_open) filter (where done), 1))
               from r where alerted_at is not null),
    'buckets', (select coalesce(jsonb_agg(x order by (x->>'b')::int), '[]'::jsonb) from (
      select jsonb_build_object('b', b, 'bucket', (array['0-2','2-5','5-10','10-15','15-20','20+'])[b + 1],
        'n', count(*) filter (where done), 'hits', count(*) filter (where hit), 'touches', count(*) filter (where touched),
        'open', count(*) filter (where resolved_at is null), 'avg_prob', round(avg(prob) filter (where done), 1),
        'rate_pct', round(100.0 * count(*) filter (where hit) / nullif(count(*) filter (where done), 0), 1),
        'n_open', count(*) filter (where done and ret10_open is not null), 'hits_open', count(*) filter (where done and hit_open),
        'avg_ret10', round(avg(ret10_open) filter (where done), 1), 'big_loss', count(*) filter (where done and ret10_open <= -30)) x
      from r group by b) q),
    'risk', (select coalesce(jsonb_agg(x order by (x->>'rk')::int), '[]'::jsonb) from (
      select jsonb_build_object('rk', rk, 'n', count(*) filter (where done), 'hits', count(*) filter (where hit),
        'n_open', count(*) filter (where done and ret10_open is not null), 'hits_open', count(*) filter (where done and hit_open),
        'avg_ret10', round(avg(ret10_open) filter (where done), 1), 'big_loss', count(*) filter (where done and ret10_open <= -30),
        'open', count(*) filter (where resolved_at is null)) x
      from r where prob >= 15 group by rk) q)
  );
$$;
revoke execute on function public.xinix_ss_resolve(jsonb) from public, anon, authenticated;
revoke execute on function public.xinix_ss_track_record() from public, anon, authenticated;

-- Tweede meldmoment, voor Azië en Australië: een kwartier na de ronde van 09:18 UTC. Op dat moment
-- wachten alleen de kandidaten van die ronde; die van Europa en de VS gaan de volgende ochtend om 04:12.
-- Uitzetten: select cron.alter_job((select jobid from cron.job where jobname = 'xinix-ss-flush-apac'), active := false);
select cron.schedule('xinix-ss-flush-apac', '33 9 * * 1-5', $$select public.invoke_edge('xinix-supersprint?mode=flush')$$);
