-- Dagelijkse gerichte feniks-scan (scan-fallen-phoenix-background) om 02:00 UTC.
-- Botst niet met scan-losers (23:00) of scan-bottoms (04:00). Rotatie over de
-- markten zit in de functie zelf, dus de hele universe komt wekelijks langs.
SELECT cron.schedule(
  'scan-fallen-phoenix-daily',
  '0 2 * * *',
  $$SELECT public.invoke_edge('scan-fallen-phoenix-background')$$
);
