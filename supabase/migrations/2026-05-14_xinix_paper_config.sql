-- xinix_paper_config: dynamische configuratie voor de enkelvoudige portefeuille.
-- Wordt wekelijks bijgewerkt door xinix-knowledge-export wanneer de simulatie
-- consistent betere parameterwaarden laat zien dan de huidige config.

CREATE TABLE IF NOT EXISTS xinix_paper_config (
  id                     SMALLINT      PRIMARY KEY DEFAULT 1,
  target_positions       SMALLINT      NOT NULL DEFAULT 8,
  position_size_usd      NUMERIC(10,2) NOT NULL DEFAULT 1200,
  cash_reserve_usd       NUMERIC(10,2) NOT NULL DEFAULT 200,
  hold_days              SMALLINT      NOT NULL DEFAULT 60,
  stop_loss              NUMERIC(6,4)  NOT NULL DEFAULT 0.15,
  partial_tp_pct         NUMERIC(6,4)  NOT NULL DEFAULT 0.25,
  entry_min_score        SMALLINT      NOT NULL DEFAULT 65,
  entry_limit_buffer     NUMERIC(6,4)  NOT NULL DEFAULT 0.10,
  signal_decay_loss_pct  NUMERIC(6,2)  NOT NULL DEFAULT -3,
  signal_decay_min_days  SMALLINT      NOT NULL DEFAULT 20,
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by             TEXT          NOT NULL DEFAULT 'seed'
);

-- Altijd precies één rij
INSERT INTO xinix_paper_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Wekelijkse mini-export: elke maandag 06:30 UTC
-- Stuurt mini=true zodat de function alleen config + CLAUDE.md bijwerkt (geen DB snapshot)
DO $$
BEGIN
  PERFORM cron.unschedule('xinix-mini-export-weekly')
  FROM cron.job WHERE jobname = 'xinix-mini-export-weekly';
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

SELECT cron.schedule(
  'xinix-mini-export-weekly',
  '30 6 * * 1',
  $$SELECT net.http_post(
    url := current_setting('xinix.functions_url', true) || '/xinix-knowledge-export',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('xinix.cron_secret', true)
    ),
    body := '{"mini":true}'::jsonb
  )$$
);
