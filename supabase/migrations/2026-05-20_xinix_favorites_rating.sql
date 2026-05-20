-- Sterren-rating 1-5 op favorieten zodat je preciezer kunt aangeven welke
-- je echt goed vindt. NULL = nog niet beoordeeld.
alter table public.xinix_favorites
  add column if not exists rating smallint check (rating is null or (rating >= 1 and rating <= 5));
