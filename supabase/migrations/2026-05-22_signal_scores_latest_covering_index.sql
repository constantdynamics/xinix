-- Versnelt de "laatste score per ticker"-lookup (signal_scores_latest view).
-- De DISTINCT ON (ticker, mode) ORDER BY scan_date DESC scande tot nu toe
-- alle ~39k signal_scores-rijen met heap-fetches (~4,4s). Deze index levert
-- de rijen al in de juiste volgorde en bevat de kolommen die het dashboard
-- nodig heeft, zodat een index-only scan mogelijk wordt (~0,5s).
create index if not exists signal_scores_latest_cover_idx
  on signal_scores (ticker, mode, scan_date desc)
  include (final_score, action, structural, catalyst, timing);

analyze signal_scores;
