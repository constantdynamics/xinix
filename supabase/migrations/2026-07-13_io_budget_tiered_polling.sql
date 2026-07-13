-- IO-budget optimalisatie: favoriet-gedreven poll-cadans + autovacuum + log-retentie.
-- Bijbehorende functielogica: poll-prices-background & compute-scores-background.
--
-- Achtergrond: het IO-budget van het project raakte uitgeput door hoogfrequente
-- cron-jobs die op groeiende churn-tabellen schreven. De functies knijpen nu zelf
-- per ticker (favorieten 2x per handelsdag ~1u na open en ~1u voor sluiting,
-- overige tickers hooguit 1x per week); deze migratie verlaagt daarnaast de
-- cron-frequentie en zet autovacuum + log-retentie goed.

-- 1. Cron-cadans verlagen. alter_job via jobnaam i.p.v. hardcoded jobid.
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'xinix-poll-prices'),      schedule => '*/30 * * * *'); -- 10min -> 30min
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'xinix-compute-scores'),   schedule => '0 */3 * * *');  -- 30min -> 3u
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'xinix-compute-extremes'), schedule => '0 */6 * * *');  -- 30min -> 6u

-- 2. Autovacuum agressiever op de churn-tabellen (waren nog nooit ge-vacuumd).
ALTER TABLE public.signal_scores        SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.signal_tickers       SET (autovacuum_vacuum_scale_factor = 0.02, fillfactor = 90);
ALTER TABLE public.signal_price_summary SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE public.signal_events        SET (autovacuum_vacuum_scale_factor = 0.05);

-- 3. Technische cron-logs opruimen (>7 dagen). Verwijdert alleen pg_cron-loghistorie,
--    geen applicatiedata. Idempotent: eerst unschedulen als de job al bestaat.
DO $$ BEGIN PERFORM cron.unschedule('purge-cron-logs'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('purge-cron-logs', '0 3 * * *',
  $purge$ DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days' $purge$);
