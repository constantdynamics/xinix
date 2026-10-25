-- Watchlist-opschoning, deel 1 van 2: alles wat niets wist. Na de skyshot-scan van 22 okt. zijn de 102
-- aandelen waar Yahoo geen (verse) koers meer voor had nagelopen op overnames, faillissementen en nieuwe
-- tickers. Keuzes van de gebruiker (24–25 okt. 2026): 1c dubbele/oude tickers wissen, 2a overzetten naar
-- de opvolger, 3a overgenomen, failliete en stilgevallen aandelen op inactief zonder hartje, 4a posities
-- ongedaan die gekocht zijn toen het aandeel al niet meer handelde (ook SAVE.L) en 5a niets meer kopen
-- wat een week niet handelt. Supabase vraagt bij het wissen van rijen om een bevestiging die niet bij de
-- gebruiker aankwam, dus het wissen staat apart in 2026-10-25_watchlist_cleanup_wissen.sql. Tot dat draait
-- staan de oude hartjes nog in xinix_favorites, op een inactief aandeel.
-- Alles wat verandert staat eerst als momentopname in xinix_watchlist_cleanup, met het plan erbij.

create table if not exists public.xinix_watchlist_cleanup (
  id bigserial primary key,
  ticker text not null,
  actie text not null check (actie in ('verwijderd', 'opgevolgd', 'opvolger', 'inactief', 'positie_ongedaan')),
  opvolger text,
  toelichting text,
  plan jsonb,
  snapshot jsonb,
  created_at timestamptz not null default now()
);
alter table public.xinix_watchlist_cleanup enable row level security;
revoke all on public.xinix_watchlist_cleanup from anon, authenticated;

do $$
begin
  if exists (select 1 from xinix_watchlist_cleanup) then
    raise exception 'de opschoning is al uitgevoerd';
  end if;
  if exists (select 1 from xinix_strategy_positions
             where closed_at is null and (ticker in ('CRNX', 'NOTV', 'LSH') or (ticker = 'SAVE.L' and entry_date >= '2026-07-01'))
               and partial_exits is not null and partial_exits <> '[]'::jsonb)
     or exists (select 1 from xinix_paper_positions
                where closed_at is null and ticker = 'SAVE.L' and entry_date >= '2026-07-01'
                  and partial_exits is not null and partial_exits <> '[]'::jsonb) then
    raise exception 'onverwacht: een te annuleren positie heeft deelverkopen';
  end if;
end $$;

-- ── 4a: posities die gekocht zijn terwijl het aandeel al niet meer handelde ──────────────────────
-- De koerspuller hield een bevroren slotkoers vers. Zo kocht het Potje CRNX op 2–10 okt. (laatste
-- handelsdag 31 aug.), NOTV op 29 jun. (failliet, handel gestopt 10 jun.), LSH op 22 sep. (heette sinds
-- 4 aug. QNME) en SAVE.L van 18 aug. tot 26 sep. (geen handel sinds 30 jun.; Yahoo geeft elke dag
-- 5,51 pence met volume 0). Ongedaan tegen de instapprijs: de inleg plus 0,1% kosten gaan terug.
with v as (
  select * from xinix_strategy_positions
  where closed_at is null and (ticker in ('CRNX', 'NOTV', 'LSH') or (ticker = 'SAVE.L' and entry_date >= '2026-07-01'))
), logged as (
  insert into xinix_watchlist_cleanup (ticker, actie, toelichting, snapshot)
  select ticker, 'positie_ongedaan', 'Potje: gekocht terwijl het aandeel al niet meer handelde; inleg en kosten terug', to_jsonb(v)
  from v
), refund as (
  update xinix_strategy_state s set cash = s.cash + r.bedrag
  from (select strategy_id, sum(qty * avg_price * 1.001) as bedrag from v group by strategy_id) r
  where s.strategy_id = r.strategy_id
)
update xinix_strategy_positions p
set closed_at = now(), closed_price = p.avg_price, return_usd = 0, return_pct = 0,
    hold_days = greatest(0, floor(extract(epoch from now() - p.entry_date) / 86400))::int,
    closed_reason = case p.ticker
      when 'CRNX' then 'Ongedaan: gekocht na de laatste handelsdag (31 aug.); overgenomen door Vertex'
      when 'NOTV' then 'Ongedaan: gekocht na het faillissement (laatste handelsdag 10 jun.)'
      when 'LSH' then 'Ongedaan: gekocht nadat LSH al QNME heette (laatste handelsdag 3 aug.)'
      else 'Ongedaan: gekocht terwijl SAVE.L niet handelde (laatste handelsdag 30 jun., koers bevroren op 5,51 pence)'
    end
from v where p.id = v.id;

with v as (
  select * from xinix_paper_positions where closed_at is null and ticker = 'SAVE.L' and entry_date >= '2026-07-01'
), logged as (
  insert into xinix_watchlist_cleanup (ticker, actie, toelichting, snapshot)
  select ticker, 'positie_ongedaan', 'Papieren portefeuille: gekocht terwijl het aandeel al niet meer handelde; inleg en kosten terug', to_jsonb(v)
  from v
), refund as (
  update xinix_paper_state s set cash = s.cash + r.bedrag
  from (select sum(qty * avg_price * 1.001) as bedrag from v having count(*) > 0) r
  where s.id = 1
)
update xinix_paper_positions p
set closed_at = now(), closed_price = p.avg_price, return_usd = 0, return_pct = 0,
    hold_days = greatest(0, floor(extract(epoch from now() - p.entry_date) / 86400))::int,
    closed_reason = 'Ongedaan: gekocht terwijl SAVE.L niet handelde (laatste handelsdag 30 jun., koers bevroren op 5,51 pence)'
from v where p.id = v.id;

-- ── 3a: overgenomen, failliet of stilgevallen → inactief ────────────────────────────────────────
-- Het hartje wist deel 2; in de favorietenlijst staat een inactief aandeel nu al niet meer.
with d(ticker, reden) as (values
  ('AMWD', 'opgegaan in MasterBrand (MBC), mei 2026'),
  ('APGE', 'overgenomen door AbbVie voor $135,11, sep. 2026'),
  ('APLS', 'overgenomen door Biogen voor $41 + CVR, mei 2026'),
  ('ASRT', 'overgenomen door Zydus voor $23,50, jun. 2026'),
  ('ATAI', 'overgenomen door Eli Lilly voor $6,75 + CVR, sep. 2026'),
  ('AVNS', 'overgenomen door American Industrial Partners voor $25, jul. 2026'),
  ('CFX.TO', 'overgenomen door Canfor, mrt. 2026'),
  ('CRNX', 'overgenomen door Vertex voor $85, sep. 2026'),
  ('DAWN', 'overgenomen door Servier voor $21,50, mei 2026'),
  ('DV.V', 'opgegaan in Contango Silver & Gold (CTGO), mrt. 2026'),
  ('EEX', 'overgenomen door Apollo voor $5,03, jul. 2026'),
  ('ESPR', 'overgenomen door ARCHIMED voor $3,16 + CVR, jul. 2026'),
  ('FARM', 'overgenomen door Royal Cup voor $1,29, mei 2026'),
  ('FBRX', 'overgenomen door argenx voor $77, aug. 2026'),
  ('HLX', 'samengegaan met Hornbeck Offshore (HOS), sep. 2026'),
  ('KORE', 'overgenomen door Searchlight/Abry voor $9,25, jul. 2026'),
  ('LEG', 'opgegaan in Somnigroup (SGI), aug. 2026'),
  ('LIS.V', 'project verkocht, aandelen ingekocht voor C$0,505 en bedrijf opgeheven, 2026'),
  ('LPRO', 'overgenomen door ANV Group voor $3,15, jul. 2026'),
  ('LPSN', 'opgegaan in SoundHound AI (SOUN), sep. 2026'),
  ('MRCC', 'opgegaan in Horizon Technology Finance (HRZN), apr. 2026'),
  ('NCSM', 'opgegaan in Weatherford (WFRD), sep. 2026'),
  ('NGD', 'opgegaan in Coeur Mining (CDE), mrt. 2026'),
  ('OLPX', 'overgenomen door Henkel, ±jul. 2026'),
  ('SECU.V', 'overgenomen door Allied Universal voor C$4,41, jul. 2026'),
  ('SKYT', 'overgenomen door IonQ voor $15 + IONQ-aandelen, jul. 2026'),
  ('SLNO', 'overgenomen door Neurocrine voor $53, mei 2026'),
  ('TALK', 'overgenomen door Universal Health Services voor $5,25, aug. 2026'),
  ('UDMY', 'opgegaan in Coursera (COUR), mei 2026'),
  ('UHG', 'overgenomen door Stanley Martin voor $1,18, mei 2026'),
  ('NOTV', 'failliet (Chapter 11, jun. 2026), de aandelen vervallen'),
  ('GOCO', 'failliet (Chapter 11, jun. 2026), alleen nog OTC (GOCOQ)'),
  ('SNBR', 'failliet, alleen nog OTC (SNBRQ)'),
  ('ABVE', 'van Nasdaq naar OTC (ABVEF)'),
  ('SBEV', 'geen handel meer sinds 21 aug. 2026, oorzaak niet gevonden'),
  ('AREN', 'geen handel meer sinds 28 aug. 2026, oorzaak niet gevonden'),
  ('ADG.V', 'geen handel meer op de TSXV sinds 14 sep. 2026, alleen nog OTC (ARCUF)'),
  ('GREE', 'Yahoo kent het aandeel niet meer, oorzaak niet gevonden'),
  ('CLE', 'kapotte invoer zonder bedrijfsnaam of beurs')
), logged as (
  insert into xinix_watchlist_cleanup (ticker, actie, toelichting, snapshot)
  select t.ticker, 'inactief', d.reden,
         jsonb_build_object('signal_tickers', to_jsonb(t),
                            'favoriet', (select to_jsonb(f) from xinix_favorites f where f.ticker = t.ticker))
  from signal_tickers t join d using (ticker)
)
update signal_tickers t
set active = false, updated_at = now(),
    notes = concat_ws(E'\n', nullif(t.notes, ''), 'Van de watchlist gehaald op 25 okt. 2026: ' || d.reden || '.')
from d where t.ticker = d.ticker;

-- ── 2a: nieuwe naam, ticker of beurs → opvolger op de watchlist, oude op inactief ──────────────
-- Hartje, sterren en notitie gaan mee. De aankooplimiet alleen bij dezelfde munt, zonder bekende
-- reverse split en als de koers bij de overgang hooguit ×3 verschilt (anders is de aandelenbasis
-- waarschijnlijk veranderd); zonder limiet vult compute-extremes zelf 5-jaarsbodem +10% in.
insert into xinix_watchlist_cleanup (ticker, actie, opvolger, toelichting, plan, snapshot)
select t.ticker, 'opgevolgd', m.nieuw, m.reden,
       jsonb_build_object('bedrijf', m.bedrijf, 'beurs', m.beurs, 'munt_oud', m.munt_oud, 'munt_nieuw', m.munt_nieuw,
                          'koers_nieuw', m.koers_nieuw, 'split', m.split),
       jsonb_build_object('signal_tickers', to_jsonb(t),
                          'signal_price_summary', (select to_jsonb(s) from signal_price_summary s where s.ticker = t.ticker),
                          'favoriet', (select to_jsonb(f) from xinix_favorites f where f.ticker = t.ticker))
from (values
  ('AII.TO', 'ALM', 'Almonty Industries Inc.', 'NasdaqCM', 'CAD', 'USD', 8.75, false, 'Almonty verhuisde van de TSX naar Nasdaq'),
  ('LSH', 'QNME', 'Quanome Technologies, Inc.', 'NasdaqCM', 'USD', 'USD', 0.4427, false, 'Lakeside Holding heet sinds 4 aug. 2026 Quanome Technologies'),
  ('ATLN', 'CIRC', 'Circle8 Group, Inc.', 'NasdaqGM', 'USD', 'USD', 0.2889, false, 'Atlantic International heet sinds jul. 2026 Circle8 Group'),
  ('BOLT.CN', 'IRON.CN', '26 Metals Inc.', 'Canadian Sec', 'CAD', 'CAD', 0.395, false, 'Bolt Metals heet sinds 19 aug. 2026 26 Metals'),
  ('0RAG.L', 'ABNX.PA', 'ABIONYX Pharma SA', 'Paris', 'EUR', 'EUR', 1.604, false, 'de Londense nevennotering handelde nauwelijks; de hoofdnotering is Euronext Parijs'),
  ('AGAE', 'AIFA', 'All In FutureTech Alliance Inc.', 'NasdaqCM', 'USD', 'USD', 4.16, false, 'Allied Gaming & Entertainment heet sinds mei 2026 All In FutureTech Alliance'),
  ('AGH', 'PUSA', 'Powerus Corporation', 'NasdaqCM', 'USD', 'USD', 1.96, false, 'Aureus Greenway heet sinds de fusie van 1 okt. 2026 Powerus'),
  ('APM', 'NIKI', 'Niki BioSolutions, Inc.', 'NasdaqCM', 'USD', 'USD', 1.86, true, 'Aptorum fuseerde in jul. 2026 met DiamiR tot Niki BioSolutions (reverse split 1:10)'),
  ('BMET.V', 'LTNG.V', 'Lightning Resource Corp.', 'TSXV', 'CAD', 'CAD', 0.26, false, 'BeMetals heet sinds 31 jul. 2026 Lightning Resource'),
  ('COEP', 'ZSQR', 'Z Squared Inc.', 'NasdaqGM', 'USD', 'USD', 3.95, false, 'Coeptis fuseerde in 2026 met Z Squared'),
  ('CYCN', 'KRSA', 'Korsana Biosciences, Inc.', 'NasdaqCM', 'USD', 'USD', 33.43, true, 'Cyclerion fuseerde met Korsana Biosciences (reverse split 1:7)'),
  ('EDCU.V', 'EDCU.TO', 'Edge Copper Corporation', 'Toronto', 'CAD', 'CAD', 0.38, false, 'Edge Copper verhuisde van de TSXV naar de TSX'),
  ('EVTV', 'AZIO', 'Azio AI Holdings, Inc.', 'NasdaqCM', 'USD', 'USD', 0.9302, false, 'Envirotech Vehicles heet sinds jul. 2026 Azio AI Holdings'),
  ('FLT.V', 'FLT.TO', 'Volatus Aerospace Inc.', 'Toronto', 'CAD', 'CAD', 0.5, false, 'Volatus Aerospace verhuisde van de TSXV naar de TSX'),
  ('TALA.V', 'TALA.TO', 'Talamore Mining Corp.', 'Toronto', 'CAD', 'CAD', 6.34, false, 'Talamore Mining verhuisde van de TSXV naar de TSX'),
  ('FMT.V', 'TALA.TO', 'Talamore Mining Corp.', 'Toronto', 'CAD', 'CAD', 6.34, false, 'Fuerte Metals heet sinds jun. 2026 Talamore Mining en verhuisde naar de TSX'),
  ('FW.V', 'FW.CN', 'Flow Capital Corp.', 'Canadian Sec', 'CAD', 'CAD', 1.09, false, 'Flow Capital verhuisde van de TSXV naar de CSE'),
  ('GAMB', 'GRSD', 'Grandstand Limited', 'NasdaqGM', 'USD', 'USD', 1.28, false, 'Gambling.com Group heet nu Grandstand'),
  ('GIG', 'HDRN', 'Hadron Energy, Inc.', 'NasdaqCM', 'USD', 'USD', 0.741, false, 'de SPAC GigCapital7 fuseerde in mei 2026 met Hadron Energy'),
  ('GLXY.TO', 'GLXY', 'Galaxy Digital Inc.', 'NasdaqGS', 'CAD', 'USD', 15.29, false, 'Galaxy Digital verhuisde van de TSX naar Nasdaq'),
  ('HOTH', 'RKTO', 'Rocket One Inc.', 'NasdaqCM', 'USD', 'USD', 0.5325, false, 'Hoth Therapeutics heet sinds 28 mei 2026 Rocket One'),
  ('ISSC', 'IA', 'Innovative Aerosystems, Inc.', 'NasdaqGS', 'USD', 'USD', 19.47, false, 'Innovative Solutions and Support heet nu Innovative Aerosystems'),
  ('JFB', 'XTND', 'Xtend AI Robotics, Inc.', 'NYSE', 'USD', 'USD', 1.73, false, 'JFB Construction fuseerde in sep. 2026 met Xtend tot Xtend AI Robotics'),
  ('KFS', 'KWY', 'Kingsway Corporation', 'NYSE', 'USD', 'USD', 9.87, false, 'Kingsway Financial Services heet sinds 19 mei 2026 Kingsway Corporation'),
  ('KSM.V', 'RUC.CN', 'Radiant Uranium Corp.', 'Canadian Sec', 'CAD', 'CAD', 0.105, false, 'Kirkstone Metals heet sinds 6 aug. 2026 Radiant Uranium en verhuisde naar de CSE'),
  ('LC', 'HAPN', 'Happen, Inc.', 'NasdaqGS', 'USD', 'USD', 14.505, false, 'LendingClub heet nu Happen'),
  ('LIXT', 'NMAD', 'NOMAD Power Solutions, Inc.', 'NasdaqCM', 'USD', 'USD', 3.6, false, 'Lixte Biotechnology heet sinds jul. 2026 NOMAD Power Solutions'),
  ('MAI.V', 'MAI.TO', 'Mining Americas Inc.', 'Toronto', 'CAD', 'CAD', 4.12, false, 'Minera Alamos heet sinds jun. 2026 Mining Americas en verhuisde naar de TSX'),
  ('MEG', 'ONT', 'Onterris, Inc.', 'NYSE', 'USD', 'USD', 14.64, false, 'Montrose Environmental heet nu Onterris'),
  ('MSW', 'PMA', 'PMA Graphene Technology Group Inc.', 'NasdaqCM', 'USD', 'USD', 1.285, false, 'Ming Shing handelt sinds 9 jul. 2026 als PMA'),
  ('RARE.V', 'TREO', 'Tactical Resources Corp.', 'NasdaqCM', 'CAD', 'USD', 1.64, false, 'Tactical Resources verhuisde naar Nasdaq'),
  ('SKBL', 'KAZR', 'Skyline Builders Group Holding Limited', 'NasdaqCM', 'USD', 'USD', 1.66, false, 'Skyline Builders handelt nu als KAZR'),
  ('SKLZ', 'FIRY', 'Firy Inc.', 'NYSE', 'USD', 'USD', 11.62, false, 'Skillz heet sinds 22 jun. 2026 Firy'),
  ('SLVR.V', 'SLVR.TO', 'Silver Tiger Metals Inc.', 'Toronto', 'CAD', 'CAD', 0.73, false, 'Silver Tiger verhuisde van de TSXV naar de TSX'),
  ('SNSE', 'FTH', 'Faeth Therapeutics, Inc.', 'NasdaqCM', 'USD', 'USD', 20.1, false, 'Sensei Biotherapeutics heet sinds 16 jun. 2026 Faeth Therapeutics'),
  ('SRA.V', 'ARO.V', 'Arc Mineral Royalties Ltd.', 'TSXV', 'CAD', 'CAD', 0.8, false, 'Stria Lithium heet nu Arc Mineral Royalties'),
  ('STSS', 'SKYA', 'SkyAI, Inc.', 'NasdaqCM', 'USD', 'USD', 2.87, false, 'Sharps Technology heet sinds 28 mei 2026 SkyAI'),
  ('TBH', 'HODO', 'House of Doge Inc.', 'NasdaqCM', 'USD', 'USD', 0.0683, false, 'Brag House fuseerde in jul. 2026 met House of Doge'),
  ('TIN.V', 'AURO.V', 'Auro Metals Inc.', 'TSXV', 'CAD', 'CAD', 1.4, false, 'Tincorp Metals heet sinds 11 jun. 2026 Auro Metals'),
  ('TOI', 'STLN', 'Starling Oncology, Inc.', 'NasdaqCM', 'USD', 'USD', 6.91, false, 'The Oncology Institute heet sinds 4 aug. 2026 Starling Oncology'),
  ('URC.TO', 'UROY', 'Uranium Royalty Corp.', 'NasdaqCM', 'CAD', 'USD', 3.38, false, 'Uranium Royalty handelt alleen nog op Nasdaq'),
  ('USEG', 'BSIN', 'Big Sky Industrial Inc.', 'NasdaqCM', 'USD', 'USD', 1.52, false, 'U.S. Energy heet sinds jun. 2026 Big Sky Industrial'),
  ('VSCO', 'VSXY', 'Victoria''s Secret & Co.', 'NYSE', 'USD', 'USD', 88.42, false, 'Victoria''s Secret handelt nu als VSXY'),
  ('WKEY', 'WQEY', 'WISeQey Corp.', 'NasdaqGM', 'USD', 'USD', 8.85, false, 'WISeKey heet nu WISeQey'),
  ('XWIN', 'XMAX', 'XMax Inc.', 'NasdaqCM', 'USD', 'USD', 8.75, false, 'XMax handelt nu als XMAX'),
  ('YOOV', 'CIGL', 'Concorde International Group Ltd.', 'NasdaqCM', 'USD', 'USD', 0.2057, false, 'Concorde International Group handelt nu als CIGL'),
  ('ZBAI', 'AUC', 'ATIF Holdings Limited', 'NasdaqCM', 'USD', 'USD', 8.55, false, 'ATIF Holdings handelt nu als AUC')
) as m(oud, nieuw, bedrijf, beurs, munt_oud, munt_nieuw, koers_nieuw, split, reden)
join signal_tickers t on t.ticker = m.oud;

-- Opvolgers die al op de watchlist stonden (inactief, uit de explosie-motor) eerst vastleggen.
insert into xinix_watchlist_cleanup (ticker, actie, toelichting, snapshot)
select t.ticker, 'opvolger', 'bestond al; weer actief gezet', jsonb_build_object('signal_tickers', to_jsonb(t))
from signal_tickers t
where t.ticker in (select opvolger from xinix_watchlist_cleanup where actie = 'opgevolgd');

-- Eén bronrij per opvolger; voor TALA.TO is dat TALA.V (2★, ouder dan het hartje op FMT.V). Nieuwe
-- opvolgers komen erbij, bestaande worden weer actief. Het UPDATE ziet de nieuwe rijen van het INSERT
-- in dezelfde opdracht niet, dus raakt alleen de opvolgers die er al stonden.
with bron as (
  select distinct on (c.opvolger)
         c.opvolger as nieuw, c.ticker as oud, c.toelichting as reden, c.plan,
         o.sector, o.notes, o.buy_limit, o.crypto_cat, o.no_sim, o.modality, o.disease_area, o.phase,
         o.market_cap_bucket, o.commodity, o.jurisdiction, o.deposit_type, o.yahoo_sector, o.yahoo_industry,
         (c.plan->>'munt_oud' = c.plan->>'munt_nieuw' and not (c.plan->>'split')::boolean and o.buy_limit is not null
          and ps.last_close > 0 and ps.last_close / (c.plan->>'koers_nieuw')::numeric between 1 / 3.0 and 3) as limiet_mee
  from xinix_watchlist_cleanup c
  join signal_tickers o on o.ticker = c.ticker
  left join signal_price_summary ps on ps.ticker = c.ticker
  where c.actie = 'opgevolgd'
  order by c.opvolger, (c.ticker = 'TALA.V') desc
), nieuw as (
  insert into signal_tickers (ticker, company, sector, exchange, active, notes, buy_limit, crypto_cat, no_sim,
                              modality, disease_area, phase, market_cap_bucket, commodity, jurisdiction, deposit_type,
                              yahoo_sector, yahoo_industry)
  select b.nieuw, b.plan->>'bedrijf', b.sector, b.plan->>'beurs', true,
         concat_ws(E'\n', 'Opvolger van ' || b.oud || ': ' || b.reden || '. Op de watchlist sinds 25 okt. 2026.', nullif(b.notes, '')),
         case when b.limiet_mee then b.buy_limit end,
         b.crypto_cat, coalesce(b.no_sim, false), b.modality, b.disease_area, b.phase, b.market_cap_bucket,
         b.commodity, b.jurisdiction, b.deposit_type, b.yahoo_sector, b.yahoo_industry
  from bron b
  where not exists (select 1 from signal_tickers t where t.ticker = b.nieuw)
  returning ticker
)
update signal_tickers t
set active = true, company = b.plan->>'bedrijf', exchange = b.plan->>'beurs', sector = b.sector,
    buy_limit = case when b.limiet_mee then b.buy_limit else t.buy_limit end,
    crypto_cat = coalesce(t.crypto_cat, b.crypto_cat),
    price_benched = false, price_fail_count = 0, updated_at = now(),
    notes = concat_ws(E'\n', nullif(t.notes, ''),
                      'Weer actief op 25 okt. 2026 als opvolger van ' || b.oud || ': ' || b.reden || '.', nullif(b.notes, ''))
from bron b
where t.ticker = b.nieuw;

insert into xinix_favorites (ticker, created_at, rating)
select c.opvolger, min(f.created_at), max(f.rating)
from xinix_watchlist_cleanup c
join xinix_favorites f on f.ticker = c.ticker
where c.actie = 'opgevolgd'
group by c.opvolger
on conflict (ticker) do update set rating = greatest(xinix_favorites.rating, excluded.rating);

update signal_tickers t
set active = false, updated_at = now(),
    notes = concat_ws(E'\n', nullif(t.notes, ''), 'Opgevolgd door ' || c.opvolger || ' op 25 okt. 2026: ' || c.toelichting || '.')
from xinix_watchlist_cleanup c
where c.actie = 'opgevolgd' and t.ticker = c.ticker;

-- ── 1c: oude tickers en nevennoteringen waarvan de opvolger al op de watchlist staat ────────────
-- Nu inactief, deel 2 wist ze helemaal. Hartje en sterren gaan bewust niet mee naar de opvolger.
with w(ticker, opvolger) as (values
  ('0SZI.L', 'CRBP'), ('0T6G.L', 'QTTB'), ('ALTS', 'AIFC'), ('GCMDA.AX', 'GCM.AX'), ('GGA.V', 'GORO.V'),
  ('HMMC.V', 'HMMC.TO'), ('MIGI', 'BGDE'), ('NICU.V', 'NICU.TO'), ('MJRX.CN', 'MJRX-X.CN'), ('ASGN', 'EFOR'),
  ('EKSO', 'CHRN'), ('VBIX', 'QXL'), ('NBY', 'SDEV'), ('BITF.TO', 'KEEL')
), logged as (
  insert into xinix_watchlist_cleanup (ticker, actie, opvolger, toelichting, snapshot)
  select t.ticker, 'inactief', w.opvolger, 'oude ticker of nevennotering; de opvolger stond al op de watchlist (wordt gewist)',
         jsonb_build_object('signal_tickers', to_jsonb(t),
                            'favoriet', (select to_jsonb(f) from xinix_favorites f where f.ticker = t.ticker))
  from signal_tickers t join w using (ticker)
)
update signal_tickers t
set active = false, updated_at = now(),
    notes = concat_ws(E'\n', nullif(t.notes, ''), 'Van de watchlist gehaald op 25 okt. 2026: oude ticker of nevennotering van ' || w.opvolger || '.')
from w where t.ticker = w.ticker;

-- ── 5a: laatste echte handelsdag ────────────────────────────────────────────────────────────────
-- Yahoo geeft voor een geschorst of verdwenen aandeel de laatste koers gewoon terug, en de koerspuller
-- zette updated_at dan op nu. poll-prices vult hier de datum van de laatste dagkoers met volume; de
-- simulaties kopen niets dat bij het ophalen een week stil lag, en Favorieten dimt zo'n aandeel.
alter table public.signal_price_summary add column if not exists last_trade_date date;
