-- Corrigeer de buy_limit van aandelen die door scan-bottoms-background waren
-- toegevoegd met buy_limit = 5y-low × 1,10. Omdat die scan juist aandelen
-- pakt die al binnen 10% van hun 5y-low staan, was de buy_limit op het
-- moment van toevoegen al geraakt → directe (foutieve) rode buy_limit_hit-
-- notificatie. De fix in de edge function zet de buy_limit voortaan op de
-- échte 5y-low; deze migratie corrigeert de twee reeds-toegevoegde tickers.
update signal_tickers set buy_limit = 0.0614
  where ticker = 'SPEC.ST' and buy_limit = 0.0675;
update signal_tickers set buy_limit = 1.190
  where ticker = 'H2O.DE' and buy_limit = 1.309;

-- Verlopen-zetten van de foutieve buy_limit_hit-events (artefact van de te
-- hoge limiet) zodat ze van het dashboard verdwijnen.
update signal_events set expires_at = now()
  where ticker in ('SPEC.ST', 'H2O.DE')
    and signal_type = 'buy_limit_hit'
    and (expires_at is null or expires_at > now());
