-- xinix-equity-heal — voorkomt herhaling van het Families-chart "horizontale
-- strepen" probleem. Bij multi-day sim-failures stond de xinix_strategy_equity
-- tabel uit-de-pas en moest handmatig xinix-equity-backfill draaien.
--
-- Self-heal logica: elke avond om 23:00 UTC (≈1u na de sim-run) checken of
-- de meest recente equity-snapshot < 3 dagen oud is. Drempel van 3 dagen is
-- robuust tegen weekenden (geen handel za/zo) en korte handelsvakanties.
-- Bij oudere snapshots → invoke xinix-equity-backfill (idempotent upsert).
--
-- Logt elke run in signal_runs zodat je in het dashboard ziet dat het draait.

CREATE OR REPLACE FUNCTION public.xinix_equity_heal()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  latest_date DATE;
  age_days INT;
  msg TEXT;
BEGIN
  SELECT MAX(date) INTO latest_date FROM xinix_strategy_equity;
  age_days := COALESCE(CURRENT_DATE - latest_date, 999);

  IF latest_date IS NULL OR age_days > 3 THEN
    PERFORM public.invoke_edge('xinix-equity-backfill');
    msg := format(
      'gap gedetecteerd: laatste snapshot %s (%s dagen oud) — backfill getriggerd',
      COALESCE(latest_date::TEXT, 'geen'),
      age_days
    );
  ELSE
    msg := format(
      'ok: laatste snapshot %s (%s dagen oud)',
      latest_date,
      age_days
    );
  END IF;

  INSERT INTO signal_runs (job, ok, message, finished_at)
  VALUES ('xinix-equity-heal', true, msg, NOW());

  RETURN msg;
END;
$$;

COMMENT ON FUNCTION public.xinix_equity_heal IS
  'Self-heal voor xinix_strategy_equity. Triggert xinix-equity-backfill als laatste snapshot > 3 dagen oud is. Loopt dagelijks via pg_cron.';

-- Verwijder oude versie (indien bestaand) en (her)schedule dagelijks 23:00 UTC.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-equity-heal-daily') THEN
    PERFORM cron.unschedule('xinix-equity-heal-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'xinix-equity-heal-daily',
  '0 23 * * *',
  $$SELECT public.xinix_equity_heal()$$
);
