-- Reverse splits in het Potje.
--
-- Na een reverse split (ENLV 1:15, BMGL 1:12, AEHL 1:16, NFE 1:50, CIIT 1:10)
-- stonden posities nog op de oude basis: 0,70 instap tegen een koers van 4,64
-- leek +566%, en de sim nam daar winst op. poll-prices legt de splits die Yahoo
-- meldt voortaan vast in xinix_splits en xinix_apply_splits() zet de posities
-- meteen op de nieuwe basis: aantal ÷ f, instap/stop/winstdoel × f, met
-- f = oud/nieuw aantal aandelen. Wat al gesloten is op een koers ná de split
-- krijgt ook een gecorrigeerde opbrengst, en de cash van de strategie schuift
-- evenveel mee.

ALTER TABLE public.signal_tickers ADD COLUMN IF NOT EXISTS price_currency text;
COMMENT ON COLUMN public.signal_tickers.price_currency IS
  'Munt waarin signal_price_summary de koers bewaart (Londen altijd GBp/pence), gezet door poll-prices.';

CREATE TABLE IF NOT EXISTS public.xinix_splits (
  ticker      text        NOT NULL,
  split_date  date        NOT NULL,
  numerator   numeric     NOT NULL CHECK (numerator > 0),   -- nieuwe aandelen (Yahoo)
  denominator numeric     NOT NULL CHECK (denominator > 0), -- oude aandelen (Yahoo)
  ref_close   numeric,                                      -- eerste slotkoers ná de split, al aangepast
  source      text        NOT NULL DEFAULT 'yahoo',
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  applied_at  timestamptz,
  PRIMARY KEY (ticker, split_date)
);
ALTER TABLE public.xinix_splits ENABLE ROW LEVEL SECURITY;

-- Per positie en split: wat er veranderd is. Ook de sleutel die voorkomt dat
-- een positie twee keer wordt omgerekend.
CREATE TABLE IF NOT EXISTS public.xinix_split_adjustments (
  ticker         text        NOT NULL,
  split_date     date        NOT NULL,
  kind           text        NOT NULL CHECK (kind IN ('sim', 'paper')),
  position_id    bigint      NOT NULL,
  strategy_id    integer,
  factor         numeric     NOT NULL,
  old_qty        numeric,
  old_avg_price  numeric,
  old_return_usd numeric,
  old_return_pct numeric,
  cash_delta     numeric     NOT NULL DEFAULT 0,
  applied_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, position_id, ticker, split_date)
);
ALTER TABLE public.xinix_split_adjustments ENABLE ROW LEVEL SECURITY;

-- Tickers met een open positie: poll-prices haalt die even vaak op als favorieten.
CREATE OR REPLACE FUNCTION public.xinix_held_tickers()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT ticker), '{}') FROM (
    SELECT ticker FROM xinix_strategy_positions WHERE closed_at IS NULL
    UNION
    SELECT ticker FROM xinix_paper_positions WHERE closed_at IS NULL
  ) t;
$$;

-- Deelverkopen omrekenen: qty_sold ÷ f; een deelverkoop die ná de split op de
-- nieuwe koers plaatsvond had een f× te hoge opbrengst.
CREATE OR REPLACE FUNCTION public.xinix_split_partials(
  partials jsonb, avg_price numeric, f numeric, split_date date,
  OUT nieuw jsonb, OUT delta numeric)
LANGUAGE sql STABLE
AS $$
  WITH e AS (
    SELECT el,
      coalesce((el->>'qty_sold')::numeric, 0) AS q,
      coalesce((el->>'net_proceeds')::numeric, 0) AS n,
      nullif(el->>'at', '')::timestamptz AS at
    FROM jsonb_array_elements(coalesce(partials, '[]'::jsonb)) el
  ), x AS (
    SELECT el, q, n,
      (at IS NOT NULL AND at::date >= split_date AND q > 0 AND n > 0 AND avg_price > 0
        AND abs(ln(n / (q * 0.999) / (avg_price * f))) < abs(ln(n / (q * 0.999) / avg_price))) AS na_split
    FROM e
  )
  SELECT coalesce(jsonb_agg(el || jsonb_build_object(
           'qty_sold', q / f,
           'net_proceeds', CASE WHEN na_split THEN round(n / f, 4) ELSE n END)), '[]'::jsonb),
         coalesce(sum(CASE WHEN na_split THEN round(n / f, 4) - n ELSE 0 END), 0)
  FROM x;
$$;

CREATE OR REPLACE FUNCTION public.xinix_apply_splits()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  tx CONSTANT numeric := 0.001;
  s record;
  p record;
  f numeric;
  prijs_na timestamptz;
  pre boolean;
  uitstellen boolean;
  pa record;
  delta numeric;
  n_pos int := 0;
  n_klaar int := 0;
  n_wacht int := 0;
BEGIN
  FOR s IN SELECT * FROM xinix_splits WHERE applied_at IS NULL ORDER BY split_date LOOP
    f := s.denominator / s.numerator;
    uitstellen := false;
    SELECT updated_at INTO prijs_na FROM signal_price_summary WHERE ticker = s.ticker;

    FOR p IN
      SELECT sp.id, sp.strategy_id, sp.qty, sp.avg_price, sp.entry_date, sp.closed_at, sp.closed_price,
             sp.return_usd, sp.return_pct, sp.partial_exits, 'sim'::text AS kind
      FROM xinix_strategy_positions sp
      WHERE sp.ticker = s.ticker
        AND (sp.closed_at IS NULL OR sp.closed_at::date >= s.split_date)
        AND coalesce(sp.closed_reason, '') NOT LIKE '%artefact%'
      UNION ALL
      SELECT pp.id, NULL::integer, pp.qty, pp.avg_price, pp.entry_date, pp.closed_at, pp.closed_price,
             pp.return_usd, pp.return_pct, pp.partial_exits, 'paper'
      FROM xinix_paper_positions pp
      WHERE pp.ticker = s.ticker
        AND (pp.closed_at IS NULL OR pp.closed_at::date >= s.split_date)
        AND coalesce(pp.closed_reason, '') NOT LIKE '%artefact%'
    LOOP
      CONTINUE WHEN EXISTS (SELECT 1 FROM xinix_split_adjustments a
        WHERE a.kind = p.kind AND a.position_id = p.id AND a.ticker = s.ticker AND a.split_date = s.split_date);
      -- Gekocht op de oude koers? Vóór de splitdatum altijd; in de dagen erna
      -- alleen als de instap dichter bij de oude dan bij de nieuwe koers lag
      -- (de opgeslagen koers loopt soms een paar dagen achter).
      pre := p.entry_date::date < s.split_date
        OR coalesce(p.entry_date::date <= s.split_date + 10 AND s.ref_close > 0 AND p.avg_price > 0
            AND abs(ln(p.avg_price * f / s.ref_close)) < abs(ln(p.avg_price / s.ref_close)), false);
      CONTINUE WHEN NOT pre;

      IF p.closed_at IS NULL THEN
        -- Pas omrekenen als de opgeslagen koers al van ná de split is, anders
        -- lijkt de positie tijdelijk f× gezakt.
        IF prijs_na IS NULL OR prijs_na::date < s.split_date THEN
          uitstellen := true;
          CONTINUE;
        END IF;
      ELSE
        -- Gesloten ná de split: alleen als de slotkoers al de nieuwe koers was.
        CONTINUE WHEN p.closed_price IS NULL OR p.closed_price <= 0 OR p.avg_price <= 0
          OR abs(ln(p.closed_price / (p.avg_price * f))) >= abs(ln(p.closed_price / p.avg_price));
      END IF;

      SELECT * INTO pa FROM xinix_split_partials(p.partial_exits, p.avg_price, f, s.split_date);
      delta := pa.delta;
      IF p.closed_at IS NOT NULL THEN
        delta := delta + p.qty * p.closed_price * (1 - tx) * (1 / f - 1);
      END IF;

      IF p.kind = 'sim' THEN
        UPDATE xinix_strategy_positions SET
          qty = qty / f, avg_price = avg_price * f,
          stop_loss_price = stop_loss_price * f, take_profit_price = take_profit_price * f,
          partial_exits = pa.nieuw,
          return_usd = CASE WHEN closed_at IS NULL THEN NULL ELSE return_usd + delta END,
          return_pct = CASE WHEN closed_at IS NULL THEN NULL
            ELSE (return_usd + delta) / nullif((qty + coalesce((SELECT sum((e->>'qty_sold')::numeric) FROM jsonb_array_elements(partial_exits) e), 0)) * avg_price * (1 + tx), 0) * 100 END
        WHERE id = p.id;
        IF delta <> 0 THEN
          UPDATE xinix_strategy_state SET cash = cash + delta WHERE strategy_id = p.strategy_id;
        END IF;
      ELSE
        UPDATE xinix_paper_positions SET
          qty = qty / f, avg_price = avg_price * f, stop_loss_price = stop_loss_price * f,
          partial_exits = pa.nieuw,
          return_usd = CASE WHEN closed_at IS NULL THEN NULL ELSE return_usd + delta END,
          return_pct = CASE WHEN closed_at IS NULL THEN NULL
            ELSE (return_usd + delta) / nullif((qty + coalesce((SELECT sum((e->>'qty_sold')::numeric) FROM jsonb_array_elements(partial_exits) e), 0)) * avg_price * (1 + tx), 0) * 100 END
        WHERE id = p.id;
        IF delta <> 0 THEN
          UPDATE xinix_paper_state SET cash = cash + delta WHERE id = 1;
        END IF;
      END IF;

      INSERT INTO xinix_split_adjustments
        (ticker, split_date, kind, position_id, strategy_id, factor, old_qty, old_avg_price, old_return_usd, old_return_pct, cash_delta)
      VALUES (s.ticker, s.split_date, p.kind, p.id, p.strategy_id, f, p.qty, p.avg_price, p.return_usd, p.return_pct, delta);
      n_pos := n_pos + 1;
    END LOOP;

    IF uitstellen THEN
      n_wacht := n_wacht + 1;
    ELSE
      UPDATE xinix_splits SET applied_at = now() WHERE ticker = s.ticker AND split_date = s.split_date;
      UPDATE xinix_price_flags SET resolved = true,
        note = format('split %s:%s van %s verwerkt', s.numerator, s.denominator, s.split_date)
      WHERE ticker = s.ticker AND NOT coalesce(resolved, false);
      n_klaar := n_klaar + 1;
    END IF;
  END LOOP;

  IF n_klaar + n_wacht > 0 THEN
    INSERT INTO signal_runs (job, ok, message, finished_at, metrics)
    VALUES ('xinix-apply-splits', true,
      format('%s split(s) verwerkt, %s posities omgerekend, %s wacht(en) op een koers van na de split', n_klaar, n_pos, n_wacht),
      now(), jsonb_build_object('splits', n_klaar, 'positions', n_pos, 'waiting', n_wacht));
  END IF;
  RETURN format('%s split(s), %s posities, %s wachtend', n_klaar, n_pos, n_wacht);
END;
$$;

-- Door poll-prices aangeroepen voor elke split die Yahoo meldt. Een split die
-- binnen een maand van een al bekende ligt is dezelfde (Yahoo en onze eigen
-- registratie verschillen soms een paar dagen); die slaan we over, anders zou
-- een positie twee keer omgerekend worden.
CREATE OR REPLACE FUNCTION public.xinix_record_split(
  p_ticker text, p_split_date date, p_numerator numeric, p_denominator numeric, p_ref_close numeric)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_numerator <= 0 OR p_denominator <= 0 OR p_numerator = p_denominator THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM xinix_splits WHERE ticker = p_ticker
             AND split_date BETWEEN p_split_date - 30 AND p_split_date + 30) THEN
    RETURN false;
  END IF;
  INSERT INTO xinix_splits (ticker, split_date, numerator, denominator, ref_close)
  VALUES (p_ticker, p_split_date, p_numerator, p_denominator, p_ref_close);
  PERFORM xinix_apply_splits();
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.xinix_apply_splits() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xinix_record_split(text, date, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xinix_held_tickers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xinix_apply_splits() TO service_role;
GRANT EXECUTE ON FUNCTION public.xinix_record_split(text, date, numeric, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.xinix_held_tickers() TO service_role;

-- Vangnet vóór de trade- (22:00) en sim-run (22:30): splits die wachtten op een
-- verse koers alsnog verwerken.
SELECT cron.unschedule('xinix-apply-splits')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xinix-apply-splits');
SELECT cron.schedule('xinix-apply-splits', '50 21 * * *', $$SELECT public.xinix_apply_splits()$$);
