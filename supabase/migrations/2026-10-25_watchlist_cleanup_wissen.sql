-- Watchlist-opschoning, deel 2 van 2: het wissen. Draait na deel 1 (2026-10-24_watchlist_cleanup.sql),
-- dat de 25e is uitgevoerd. Supabase vraagt hierbij om een bevestiging, dus de gebruiker plakt dit in
-- de SQL-editor of bevestigt de vraag op een apparaat waar die wel verschijnt. Wat hier verdwijnt staat
-- al als momentopname in xinix_watchlist_cleanup.

do $$
begin
  if not exists (select 1 from xinix_watchlist_cleanup where actie = 'opgevolgd') then
    raise exception 'deel 1 is nog niet uitgevoerd';
  end if;
  if exists (select 1 from xinix_watchlist_cleanup where actie = 'verwijderd') then
    raise exception 'deel 2 is al uitgevoerd';
  end if;
  if exists (select 1 from xinix_watchlist_cleanup w left join signal_tickers t on t.ticker = w.opvolger
             where w.actie = 'inactief' and w.opvolger is not null and (t.ticker is null or not t.active)) then
    raise exception 'een opvolger staat niet (actief) op de watchlist';
  end if;
  if exists (select 1 from xinix_strategy_positions p join xinix_watchlist_cleanup w on w.ticker = p.ticker
             where w.actie = 'inactief' and w.opvolger is not null and p.closed_at is null) then
    raise exception 'een te wissen ticker heeft nog een open Potje-positie';
  end if;
end $$;

-- Hartjes en sterren van de opgevolgde (2a), overgenomen of stilgevallen (3a) en dubbele (1c) aandelen.
delete from xinix_favorites f using xinix_watchlist_cleanup w
where w.actie in ('opgevolgd', 'inactief') and f.ticker = w.ticker;

-- Zoals "terugzetten" in het tijdelijke lijstje: wie weer actief is, gaat van die lijst af.
delete from xinix_temp_list l using xinix_watchlist_cleanup w
where w.actie = 'opvolger' and l.ticker = w.ticker;

-- ── 1c: de 14 oude tickers en nevennoteringen helemaal wissen ─────────────────────────────────
-- signal_price_summary, signal_events, signal_catalysts, signal_trials en signal_filings gaan via
-- ON DELETE CASCADE mee. Historie blijft staan: Potje- en papieren posities, het meldingenlogboek,
-- track records (hippo/sprint/event-voorspellingen), splits en koersreparaties.
insert into xinix_watchlist_cleanup (ticker, actie, opvolger, toelichting, snapshot)
select t.ticker, 'verwijderd', w.opvolger, 'oude ticker of nevennotering; de opvolger stond al op de watchlist',
       jsonb_build_object('signal_tickers', to_jsonb(t),
                          'signal_price_summary', (select to_jsonb(s) from signal_price_summary s where s.ticker = t.ticker),
                          'gezien', (select to_jsonb(g) from xinix_seen g where g.ticker = t.ticker))
from signal_tickers t
join xinix_watchlist_cleanup w on w.ticker = t.ticker and w.actie = 'inactief' and w.opvolger is not null;

delete from xinix_seen where ticker in (select ticker from xinix_watchlist_cleanup where actie = 'verwijderd');
delete from xinix_notify_mute where ticker in (select ticker from xinix_watchlist_cleanup where actie = 'verwijderd');
delete from xinix_fav_alert_state where ticker in (select ticker from xinix_watchlist_cleanup where actie = 'verwijderd');
delete from xinix_temp_list where ticker in (select ticker from xinix_watchlist_cleanup where actie = 'verwijderd');
delete from xinix_skyshots where ticker in (select ticker from xinix_watchlist_cleanup where actie = 'verwijderd');
delete from xinix_skyshot_tickers where ticker in (select ticker from xinix_watchlist_cleanup where actie = 'verwijderd');
delete from xinix_hippo_scores where ticker in (select ticker from xinix_watchlist_cleanup where actie = 'verwijderd');
delete from xinix_hippo_history where ticker in (select ticker from xinix_watchlist_cleanup where actie = 'verwijderd');
delete from xinix_rocket_scores where ticker in (select ticker from xinix_watchlist_cleanup where actie = 'verwijderd');
delete from xinix_sprint_scores where ticker in (select ticker from xinix_watchlist_cleanup where actie = 'verwijderd');
delete from xinix_star_scan_results where ticker in (select ticker from xinix_watchlist_cleanup where actie = 'verwijderd');
delete from xinix_event_history where ticker in (select ticker from xinix_watchlist_cleanup where actie = 'verwijderd');
delete from xinix_price_flags where ticker in (select ticker from xinix_watchlist_cleanup where actie = 'verwijderd');
delete from signal_scores where ticker in (select ticker from xinix_watchlist_cleanup where actie = 'verwijderd');
delete from signal_tickers where ticker in (select ticker from xinix_watchlist_cleanup where actie = 'verwijderd');
