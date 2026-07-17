# Briefing: uitgebreide scan naar "5-sterren-type" aandelen

> Deze briefing is bedoeld om in een nieuwe Claude-chat te plakken. Hij is
> zelfstandig leesbaar: alles wat de chat nodig heeft staat erin, er is geen
> toegang tot de Xinix-database nodig. Gebaseerd op een analyse (2026-07-17)
> van de 13 aandelen met een 5-sterren rating in `xinix_favorites`.

## Missie

Doorzoek de markt (web search, screeners, nieuwsbronnen) naar aandelen die passen bij
mijn beleggingsprofiel hieronder. Lever een gerangschikte shortlist van 15–30 kandidaten,
ingedeeld per archetype. Wees grondig: gebruik meerdere zoekstrategieën en screeners,
niet één enkele query. VS-noteringen hebben de voorkeur, maar ASX/TSX/Europese
small caps mogen ook.

## Mijn profiel (het "5-sterren-DNA")

Ik zoek aandelen die aan dit kernpatroon voldoen:

1. **Bewezen explosiviteit**: het aandeel heeft in de afgelopen 5 jaar minimaal één
   enorme koersrun laten zien — de verhouding 5-jaarstop / 5-jaarsbodem is idealiter
   ≥ 20× (minimaal 10×).
2. **Diep gecrasht**: de koers staat nu 60–99% onder de 5-jaarstop (mediaan van mijn
   huidige selectie: -85%).
3. **Verse dip als instapmoment**: het aandeel is de afgelopen 1–2 maanden opnieuw
   hard gedaald (typisch -20% tot -40% in ~22 handelsdagen). Ik koop "dip op dip".
4. **Substantie**: liever een echt bedrijf met omzet, activa of een late-stage pijplijn
   dan een leeg omhulsel. Market cap bij voorkeur $25 mln – $10 mrd; zoet punt rond
   $100 mln – $3 mrd.
5. **Sectoren**: biotech/healthcare, crypto/AI-infrastructuur (miners, datacenters),
   tech-hardware (optica, componenten), mining/grondstoffen-exploratie, cleantech/
   industrie. Géén banken, vastgoed, dividendaandelen of defensieve consumentennamen.
6. **Liquiditeit**: gemiddeld dagvolume ≥ ~500k stuks (of ≥ ~$1 mln omzet per dag).

## De vier archetypen (verdeel de shortlist hierover)

### Archetype 1 — De herstelde reus in terugval (zwaartepunt: kwaliteit)

- Market cap $1–10 mrd
- Staat 10–60× boven de 5-jaarsbodem (comeback is al bewezen) maar nog 40–75% onder de top
- Heeft echte omzet, winstgevend segment, of fase-3/goedgekeurd product
- Recent 25–45% teruggevallen vanaf een lokale top (winstnemingen, sector-rotatie,
  eenmalige tegenvaller — geen existentiële crisis)
- Voorbeelden uit mijn huidige selectie: Applied Optoelectronics (AAOI), TeraWulf (WULF),
  uniQure (QURE), Nektar Therapeutics (NKTR)

### Archetype 2 — De capitulatie-bodemvisser (loterijbriefjes)

- 90–99% onder de 5-jaarstop, koers op of vlak bij de 5-jaarsbodem
- Market cap $20–500 mln (onder de $20 mln alleen bij uitzonderlijk verhaal)
- Er moet een aanwijsbare overlevingsreden zijn: cash runway ≥ 12 maanden, recente
  financiering, partner/strategische investeerder, of aanstaande katalysator
  (data-uitlezing, FDA-beslissing, contract)
- Voorbeelden: Novavax (NVAX), Veru (VERU), FingerMotion (FNGR)

### Archetype 3 — De spike-machine microcap

- Market cap $25–300 mln
- Historie van herhaalde explosieve spikes (meerdere runs van +100% of meer in 5 jaar)
- Zweeft nu tussen bodem en top in, recent gedaald
- Vaak: exploratie-mining met boorprogramma, microcap-biotech met pijplijn,
  niche-hardware met contractnieuws
- Voorbeelden: Quantum Cyber (QUCY), Cobre (CBE.AX), KULR Technology (KULR),
  Broadwind (BWEN)

### Archetype 4 — De crypto/AI-infra cycler

- Bitcoin-miners, HPC/AI-datacenterconversies, crypto-adjacente infrastructuur
- Hoge bèta op BTC en op AI-capex-nieuws; recent hard gedaald met de sector mee
- Let op: schuldpositie en verwatering zijn hier de killers — rapporteer die expliciet
- Voorbeelden: HIVE Digital (HIVE.TO), TeraWulf (WULF)

## Harde uitsluitingen (red flags)

- Reverse split in de afgelopen 12 maanden puur om delisting te vermijden
- Actieve delisting-procedure of koers < $0,10 zonder concreet reddingsplan
- Going-concern-waarschuwing zónder financiering of katalysator
- Chinese reverse-merger shells en bekende pump-and-dump-namen
- Market cap < $20 mln én dagvolume < 100k (dubbel illiquide)
- SPAC's zonder operationeel bedrijf

## Al in bezit / al beoordeeld — NIET opnieuw aandragen

AAOI, BWEN, CBE.AX, FNGR, HIVE.TO, KULR, NKTR, NOTV, NVAX, QUCY, QURE, VERU, WULF

## Werkwijze (belangrijk: meerdere invalshoeken)

Zoek minimaal langs deze vijf routes en combineer de resultaten:

1. **Screeners**: zoek naar "biggest 1-month losers" met market cap > $25 mln op
   Nasdaq/NYSE/AMEX; filter daarna handmatig op het 5-jaars crash+range-profiel.
2. **52-week-low lijsten** in biotech, mining en tech — check per naam of de
   5-jaars-range ≥ 10× is.
3. **Sectornieuws**: recente sector-brede sell-offs (biotech-indexdalingen, BTC-dips,
   AI-capex-schrik) en welke individuele namen daarin het hardst geraakt zijn.
4. **Katalysator-kalenders**: FDA/PDUFA-data, fase-3-uitlezingen, boorprogramma's,
   earnings van gecrashte namen in de komende 1–3 maanden.
5. **"Fallen angels"**: aandelen die ooit > $1 mrd waard waren en nu > 90% lager staan,
   maar nog steeds een werkend bedrijf hebben.

## Output per kandidaat

Geef een tabel met per aandeel:

- Ticker, bedrijf, beurs, market cap
- Sector/industrie en één zin wat het bedrijf doet
- % onder 5-jaarstop en × boven 5-jaarsbodem (de crash- en explosiviteitsmaat)
- Koersverandering laatste ~22 handelsdagen
- Archetype (1–4)
- Katalysator of overlevingsreden (concreet, met datum indien bekend)
- Belangrijkste risico in één zin
- Score 1–10 op fit met mijn profiel

Sluit af met: top-5 aanbevelingen over alle archetypen heen, met per naam 2–3 zinnen
onderbouwing, en benoem expliciet welke namen loterijbriefjes zijn (archetype 2) versus
kwaliteitskern (archetype 1).

## Toon en diepgang

- Wees kritisch, geen cheerleading: een naam die het patroon matcht maar een fatale
  balans heeft, hoort bij de uitsluitingen met één regel uitleg.
- Controleer koersdata via meerdere bronnen als iets onwaarschijnlijk lijkt.
- Nederlands als voertaal.
