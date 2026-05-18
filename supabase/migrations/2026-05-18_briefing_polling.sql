-- briefing_polled_at + briefing_status: tracking voor de poll-briefing job
-- die nachtelijk + extra in het weekend automatisch CT.gov en openFDA bevraagt
-- om phase, has_breakthrough_designation, has_orphan_drug, trial_size etc te vullen.
alter table public.signal_tickers
  add column if not exists briefing_polled_at timestamptz;

alter table public.signal_tickers
  add column if not exists briefing_status text;

comment on column public.signal_tickers.briefing_polled_at is
  'Laatste tijdstip waarop poll-briefing-background heeft geprobeerd modality/phase/designations te vullen via clinicaltrials.gov en openFDA';

comment on column public.signal_tickers.briefing_status is
  'Status van automatische briefing-velden invul: pending / filled / no_data / not_applicable (mining/other)';

create index if not exists signal_tickers_briefing_polled_at_idx
  on public.signal_tickers (briefing_polled_at nulls first);

create index if not exists signal_tickers_briefing_status_idx
  on public.signal_tickers (briefing_status);

-- Initialiseer: biotech = pending, andere sectoren = not_applicable
update public.signal_tickers
   set briefing_status = case
     when sector = 'biotech' then 'pending'
     else 'not_applicable'
   end
 where briefing_status is null;
