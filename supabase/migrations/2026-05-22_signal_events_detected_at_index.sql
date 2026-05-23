-- Het dashboard haalt de 500 nieuwste niet-verlopen signalen op
-- (ORDER BY detected_at DESC LIMIT 500). Zonder index was dat een seq scan
-- + sort over ~23k rijen (~1,7s). Deze index laat Postgres direct van nieuw
-- naar oud lopen.
create index if not exists signal_events_detected_at_idx
  on signal_events (detected_at desc);

analyze signal_events;
