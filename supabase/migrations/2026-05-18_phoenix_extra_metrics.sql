-- Extra feniks-statistieken: aantal incidenten, mediaan datum,
-- max groei binnen 180 dagen, mediaan dagen tot 50×, en de raw incidents.
ALTER TABLE signal_tickers
  ADD COLUMN IF NOT EXISTS phoenix_incident_count integer,
  ADD COLUMN IF NOT EXISTS phoenix_median_date date,
  ADD COLUMN IF NOT EXISTS phoenix_max_growth_180d_pct numeric,
  ADD COLUMN IF NOT EXISTS phoenix_days_to_50x integer,
  ADD COLUMN IF NOT EXISTS phoenix_incidents jsonb;
