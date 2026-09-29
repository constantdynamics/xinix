-- De cron van 2026-05-14 bouwde de URL op uit current_setting('app.supabase_url'),
-- maar die instelling bestaat niet in dit project. net.http_post kreeg dus nooit
-- een geldige URL: market_regime bleef sinds 14 mei op 'strong_bull' staan, en
-- xinix-sim / xinix-trade vallen bij een regime ouder dan 3 dagen ook nog eens
-- terug op 'strong_bull'. Dezelfde route als alle andere jobs: invoke_edge().
SELECT cron.unschedule('xinix-market-regime-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-market-regime-daily');
SELECT cron.schedule('xinix-market-regime-daily', '30 21 * * *', $$SELECT public.invoke_edge('xinix-market-regime')$$);
