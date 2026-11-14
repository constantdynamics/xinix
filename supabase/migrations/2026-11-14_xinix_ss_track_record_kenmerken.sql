-- SUPERsprinters: het track record bewaart ook de omzet per dag, de beurswaarde en het aantal vrij
-- verhandelbare aandelen op de dag van de voorspelling.
--
-- Die drie stonden alleen in de stand per aandeel (xinix_ss_scores), en die wordt elke dag overschreven.
-- Het aantal vrij verhandelbare aandelen is achteraf nergens gratis terug te vinden: in het onderzoek
-- kon daardoor niet getest worden of het iets voorspelt. Vanaf nu wordt het vastgelegd, zodat dat over
-- een half jaar op eigen cijfers wel kan. Kolommen zonder standaardwaarde: toevoegen kost niets.
alter table public.xinix_ss_predictions
  add column if not exists dvol_usd numeric,        -- omzet per dag in dollars (slot × gemiddeld volume over 30 dagen)
  add column if not exists mcap_usd numeric,        -- beurswaarde in dollars
  add column if not exists float_shares numeric;    -- vrij verhandelbare aandelen (TradingView)

-- De eerste dag aanvullen uit de stand van diezelfde dag.
update public.xinix_ss_predictions p
   set dvol_usd = s.dvol_usd, mcap_usd = s.mcap_usd, float_shares = s.float_shares
  from public.xinix_ss_scores s
 where s.ticker = p.ticker and s.session_date = p.made_on and p.dvol_usd is null;
