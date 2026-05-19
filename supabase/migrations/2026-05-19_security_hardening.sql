-- Security hardening sweep n.a.v. Supabase advisor:
-- 1. signal_scores_latest view: SECURITY DEFINER → SECURITY INVOKER (ERROR)
-- 2. get_signal_log function: vaste search_path (WARN)
-- 3. SECURITY DEFINER functies: EXECUTE-rechten ingetrokken van anon /
--    authenticated / public role zodat alleen postgres / service_role /
--    supabase_admin ze nog kunnen aanroepen (gebruikt door pg_cron en edge
--    functions) (WARN)
-- 4. Overpermissieve "Allow all for authenticated" / "Service role full
--    access" policies op niet-Xinix legacy tabellen verwijderd. RLS blijft
--    aan, geen policies = service_role only.

-- 1. signal_scores_latest
create or replace view public.signal_scores_latest
  with (security_invoker = true) as
  SELECT DISTINCT ON (ticker, mode) id,
    ticker, sector, scan_date, mode,
    structural, catalyst, timing, confluence,
    risk_penalty, cycle_multiplier, final_score, action,
    flagged_warnings, components, trade_setup, expected_outcome,
    data_completeness, computed_at
  FROM signal_scores
  ORDER BY ticker, mode, scan_date DESC;

-- 2. get_signal_log vaste search_path
alter function public.get_signal_log(integer) set search_path = pg_catalog, public;

-- 3. SECURITY DEFINER functies dichtzetten
revoke execute on function public.invoke_edge(text)         from public, anon, authenticated;
revoke execute on function public.unbench_all()              from public, anon, authenticated;
revoke execute on function public.unbench_ticker(text)       from public, anon, authenticated;

-- 4. Overpermissieve policies op legacy tabellen verwijderen
drop policy if exists "Allow all for authenticated" on public.archives;
drop policy if exists "Allow service role"          on public.archives;
drop policy if exists "Service role full access on bluepill_scan_logs" on public.bluepill_scan_logs;
drop policy if exists "Service role full access on bluepill_stocks"    on public.bluepill_stocks;
drop policy if exists "Allow all for authenticated" on public.error_logs;
drop policy if exists "Allow service role"          on public.error_logs;
drop policy if exists "Allow all for authenticated" on public.growth_events;
drop policy if exists "Allow service role"          on public.growth_events;
drop policy if exists "Allow all for authenticated" on public.health_checks;
drop policy if exists "Allow service role"          on public.health_checks;
drop policy if exists "Service role full access on moria_scan_logs" on public.moria_scan_logs;
drop policy if exists "Service role full access on moria_stocks"    on public.moria_stocks;
drop policy if exists "Allow all for authenticated" on public.price_history;
drop policy if exists "Allow service role"          on public.price_history;
drop policy if exists "Allow all for authenticated" on public.scan_logs;
drop policy if exists "Allow service role"          on public.scan_logs;
drop policy if exists "Allow all for authenticated" on public.sector_growth_events;
drop policy if exists "Allow service role"          on public.sector_growth_events;
drop policy if exists "Allow all for authenticated" on public.sector_scan_history;
drop policy if exists "Allow service role"          on public.sector_scan_history;
drop policy if exists "Allow all for authenticated" on public.sector_scan_logs;
drop policy if exists "Allow service role"          on public.sector_scan_logs;
drop policy if exists "Allow all for authenticated" on public.sector_spike_events;
drop policy if exists "Allow service role"          on public.sector_spike_events;
drop policy if exists "Allow all for authenticated" on public.sector_stocks;
drop policy if exists "Allow service role"          on public.sector_stocks;
drop policy if exists "Allow all for authenticated" on public.settings;
drop policy if exists "Allow service role"          on public.settings;
drop policy if exists "Allow all for authenticated" on public.stocks;
drop policy if exists "Allow service role"          on public.stocks;
drop policy if exists "Allow all for authenticated" on public.zonnebloem_scan_history;
drop policy if exists "Allow service role"          on public.zonnebloem_scan_history;
drop policy if exists "Allow all for authenticated" on public.zonnebloem_scan_logs;
drop policy if exists "Allow service role"          on public.zonnebloem_scan_logs;
drop policy if exists "Allow all for authenticated" on public.zonnebloem_spike_events;
drop policy if exists "Allow service role"          on public.zonnebloem_spike_events;
drop policy if exists "Allow all for authenticated" on public.zonnebloem_stocks;
drop policy if exists "Allow service role"          on public.zonnebloem_stocks;
