-- Vier cronjobs die sinds mei nooit iets deden: hun URL kwam uit een instelling
-- die niet bestaat (current_setting('app.supabase_url') / 'xinix.functions_url').
--   watchlist-digest-daily / -weekly / -monthly  (top stijgers en dalers, week/maand met melding)
--   xinix-mini-export-weekly                      (wekelijkse mini-kennisexport)
-- De gebruiker koos ze niet aan te zetten maar op te ruimen (2026-10-04).
-- De edge functions zelf blijven bestaan.
do $$
declare
  j text;
begin
  foreach j in array array['watchlist-digest-daily', 'watchlist-digest-weekly', 'watchlist-digest-monthly', 'xinix-mini-export-weekly'] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;
end $$;
