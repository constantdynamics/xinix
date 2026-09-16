-- Hippos: van favorieten naar de hele watchlist.
--
-- Het model rekende alleen op aandelen met een hartje. De kansberekening zelf
-- heeft die beperking niet nodig: de lifts zijn algemene regelmatigheden en de
-- kenmerken komen uit signal_price_summary, dat voor de hele watchlist gevuld
-- wordt. Door alles mee te nemen worden de lifts op méér waarnemingen gemeten
-- én komen kandidaten in beeld die nog geen hartje hebben.
--
-- Wat níét verandert: meldingen blijven voorbehouden aan favorieten. Een ping
-- over een aandeel dat je nooit hebt bekeken is ruis, geen signaal.
--
-- Tempo. De scan doet ~75 tickers per run, 12 runs per dag. Favorieten worden
-- elke 30 dagen opnieuw doorgelicht (641 / 30 ≈ 21 per dag), de rest elke 90
-- dagen (~3100 / 90 ≈ 35 per dag). Samen ruim binnen de 900 per dag die de
-- cron aankan; de eerste volledige dekking duurt ongeveer vier dagen.

ALTER TABLE public.xinix_hippo_scores
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS xinix_hippo_scores_fav_idx
  ON public.xinix_hippo_scores (is_favorite) WHERE is_favorite;

COMMENT ON COLUMN public.xinix_hippo_scores.is_favorite IS
  'Heeft dit aandeel een hartje? Alleen favorieten kunnen een hippo-melding krijgen; de rest staat er voor de ranglijst.';

-- De ranglijst groeit van ~600 naar ~3500 rijen. Het zwaarste veld is de
-- opbouw per horizon (factors/factors_7d); die wordt alleen bewaard voor
-- favorieten en de kopgroep, zie TOP_FACTORS in de edge function.
COMMENT ON COLUMN public.xinix_hippo_scores.factors IS
  'Opbouw van de 14-daagse kans. Leeg voor aandelen buiten de kopgroep en zonder hartje, om de tabel klein te houden.';
