-- Globale notificatie-cooldown per aandeel
--
-- Probleem: er waren wél cooldowns, maar alleen per (ticker, alert_type) binnen
-- één functie. xinix-fav-alerts kent bv. 7 dagen voor "onder de limiet", 30 dagen
-- voor een 5y-low en 180 dagen voor "nieuw in de top 10" — losse tellers. Een
-- aandeel dat onder zijn limiet zakt, kort daarna een nieuwe 5y-low zet en dan de
-- top 10 binnenkomt, pingt dus drie keer in een paar dagen. Daarbovenop kende
-- dispatch-alerts alleen een cooldown van één dag, en geen enkele functie wist
-- van de meldingen van de andere functies af.
--
-- Oplossing: één centraal grootboek van verstuurde meldingen (xinix_notify_log)
-- plus twee RPC's die élke meldingsfunctie gebruikt:
--   * xinix_notify_gate(items)   → mag deze ticker nu gepingd worden?
--   * xinix_notify_record(items) → leg vast dat er gepingd is
--
-- De regel (één plek, geldt voor alle kanalen):
--   1. maximaal één melding per aandeel per cooldown-periode
--      (signal_settings.notify_cooldown_days, standaard 14 dagen);
--   2. uitzondering: een melding die urgenter is dan de urgentste melding
--      binnen die periode mag er wél door (ntfy-prioriteit 1-5). Zo blijft een
--      overname of FDA-goedkeuring doorkomen op een aandeel dat gisteren
--      "nieuw in de top 20" meldde, zonder dat het omgekeerde kan.

-- 1) Instelbare cooldown. 0 = uit (alles mag door).
ALTER TABLE public.signal_settings
  ADD COLUMN IF NOT EXISTS notify_cooldown_days integer NOT NULL DEFAULT 14;

-- 2) Grootboek van daadwerkelijk verstuurde meldingen. Alleen wegschrijven ná
--    een geslaagde verzending, anders zou een mislukte ping het aandeel 14 dagen
--    de mond snoeren.
CREATE TABLE IF NOT EXISTS public.xinix_notify_log (
  id        bigserial PRIMARY KEY,
  ticker    text        NOT NULL,
  source    text        NOT NULL,          -- welke edge function pingde
  alert_key text,                          -- signal_type / alert_type, voor debugging
  priority  smallint    NOT NULL DEFAULT 3,-- ntfy-prioriteit 1-5
  sent_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS xinix_notify_log_ticker_sent_idx
  ON public.xinix_notify_log (ticker, sent_at DESC);

-- RLS aan zonder policy = alleen de service-role (edge functions) erbij.
ALTER TABLE public.xinix_notify_log ENABLE ROW LEVEL SECURITY;

-- 3) De poort. Input: [{ticker, priority}], output één rij per unieke ticker.
--    allowed=false betekent: binnen de cooldown al een even urgente of urgentere
--    melding verstuurd.
CREATE OR REPLACE FUNCTION public.xinix_notify_gate(p_items jsonb)
RETURNS TABLE (
  ticker        text,
  allowed       boolean,
  blocked_until timestamptz,
  last_sent_at  timestamptz,
  last_priority smallint,
  last_source   text,
  cooldown_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cfg AS (
    SELECT GREATEST(COALESCE((SELECT s.notify_cooldown_days FROM signal_settings s WHERE s.id = 1), 14), 0) AS days
  ),
  items AS (
    SELECT upper(btrim(x->>'ticker')) AS tk,
           MAX(COALESCE((x->>'priority')::smallint, 3::smallint)) AS priority
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) x
    WHERE COALESCE(btrim(x->>'ticker'), '') <> ''
    GROUP BY 1
  ),
  hits AS (
    SELECT i.tk,
           MAX(l.sent_at)  AS last_sent_at,
           MAX(l.priority) AS max_priority
    FROM items i
    JOIN xinix_notify_log l
      ON upper(l.ticker) = i.tk
     AND l.sent_at > now() - make_interval(days => (SELECT days FROM cfg))
    GROUP BY i.tk
  ),
  newest AS (
    SELECT DISTINCT ON (h.tk) h.tk, l.source
    FROM hits h
    JOIN xinix_notify_log l ON upper(l.ticker) = h.tk AND l.sent_at = h.last_sent_at
    ORDER BY h.tk, l.id DESC
  )
  SELECT i.tk,
         (h.tk IS NULL OR i.priority > h.max_priority),
         h.last_sent_at + make_interval(days => (SELECT days FROM cfg)),
         h.last_sent_at,
         h.max_priority,
         n.source,
         (SELECT days FROM cfg)
  FROM items i
  LEFT JOIN hits h   ON h.tk = i.tk
  LEFT JOIN newest n ON n.tk = i.tk;
$$;

-- 4) Vastleggen. Input: [{ticker, source, alert_key, priority}].
CREATE OR REPLACE FUNCTION public.xinix_notify_record(p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO xinix_notify_log (ticker, source, alert_key, priority)
  SELECT upper(btrim(x->>'ticker')),
         COALESCE(NULLIF(btrim(x->>'source'), ''), 'onbekend'),
         NULLIF(btrim(x->>'alert_key'), ''),
         LEAST(GREATEST(COALESCE((x->>'priority')::smallint, 3::smallint), 1::smallint), 5::smallint)
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) x
  WHERE COALESCE(btrim(x->>'ticker'), '') <> '';
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Het grootboek hoeft niet eeuwig te groeien; een jaar is ruim genoeg voor de
  -- langste cooldown die iemand redelijkerwijs instelt.
  DELETE FROM xinix_notify_log WHERE sent_at < now() - interval '365 days';
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.xinix_notify_gate(jsonb)   FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.xinix_notify_record(jsonb) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.xinix_notify_gate(jsonb)   TO service_role;
GRANT  EXECUTE ON FUNCTION public.xinix_notify_record(jsonb) TO service_role;

-- 5) Baseline: de meldingen die xinix-fav-alerts recent al verstuurd heeft
--    tellen mee, anders zou de eerste run na deze migratie alsnog een ronde
--    dubbele pings sturen voor aandelen die net gepingd zijn.
INSERT INTO public.xinix_notify_log (ticker, source, alert_key, priority, sent_at)
SELECT upper(s.ticker), 'fav-alerts', s.alert_type,
       CASE s.alert_type
         WHEN 'top20_limit' THEN 3
         WHEN 'top10_limit' THEN 4
         WHEN 'low_3y'      THEN 4
         ELSE 5
       END,
       s.last_alert_at
FROM public.xinix_fav_alert_state s
WHERE s.last_alert_at > now() - interval '30 days'
  AND NOT EXISTS (
    SELECT 1 FROM public.xinix_notify_log l
    WHERE upper(l.ticker) = upper(s.ticker) AND l.sent_at = s.last_alert_at
  );
