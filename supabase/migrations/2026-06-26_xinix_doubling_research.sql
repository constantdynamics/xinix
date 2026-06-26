-- Verdubbelaars research-verrijking.
-- Tabel met een research-overlay per favoriet + SQL-aggregatiefunctie +
-- pg_cron job die elke ~15 dagen (1e en 16e) de overlay ververst via
-- xinix-doubling-research-background.

CREATE TABLE IF NOT EXISTS public.xinix_doubling_research (
  ticker               text PRIMARY KEY,
  company              text,
  sector               text,
  research_multiplier  numeric NOT NULL DEFAULT 1,   -- ×-factor op de prijs-kans
  conf_bonus           numeric NOT NULL DEFAULT 0,   -- opgeteld bij betrouwbaarheid
  factors              jsonb   NOT NULL DEFAULT '[]'::jsonb,
  bull                 jsonb   NOT NULL DEFAULT '[]'::jsonb,
  bear                 jsonb   NOT NULL DEFAULT '[]'::jsonb,
  summary              text,
  data                 jsonb   NOT NULL DEFAULT '{}'::jsonb,
  computed_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.xinix_doubling_research ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "doubling_research public read" ON public.xinix_doubling_research;
CREATE POLICY "doubling_research public read"
  ON public.xinix_doubling_research FOR SELECT USING (true);
GRANT SELECT ON public.xinix_doubling_research TO anon, authenticated;

-- Aggregeert alle research-data per favoriet in één set rijen.
CREATE OR REPLACE FUNCTION public.xinix_doubling_research_inputs()
RETURNS TABLE (
  ticker text, company text, sector text,
  market_cap_usd bigint, share_count_millions numeric, cash_runway_months int,
  insider_ownership_pct numeric, dividend_yield numeric,
  material_news_90d int, material_news_30d int, jv_recent boolean,
  last_material_title text, last_material_at timestamptz,
  filings_120d int, latest_filing_form text, latest_filing_at timestamptz,
  next_catalyst_date date, next_catalyst_type text, next_catalyst_source text,
  next_trial_date date, next_trial_title text,
  events_120d int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  with fav as (select distinct upper(ticker) tk from xinix_favorites),
  ev as (
    select upper(ticker) tk,
      count(*) filter (where detected_at >= now()-interval '90 days' and (
        (signal_type='8k_material' and severity in ('orange','red')) or signal_type='jv_strategic'))::int as mat90,
      count(*) filter (where detected_at >= now()-interval '30 days' and (
        (signal_type='8k_material' and severity in ('orange','red')) or signal_type='jv_strategic'))::int as mat30,
      bool_or(detected_at >= now()-interval '90 days' and signal_type='jv_strategic') as jv,
      count(*) filter (where detected_at >= now()-interval '120 days')::int as ev120
    from signal_events where upper(ticker) in (select tk from fav)
    group by upper(ticker)
  ),
  last_mat as (
    select distinct on (upper(ticker)) upper(ticker) tk, title, detected_at
    from signal_events
    where upper(ticker) in (select tk from fav)
      and ((signal_type='8k_material' and severity in ('orange','red')) or signal_type='jv_strategic')
    order by upper(ticker), detected_at desc
  ),
  fil as (
    select upper(ticker) tk, count(*) filter (where filed_at >= now()-interval '120 days')::int as f120
    from signal_filings where upper(ticker) in (select tk from fav) group by upper(ticker)
  ),
  last_fil as (
    select distinct on (upper(ticker)) upper(ticker) tk, form, filed_at
    from signal_filings where upper(ticker) in (select tk from fav)
    order by upper(ticker), filed_at desc
  ),
  -- Alleen betrouwbare, écht gedateerde katalysatoren: ClinicalTrials.gov +
  -- handmatig bevestigd. De 'vandaag'-gestempelde nieuws-detecties
  -- (google-news/yahoo-news) zijn geen geplande datums en worden uitgesloten.
  cat as (
    select distinct on (upper(ticker)) upper(ticker) tk, expected_date, catalyst_type, source
    from signal_catalysts
    where upper(ticker) in (select tk from fav) and expected_date >= current_date and occurred_at is null
      and coalesce(source,'') not in ('google-news','yahoo-news')
    order by upper(ticker), expected_date asc
  ),
  tr as (
    select distinct on (upper(ticker)) upper(ticker) tk, primary_completion_date, brief_title
    from signal_trials
    where upper(ticker) in (select tk from fav) and primary_completion_date >= current_date
      and upper(coalesce(overall_status,'')) not in ('COMPLETED','TERMINATED','WITHDRAWN','SUSPENDED','NO_LONGER_AVAILABLE')
    order by upper(ticker), primary_completion_date asc
  )
  select f.tk, t.company, t.sector,
    t.market_cap_usd, t.share_count_millions, t.cash_runway_months,
    t.insider_ownership_pct, t.dividend_yield,
    coalesce(ev.mat90,0), coalesce(ev.mat30,0), coalesce(ev.jv,false),
    lm.title, lm.detected_at,
    coalesce(fil.f120,0), lf.form, lf.filed_at,
    cat.expected_date, cat.catalyst_type, cat.source,
    tr.primary_completion_date, tr.brief_title,
    coalesce(ev.ev120,0)
  from fav f
  left join signal_tickers t on upper(t.ticker)=f.tk
  left join ev on ev.tk=f.tk
  left join last_mat lm on lm.tk=f.tk
  left join fil on fil.tk=f.tk
  left join last_fil lf on lf.tk=f.tk
  left join cat on cat.tk=f.tk
  left join tr on tr.tk=f.tk;
$$;

GRANT EXECUTE ON FUNCTION public.xinix_doubling_research_inputs() TO service_role;

-- Elke ~15 dagen verrijken: 1e en 16e van de maand, 05:00 UTC.
SELECT cron.unschedule('xinix-doubling-research-biweekly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-doubling-research-biweekly');

SELECT cron.schedule(
  'xinix-doubling-research-biweekly',
  '0 5 1,16 * *',
  $$SELECT invoke_edge('xinix-doubling-research-background')$$
);
