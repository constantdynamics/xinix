-- View: 1 rij per (ticker, mode) met de meest recente scan.
-- Gebruikt de bestaande (ticker, scan_date DESC) index voor snelle DISTINCT ON.
-- Vervangt client-side dedup in de scores endpoint.
create or replace view public.signal_scores_latest as
  select distinct on (ticker, mode) *
    from public.signal_scores
   order by ticker, mode, scan_date desc;

comment on view public.signal_scores_latest is
  'Meest recente score-rij per (ticker, mode). Vervangt client-side dedup in de scores endpoint.';

grant select on public.signal_scores_latest to anon, authenticated;
