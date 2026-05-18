-- Phoenix + Hikkertjes scans van 1×/dag naar elke 2 uur — bij ~3000 nog te
-- scannen tickers met 80-100/batch zou dat anders 30+ dagen kosten. Nu: elke
-- 2u × 80-100 = ~1000/dag = hele watchlist in ~4 dagen.
select cron.unschedule('xinix-compute-phoenix') where exists (select 1 from cron.job where jobname='xinix-compute-phoenix');
select cron.unschedule('xinix-compute-hikkertjes') where exists (select 1 from cron.job where jobname='xinix-compute-hikkertjes');

select cron.schedule(
  'xinix-compute-phoenix', '0 */2 * * *',
  $$select public.invoke_edge('compute-phoenix-background')$$
);
select cron.schedule(
  'xinix-compute-hikkertjes', '30 */2 * * *',
  $$select public.invoke_edge('compute-hikkertjes-background')$$
);
