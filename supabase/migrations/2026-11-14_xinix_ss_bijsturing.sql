-- SUPERsprinters: de bijsturing krijgt een opstartregel, en de startwaarde is hersteld.
--
-- De bijsturing is één getal waarmee alle kansen worden bijgesteld: de verhouding tussen wat uitkwam
-- en wat voorspeld was over de laatste 120 dagen (plus de 16 dagen die een voorspelling nodig heeft).
--
-- 1. Startwaarde hersteld. Het model kreeg ×1,022 mee als startwaarde. Dat bleek de waarde van een
--    willekeurige rij te zijn (21 mei 2026); op de laatste dag van de onderzoeksdata (13 november 2026)
--    was de bijsturing ×0,892. Hersteld in public/ss-model.json (mult_seed) en in
--    scripts/supersprinters/onderzoek/final_eval.py. Gevolg van de fout: op de eerste dag stonden de
--    hoogste kansen ongeveer 2 punten te hoog (25% waar 23% hoort).
--
-- 2. Opstartregel. Zolang het eigen track record nog geen vol venster beslaat (85 handelsdagen), telt
--    de startwaarde mee voor het ontbrekende deel, met 20 verwachte treffers per ontbrekende dag (zoveel
--    verwacht de kopgroep gemiddeld per dag). Zonder die regel bepalen de eerste paar dagen met
--    uitkomsten de bijsturing bijna helemaal. Nagerekend op 2019–2026
--    (scripts/supersprinters/onderzoek/productie_check.py): na 10 dagen wijkt de verhouding dan 40 tot
--    50% af van die over het volle venster; met de regel blijft hij binnen ongeveer 10%.
create or replace function public.xinix_ss_calib_refresh(p_seed numeric)
returns jsonb
language plpgsql
set search_path = public
as $$
declare sp numeric; sy numeric; n integer; nd integer; w numeric; m numeric; v jsonb;
begin
  select coalesce(sum(prob_base) / 100.0, 0), coalesce(sum(case when hit then 1 else 0 end), 0), count(*), count(distinct made_on)
    into sp, sy, n, nd
    from public.xinix_ss_predictions
   where resolved_at is not null and hit is not null and made_on >= current_date - 136;
  w := 15 + 20.0 * greatest(0, 85 - nd);
  m := least(2.0, greatest(0.5, (sy + w * p_seed) / (sp + w)));
  v := jsonb_build_object('mult', round(m, 3), 'n', n, 'days', nd, 'expected', round(sp, 2), 'hits', sy,
                          'seed', p_seed, 'prior', round(w, 1), 'at', now());
  insert into public.xinix_ss_state (key, value, updated_at) values ('calib', v, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v;
end $$;

-- De stand bijwerken naar de herstelde startwaarde (er zijn nog geen eigen uitkomsten).
select public.xinix_ss_calib_refresh(0.8924561);

-- 3. De eerste dag (de sessie van 13 november) is nog met de oude startwaarde gescoord. Omgerekend naar
--    de herstelde startwaarde, zodat het tabblad en het track record kloppen met wat het model nu
--    rekent. De uitkomsten van die dag zijn nog niet bekend, dus dit is geen bijstellen achteraf. De kans
--    die in de drie meldingen van 14 november stond (alerted_prob) blijft staan zoals hij verstuurd is.
--    Rekent vanuit prob_base (de kans vóór de bijsturing), dus nog een keer uitvoeren verandert niets.
update public.xinix_ss_scores s
   set prob = round(100 * (case when q.p > 0.15 then 0.15 + 0.75 * (q.p - 0.15) else q.p end), 2)
  from (select ticker, (o * 0.8924561) / (1 + o * 0.8924561) as p
          from (select ticker, (prob_base / 100.0) / (1 - prob_base / 100.0) as o
                  from public.xinix_ss_scores
                 where session_date = date '2026-11-13' and prob_base is not null) x) q
 where s.ticker = q.ticker;

update public.xinix_ss_predictions p
   set prob = round(100 * (case when q.p > 0.15 then 0.15 + 0.75 * (q.p - 0.15) else q.p end), 2)
  from (select ticker, (o * 0.8924561) / (1 + o * 0.8924561) as p
          from (select ticker, (prob_base / 100.0) / (1 - prob_base / 100.0) as o
                  from public.xinix_ss_predictions
                 where made_on = date '2026-11-13' and prob_base is not null and resolved_at is null) x) q
 where p.ticker = q.ticker and p.made_on = date '2026-11-13';
