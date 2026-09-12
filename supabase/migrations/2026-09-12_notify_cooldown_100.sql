-- Standaard afkoelperiode van 14 naar 100 dagen
--
-- De cooldown stond ingebouwd op 14 dagen en in productie handmatig op 30. Dat
-- bleek nog steeds te druk: 93 aandelen zaten binnen het 30-daagse venster. Op
-- verzoek is 100 dagen de nieuwe standaard, zodat hetzelfde aandeel hooguit
-- eens per ruim drie maanden pingt — tenzij de melding urgenter is dan de
-- vorige, want die uitzondering blijft ongemoeid.
--
-- Drie plekken moeten mee, anders is "standaard" maar half waar:
--   1. de kolom-default (nieuwe installaties);
--   2. de COALESCE-fallback in xinix_notify_gate (ontbrekende instellingenrij);
--   3. de bestaande rij in signal_settings (deze installatie).
-- De UI-fallbacks in Settings.tsx en notify-log gaan in dezelfde commit mee.

-- 1) Kolom-default.
ALTER TABLE public.signal_settings
  ALTER COLUMN notify_cooldown_days SET DEFAULT 100;

-- 2) Fallback in de poort. Verder ongewijzigd t.o.v. 2026-08-25_notify_skip_seen:
--    demping en "gezien" blijven absoluut, een hogere prioriteit breekt er wel door.
CREATE OR REPLACE FUNCTION public.xinix_notify_gate(p_items jsonb)
 RETURNS TABLE(ticker text, allowed boolean, blocked_until timestamp with time zone, last_sent_at timestamp with time zone, last_priority smallint, last_source text, cooldown_days integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT GREATEST(COALESCE((SELECT s.notify_cooldown_days FROM signal_settings s WHERE s.id = 1), 100), 0) AS days
  ),
  items AS (
    SELECT upper(btrim(x->>'ticker')) AS tk,
           MAX(COALESCE((x->>'priority')::smallint, 3::smallint)) AS priority
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) x
    WHERE COALESCE(btrim(x->>'ticker'), '') <> ''
    GROUP BY 1
  ),
  muted AS (
    SELECT upper(m.ticker) AS tk, m.muted_until
    FROM xinix_notify_mute m
    WHERE m.muted_until IS NULL OR m.muted_until > now()
  ),
  seen AS (
    SELECT DISTINCT upper(s.ticker) AS tk FROM xinix_seen s
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
         (mu.tk IS NULL AND sn.tk IS NULL AND (h.tk IS NULL OR i.priority > h.max_priority)),
         CASE WHEN mu.tk IS NOT NULL
              THEN COALESCE(mu.muted_until, 'infinity'::timestamptz)
              WHEN sn.tk IS NOT NULL
              THEN 'infinity'::timestamptz
              ELSE h.last_sent_at + make_interval(days => (SELECT days FROM cfg))
         END,
         h.last_sent_at,
         h.max_priority,
         n.source,
         (SELECT days FROM cfg)
  FROM items i
  LEFT JOIN hits h   ON h.tk = i.tk
  LEFT JOIN newest n ON n.tk = i.tk
  LEFT JOIN muted mu ON mu.tk = i.tk
  LEFT JOIN seen sn  ON sn.tk = i.tk;
$function$;

-- 3) Deze installatie stond nog op 30.
UPDATE public.signal_settings SET notify_cooldown_days = 100 WHERE id = 1;
