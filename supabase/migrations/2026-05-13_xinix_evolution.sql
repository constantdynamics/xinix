-- Evolutie-kolommen voor survival-of-the-fittest mechanisme.
-- Na 180 dagen worden de onderste 10% van de niet-beschermde strategieën gecullled
-- en vervangen door nakomelingen van de top-15% met 1-3 config-mutaties.

ALTER TABLE public.xinix_strategies
  ADD COLUMN IF NOT EXISTS generation  INTEGER      DEFAULT 1,
  ADD COLUMN IF NOT EXISTS protected   BOOLEAN      DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_id   INTEGER      REFERENCES public.xinix_strategies(id),
  ADD COLUMN IF NOT EXISTS retired_at  TIMESTAMPTZ;

-- Bescherm long-holdDays strategieën (de "lottery-ticker" categorie):
-- holdDays >= 90 = strategieën die wachten op de eens-per-5-jaar spike.
-- 15 van de 100 vallen hieronder (holdDays: 90×10, 120×4, 180×1).
UPDATE public.xinix_strategies
SET protected = true
WHERE (config->>'holdDays')::int >= 90;

-- Index voor snelle actieve + generatie lookup
CREATE INDEX IF NOT EXISTS idx_xinix_strategies_active_gen
  ON public.xinix_strategies (active, generation);

-- Cron: evolutie op 1 jan en 1 jul (≈180 dagen) om 22:30 UTC
SELECT cron.unschedule('xinix-evolve-biannual')
  FROM cron.job WHERE jobname = 'xinix-evolve-biannual';

SELECT cron.schedule(
  'xinix-evolve-biannual',
  '30 22 1 1,7 *',
  $$SELECT public.invoke_edge('xinix-evolve-background')$$
);
