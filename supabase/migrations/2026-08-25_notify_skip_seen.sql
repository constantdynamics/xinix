-- "Gezien" betekent voortaan ook: hier wil ik geen ntfy-meldingen meer over.
--
-- Het vinkje was tot nu toe puur administratief ("ik heb ernaar gekeken").
-- Door het in de poort mee te nemen wordt het één handeling: afvinken =
-- afhandelen. Werkt voor álle meldingsbronnen tegelijk, omdat iedereen via
-- xinix_notify_gate gaat.
--
-- Net als een demping is dit absoluut: ook een hogere prioriteit breekt er
-- niet doorheen. Anders dan een demping heeft het geen einddatum — het geldt
-- zolang het vinkje staat, en verdwijnt zodra je het weghaalt.
create or replace function public.xinix_notify_gate(p_items jsonb)
 returns table(ticker text, allowed boolean, blocked_until timestamptz, last_sent_at timestamptz, last_priority smallint, last_source text, cooldown_days integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
