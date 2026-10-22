-- Dagadvies weg (gebruiker, 2026-10-22: "haal straks het tabblad dagadvies met bijbehorende
-- notificaties maar weg"). Het tabblad verdwijnt uit de site; hier stoppen de runs en de meldingen.
-- De tabellen xinix_advice_* en de edge function xinix-advice blijven bestaan (er wordt niets gewist),
-- zodat het Dagadvies terug kan.
select cron.unschedule('xinix-advice-watch');
select cron.unschedule('xinix-advice-daily');
update public.signal_settings set advice_notify = false where id = 1;

-- De ECB-wisselkoersen in xinix_fx_rates ververste het Dagadvies elke werkdag; het crypto-tabblad
-- leest ze nog. Nu haalt de database ze zelf op: elke run verwerkt het laatste ECB-antwoord dat
-- pg_net binnenkreeg (van de vorige run, pg_net bewaart antwoorden 6 uur) en vraagt de koersen
-- van vandaag opnieuw op. Geeft het aantal bijgewerkte munten terug.
create or replace function public.xinix_refresh_fx()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  doc xml;
  n integer := 0;
begin
  begin
    select r.content::xml into doc
    from net._http_response r
    where r.status_code = 200 and r.created > now() - interval '6 hours'
      and r.content like '%eurofxref%' and r.content like '%currency=%'
    order by r.id desc
    limit 1;
    if doc is not null then
      with cubes as (
        select unnest(xpath('//*[local-name()="Cube"][@currency]', doc)) as cube
      ), rates as (
        select (xpath('/*/@currency', cube))[1]::text as currency,
               (xpath('/*/@rate', cube))[1]::text::numeric as per_eur
        from cubes
      )
      insert into xinix_fx_rates (currency, per_eur, as_of, updated_at)
      select currency, per_eur,
             coalesce((xpath('//*[local-name()="Cube"][@time]/@time', doc))[1]::text::date, current_date), now()
      from rates
      where per_eur > 0
      on conflict (currency) do update
        set per_eur = excluded.per_eur, as_of = excluded.as_of, updated_at = excluded.updated_at;
      get diagnostics n = row_count;
    end if;
  exception when others then
    raise warning 'xinix_refresh_fx: ECB-antwoord niet te verwerken: %', sqlerrm;
  end;
  perform net.http_get(url := 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', timeout_milliseconds := 20000);
  return n;
end;
$$;
revoke all on function public.xinix_refresh_fx() from public, anon, authenticated;
grant execute on function public.xinix_refresh_fx() to service_role;

-- De ECB publiceert rond 16:00 CET: de run van 15:20 UTC vraagt op, die van 15:50 UTC verwerkt.
select cron.schedule('xinix-fx-refresh', '20,50 15 * * 1-5', $$select public.xinix_refresh_fx()$$);
