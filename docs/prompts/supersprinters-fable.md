# Opdracht: SUPERsprinters

> Prompt voor een nieuwe Claude Code-sessie met Claude Fable 5.2 op de repo `constantdynamics/xinix`.
> Opgesteld op 13 november 2026 op basis van de antwoorden van de gebruiker.

## Wat de gebruiker wil

Bouw onder Favorieten een nieuw sub-tabblad **SUPERsprinters** (link `?tab=favorieten&sub=supersprinters`).
Het zoekt aandelen die bij Saxo Investor te koop zijn en die binnen 10 handelsdagen +50% kunnen maken, en het
meldt de beste. Het moet beter werken dan het bestaande tabblad ⚡ Sprinters. "Beter" betekent voor de
gebruiker vier dingen:

1. **Vaker raak per melding.** Liever één melding die klopt dan drie die niet kloppen.
2. **Eerder erbij.** Een aandeel staat bovenaan vóór de eerste grote sprongdag, niet erna.
3. **Een duidelijke volgorde bovenin.** De beste kandidaten zijn van elkaar te onderscheiden.
4. **Kansen die kloppen.** Staat er 15%, dan is ongeveer 15 van de 100 raak.

Een sprinter blijft gedefinieerd als het event `h14` van de explosie-motor: binnen 10 handelsdagen een slot van
minstens +50% boven het slot van de voorspeldag, en de handelsdag daarna nog minstens +20%. Zo blijven de
resultaten vergelijkbaar met het track record van Sprinters.

De nieuwe code is van jou en het ontwerp is aan jou. Bestaande code pas je alleen aan waar het nodig is, en het
gedrag van bestaande functies en tabbladen blijft gelijk, op de uitzondering bij "Wat je zelf mag doen" na.
Begin met meten (het track record en het verbruik), ontwerp en test daarna, en bouw pas dan de productieversie.

## Keuzes van de gebruiker (13 november 2026)

- **Universum**: alle aandelen op de 20 Saxo-markten die Xinix kent (`MARKETS` in
  `supabase/functions/_shared/universe.ts`), dus ook buiten de favorieten en de watchlist, en ook meldingen over
  zulke aandelen. Op 26 september wilde de gebruiker de motor alleen voor ≥4★ laten draaien. Die beperking
  vervalt voor SUPERsprinters, ook voor het meten van nieuws. Voor Sprinters zelf blijft ze gelden.
- **Te koop bij Saxo Investor**: een vaste lijst beurzen plus uitsluitingen: geen OTC, warrants, rechten, units,
  preferente aandelen, fondsen of ETF's, en geen SPAC zonder eigen bedrijf. De TradingView-filter in `tvMarket`
  (alleen primaire gewone aandelen) is een begin. De gebruiker kan NIOB.CN niet kopen bij Saxo, dus de Canadian
  Securities Exchange (CSE, suffix `.CN`, 567 aandelen in `xinix_universe`) valt eruit. Controleer de rest van de
  lijst één keer tegen Saxo's eigen overzicht en noteer de bron. Twijfel je of Saxo een beurs aanbiedt
  (bijvoorbeeld NEO in Canada), zet dat dan in je rapport.
- **Minimumkoers $0,50**, alleen voor SUPERsprinters, omgerekend naar dollars (let op pence, ZAc en ILA; zie
  `_shared/units.ts`). De ondergrens voor de omzet blijft $10.000 per dag, zoals in Sprinters. FNGR, een van de
  drie geslaagde Sprinters-meldingen, kostte $0,15 en valt hier dus buiten. Sprinters zelf blijft zoals het is.
- **Model**: alles mag: nieuwe kenmerken, een ander soort model, een andere kalibratie. Voorwaarde: een eerlijke
  test op een periode die het model niet heeft gezien laat zien dat het beter is dan het huidige `h14`-model, op
  dezelfde aandelen en dezelfde dagen.
- **Bronnen**: wat Xinix al heeft, plus gratis bronnen zoals short interest (FINRA), aankopen door bestuurders
  (SEC Form 4), de FDA-kalender en het aantal vrij verhandelbare aandelen. Claude via de API om nieuws te lezen
  mag alleen als het aantoonbaar minder dan $1 per dag kost (zie "Wat je eerst vraagt").
- **Meldingen**: hoogstens 3 per week en vanaf 15%, zoals nu. Alleen SUPERsprinters meldt, zodra het in de
  eerlijke test beter blijkt dan Sprinters. Vanaf dat moment stopt Sprinters met melden; tot die tijd meldt
  Sprinters zoals nu.
- **Hartje**: een hartje in SUPERsprinters zet het aandeel bij de favorieten en op de watchlist met
  `no_sim = true`, zoals `adopt` in `xinix-crypto`. De papieren portefeuille koopt het dus niet. Er gaat niets
  vanzelf naar de watchlist; `universe_auto_add` blijft uit.
- **Middelen**: de gebruiker vraagt uitdrukkelijk om een slim mechanisme, zodat de database en de andere middelen
  geen problemen krijgen. Zie "Zuinig met middelen".

## Hoe het er nu voor staat (gemeten op 13 november 2026)

- `xinix-sprint` (`supabase/functions/xinix-sprint/index.ts`, pg_cron `20 */2 * * 1-5`) scoort de 150
  favorieten met ≥4★ met het `h14`-model van de explosie-motor (`_shared/engine.ts`, gekalibreerd op 10 jaar
  dagkoersen van de pool in `xinix_event_pool`), maal een gemeten nieuws-lift. Achtergrond:
  `docs/explosie-motor-rapport.md` en de changelog in CLAUDE.md (25 en 26 september).
- Track record (`xinix_sprint_predictions`, sinds 26 september): 5.192 voorspellingen, waarvan 3.361 afgerekend.
  Er waren 38 trefdagen bij 8 aandelen (STAK 13, ATGL 10, FNGR 5, RGC 3, OHB.DE 3, NMRA 2, KOD 1, NIOB.CN 1).
  34 daarvan vielen in de bovenste 14% van de voorspellingen (kans ≥ 6%). De groep vanaf 10% voorspelde
  gemiddeld 14% en haalde 5,8%. Tussen 2 en 6% viel geen enkele treffer in 1.114 voorspellingen. De basiskans in
  deze periode was 1,1%.
- Meldingen: 15, waarvan 10 afgerekend en 3 raak (FNGR 28 september, ATGL 20 oktober, STAK 26 oktober).
- Bovenin verzadigt het model: de kalibratie geeft iedereen in de hoogste kansgroep dezelfde waarde, en nu staan
  zeven aandelen op 14,8 à 14,9%.
- Nieuws: van de 9 groepen in `xinix_sprint_news_lift` telt alleen `sec_8k` mee (lift 0,50, dus een lagere kans).
  De andere groepen hebben te weinig berichten, omdat alleen nieuws van ≥4★-aandelen wordt gemeten.
- Meetfout: een voorspelling bewaart de kans van de eerste run van de dag (`ignoreDuplicates`), niet die op het
  moment van de melding. 8367.HK werd op 9 oktober gemeld, maar staat met 4% in het track record. Leg in het
  nieuwe track record ook de kans op het moment van de melding vast.
- Universum: `xinix_universe` bevat 20.559 aandelen, waarvan er 13.286 een deep-scan hebben
  (`xinix_event_history`). De dagelijkse TradingView-sweep staat sinds 26 september uit; de oude versie schreef
  elke nacht alle rijen opnieuw. De andere tabbladen lezen kansen en treffers (`p_*`, `hits`, `add_hint`) uit
  `xinix_universe` voor ≥4★. Zet de resultaten van SUPERsprinters daarom in eigen tabellen, zodat die tabbladen
  niet veranderen.
- Het live track record beslaat zeven weken en ongeveer acht explosies. Gebruik het als controle, niet om het
  model op af te stellen.

## Zuinig met middelen

Xinix draait op één Supabase-project (`zfcjugqgufsyltxhvkuu`) met Micro-compute (1 GB RAM). Op 2 november raakte
het Disk IO-budget op en liep de database vast. De gebruiker koos toen voor zuiniger werken in plaats van grotere
compute (zie de changelog). SUPERsprinters werkt straks met ongeveer 20.000 aandelen in plaats van 150, dus dit is
de belangrijkste randvoorwaarde. Ontwerp het zo dat het ruim binnen de grenzen blijft:

- Meet eerst wat de database en de bestaande jobs nu verbruiken (bijvoorbeeld `pg_stat_statements`, duur en
  fouten in `signal_runs`, de Supabase-advisors). Leg een dagbudget vast voor geschreven rijen, externe verzoeken
  en rekentijd, en laat de code dat budget zelf bewaken.
- Schrijf in grote porties in plaats van rij voor rij, schrijf alleen wat veranderd is, en gebruik
  keyset-paginering in plaats van `range()`/OFFSET op grote tabellen. Houd rijen klein en bewaar geen grote
  JSON-blobs.
- Verdeel zwaar werk over de dag en de week, buiten de drukke momenten (zie `cron.job`; op zaterdagochtend
  draaien Skyshots en Crypto). Niet elk aandeel hoeft elke dag opnieuw: kies slim wie vaker aan de beurt is.
- Bouw remmen in: een schakelaar in `signal_settings` die alles uitzet, en terugschakelen bij timeouts of fouten.
- Houd rekening met de grenzen van edge functions (CPU per aanroep en geheugen; te grote porties gaven bij
  Skyshots `WORKER_RESOURCE_LIMIT`) en van externe diensten (Yahoo, TradingView, SEC, FINRA, de daglimiet van
  ntfy). Gebruik voor SEC de bestaande User-Agent van `poll-edgar-background` (`SEC_USER_AGENT`).
- Controleer na de eerste echte runs of het verbruik binnen het budget blijft. Plan een tweede controle na een paar
  handelsdagen (een geplande taak in deze sessie mag), en zet de cijfers in je rapport.

## Hoe je test

- Ontwikkel op historische data en test op een latere periode die het model niet heeft gezien (walk-forward per
  jaar of halfjaar). Vergelijk steeds met het huidige `h14`-model op dezelfde aandelen en dagen.
- Tel explosies, niet alleen dagen: opeenvolgende dagen van hetzelfde aandeel horen bij dezelfde explosie.
  Rapporteer beide.
- Rapporteer voor beide modellen:
  1. hoe vaak een gesimuleerde melding raak is, met de echte regels (hoogstens 3 per week, vanaf 15%,
     minimumkoers, omzet, herhaalregel), en hoeveel meldingen per week dat geeft;
  2. hoeveel handelsdagen vóór de eerste grote sprongdag (bijvoorbeeld het eerste slot ≥ +20% boven het vorige)
     een aandeel al bovenaan stond;
  3. de trefkans van de top 5 en de top 10 per dag;
  4. de kalibratie: voorspeld tegen werkelijk per kansgroep, plus een score zoals Brier of log loss.
- Let op lekken (gegevens die op de voorspeldag nog niet bekend waren), survivorship bias (het universum bevat
  alleen wat nu genoteerd staat), splits en eenheidsfouten (`_shared/units.ts` en de schoonmaak in `engine.ts`)
  en stijgingen zonder volume.
- Is het nieuwe model na eerlijk testen niet beter, zet dan geen meldingen aan vanuit SUPERsprinters, en schrijf
  op wat je probeerde en waarom het niet werkte. Sprinters blijft dan melden zoals nu. Het tabblad mag wel live,
  met een duidelijke vermelding.

## Wat je zelf mag doen

Zonder te vragen: alles lezen en meten; nieuwe tabellen, kolommen, indexen, functies en edge functions toevoegen
en uitrollen; pg_cron-jobs inplannen binnen het budget; het tabblad bouwen en testen op desktop- en
telefoonbreedte; PR's maken, mergen en de deploy controleren zoals CLAUDE.md beschrijft; CLAUDE.md en `docs/`
bijwerken. Sprinters blijft verder zoals het is, met één uitzondering: zodra de meldingen van SUPERsprinters aan
gaan, zet je die van Sprinters uit, op een manier die met één instelling terug te draaien is. De kansberekening en
het tabblad Sprinters veranderen niet.

## Wat je eerst vraagt

Vraag het de gebruiker eerst, of sla het over en zet het in je rapport:

- data of tabellen wissen (DELETE, DROP, TRUNCATE). Supabase vraagt daarvoor een bevestiging die via de telefoon
  niet aankomt; ontwerp het zo dat het niet nodig is;
- het gedrag van andere bestaande functies of tabbladen veranderen;
- de compute vergroten, of iets anders dat geld kost;
- een API-sleutel. Past Claude voor nieuws binnen $1 per dag, reken dat dan voor met echte aantallen en de
  huidige prijzen, kies een model dat erbinnen past en bouw een dagplafond in de code. Vraag de gebruiker de
  sleutel zelf in Supabase te zetten (Edge Functions → Secrets, `ANTHROPIC_API_KEY`); laat hem nooit in de chat
  plakken. Zonder sleutel moet alles gewoon werken.

## Afmaken

Stop niet zolang er nog werk openstaat dat de gebruiker heeft gevraagd. Een tussenstand is welkom, en een open
keuze mag je voorleggen, maar ga door met het werk dat niet van het antwoord afhangt. Merk je dat je de gebruiker
uitnodigt om bij te sturen of aanbiedt te wachten, ga dan verder met het volgende deel. Gewone obstakels, zoals
fouten, timeouts, lege resultaten of een dienst die even niet antwoordt, onderzoek je eerst en los je op met wat
je hebt: wachten en opnieuw proberen, het verzoek aanpassen, een andere bron. Een grens die bewust is gesteld (zie
hierboven) laat je staan: zeg wat je vond en zoek een andere veilige weg. Dit verandert niets aan de bevestiging
die nodig is voor riskante of onomkeerbare stappen.

## Klaar is

- SUPERsprinters staat live onder Favorieten, werkt op telefoonbreedte en toont per aandeel de kans, de redenen,
  het nieuws, de beurs, de koers en de omzet, plus het eigen track record naast dat van Sprinters.
- Een tik op een melding opent SUPERsprinters op dat aandeel.
- Staan de meldingen van SUPERsprinters aan, dan staan die van Sprinters uit, terug te zetten met één instelling.
- Het nieuwe track record legt per aandeel per dag de kans en de instapkoers vast, en bij een melding ook de kans
  op dat moment.
- `docs/supersprinters-rapport.md` bevat de testresultaten en het gemeten verbruik. CLAUDE.md heeft een regel in
  de changelog (§8), de nieuwe tabellen (§7) en de nieuwe jobs (§2).
- De PR is gemerged, en "Sync to deploy branch" en "Deploy to GitHub Pages" zijn groen.

## Communicatie

Zeg aan het begin in een regel wat je gaat doen, en geef onderweg af en toe een korte stand van zaken. Schrijf het
eindrapport in het Nederlands, voor iemand die je werk niet heeft gezien: eerst de uitkomst (is het beter, met
cijfers, en wat staat er live), dan wat er nog openstaat en hoe je het terugzet. Gebruik gewone woorden en
volledige zinnen, en geen namen of afkortingen die je zelf tijdens het werk hebt bedacht.
