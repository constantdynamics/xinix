# SUPERsprinters: rapport (13–14 november 2026)

SUPERsprinters is een tabblad onder Favorieten dat op alle beurzen die Saxo aanbiedt de aandelen zoekt
die binnen 10 handelsdagen minstens 50% kunnen stijgen, en meldt over de beste. Een treffer is hetzelfde
als bij Sprinters: het slot komt binnen 10 handelsdagen minstens 50% boven het slot van de dag van de
voorspelling, en staat een dag later nog minstens 20% hoger.

Dit rapport is geschreven voor iemand die het werk niet heeft gezien. Alle cijfers zijn na te rekenen
met de scripts in `scripts/supersprinters/` (zie hoofdstuk 12).

## 1. Uitkomst in het kort

**Het nieuwe model is beter dan het model van Sprinters, op alle vier de punten die gevraagd waren.**
Gemeten op 2025 en 2026, twee jaren die het nieuwe model nooit heeft gezien, op precies dezelfde
aandelen en dagen (5,7 miljoen aandeel-dagen, 7.615 sprongen):

| Punt | Model van Sprinters | Nieuw model |
|---|---|---|
| 1. Meer raak per melding (vanaf 15%, hoogstens 3 per week) | 41 van 285 = 14,4% | 44 van 243 = 18,1% |
| 2. Eerder: stond het aandeel de dag vóór de eerste grote sprongdag al in de top 50? | 5,0% | 7,2% |
| 3. Volgorde bovenaan: de vijf hoogste kansen van elke dag | 16,1% raak | 18,7% raak |
| 4. Kansen kloppen: voorspeld 15–25% | 21,8% voorspeld, 15,2% werkelijk | 16,8% voorspeld, 15,6% werkelijk |

Het verschil is echt maar bescheiden. De volgorde bovenaan is met 95% zekerheid beter (+2,6 punten,
tussen +0,2 en +5,1). Het model van Sprinters had deze twee jaren bovendien al gezien toen het gemaakt
werd; tegen datzelfde model zonder die voorkennis is het verschil +5,6 punten (tussen +3,1 en +7,9).
In 2026 alleen is het verschil met het model zoals het nu draait klein (hoofdstuk 3).

**Wat er live staat**

- Het tabblad Favorieten → ⚡⚡ SUPERsprinters, ook op telefoonbreedte. Per aandeel: kans, redenen,
  nieuws, beurs, koers, omzet; daaronder het eigen track record naast dat van Sprinters en de uitkomst
  van de test.
- Elke handelsdag drie rondes over ongeveer 20.000 aandelen, een ochtendmelding en het afrekenen van het
  track record. Dat kost de database ongeveer een kwart procent van wat hij per dag al schrijft.
- **De meldingen van SUPERsprinters staan aan en die van Sprinters staan uit** sinds 14 november. De
  eerste drie meldingen zijn die dag verstuurd (NOMA, DRIO en DUKR). Sprinters zelf draait gewoon door;
  alleen het melden staat uit.
- **Bijgesteld op 14 november, na dit verslag** (keuzes van de gebruiker, zie hoofdstuk 5): de meldgrens
  is 20% in plaats van 15%, een melding gaat alleen uit bij minstens $100.000 omzet per dag, en de
  vastgelopen taak `xinix-deep-scan` is gerepareerd.

**Wat je moet weten voordat je op een melding koopt** (hoofdstuk 4): een melding zegt dat de kans op
zo'n sprong ongeveer 1 op 5 is, tegen 1 op 135 voor een willekeurig aandeel. Het zegt niet dat kopen
gemiddeld geld oplevert. Wie in de testjaren elke melding bij de volgende opening kocht en 10
handelsdagen vasthield, kwam gemiddeld rond nul uit en verloor op de helft van de meldingen meer dan
5 tot 13%. De meldingen zijn een lijst om te beoordelen, geen koopsignaal.

**Terugdraaien** (hoofdstuk 10): de knop "Meldingen uitzetten (Sprinters meldt dan weer)" onderaan het
tabblad zet in één keer de meldingen van SUPERsprinters uit en die van Sprinters weer aan.

## 2. Wat er nu draait

**Welke aandelen.** Alle gewone aandelen met hun eerste notering op de 20 markten die Saxo aanbiedt
(VS, Canada, 14 Europese landen, Japan, Hongkong, Singapore en Australië), ook buiten je favorieten en
de watchlist. Alleen aandelen met een koers vanaf $0,50 en een omzet vanaf $10.000 per dag doen mee
(omgerekend naar dollars; pence, Zuid-Afrikaanse cent en agorot worden goed gelezen). Op 13 november
waren dat 12.925 van de 20.028 opgehaalde aandelen. De Canadian Securities Exchange en Cboe Canada doen
niet mee (hoofdstuk 7).

**Drie rondes per handelsdag**, elk kort na het slot van de eigen beurzen (tijden in UTC; in Nederland
is dat 's winters één uur en 's zomers twee uur later):

| Ronde | Tijd | Markten | Opgehaald op 13 november | Doen mee |
|---|---|---|---|---|
| Azië en Australië | 09:18 | Japan, Hongkong, Singapore, Australië | 8.200 | 4.602 |
| Europa | 17:10 | 14 landen | 4.981 | 2.964 |
| VS en Canada | 21:36 | NASDAQ, NYSE, NYSE American, TSX, TSX Venture | 6.847 | 5.359 |

Een ronde haalt de hele markt in één keer bij de scanner van TradingView op (22 verzoeken per dag voor
alles), scoort alle aandelen in het geheugen en schrijft alleen de kopgroep weg: per regio hoogstens 100
aandelen, ongeveer 380 per dag. Is een beurs dicht, dan herkent de ronde dat aan onveranderde cijfers en
slaat hij die markt over.

**Het model** kijkt naar 43 kenmerken: hoe wild een aandeel beweegt (per dag, per week, per maand), waar
het in zijn grafiek staat (afstand tot de top en de bodem van een jaar, zes, drie en één maand), het
volume ten opzichte van normaal, de koers, de omzet, de beurs, de sector, en het klimaat op de markt (welk
deel van de aandelen in de regio en in de VS vandaag of deze maand hard gaat). Alle kenmerken komen uit
velden die TradingView elke dag levert; ze zijn veld voor veld nagerekend tegen de dagkoersen van Yahoo.
Het model is getraind op tien jaar dagkoersen van 20.410 aandelen (26,5 miljoen aandeel-dagen).

**Van modeluitkomst naar kans**, in drie stappen:

1. Een ijklijn, gemeten op testjaren die het model niet zag.
2. Een bijsturing met het eigen track record: wat uitkwam gedeeld door wat voorspeld was over de
   laatste vier maanden, begrensd tussen ×0,5 en ×2. Nu ×0,89, omdat er de laatste maanden minder
   sprongen waren dan het model verwacht. Zolang het eigen track record nog geen vier maanden beslaat,
   telt de waarde uit het onderzoek mee voor het ontbrekende deel.
3. Een demping van de allerhoogste kansen (boven 15% telt het meerdere voor driekwart).

**Nieuws** wordt opgehaald voor de bovenste twaalf aandelen van elke ronde en voor alles boven de
meldgrens, ingedeeld in soorten (uitgifte van aandelen, medisch, overname, contract, cijfers, crypto, AI,
omgekeerde split). Het wordt getoond en per voorspelling vastgelegd, maar telt nog niet mee in de kans:
eerst wordt gemeten of een soort nieuws iets toevoegt (hoofdstuk 5, punt 2).

**Meldingen.** Eén keer per dag, om 04:12 UTC (direct na de stille uren), over de slotstanden van de dag
ervoor. Alle regio's samen, de hoogste kans eerst:

- vanaf 20% (`ss_alert_min_prob`; bij de start 15%, op 14 november verhoogd);
- alleen bij een omzet van minstens $100.000 per dag (`ss_alert_min_dvol`; de lijst zelf begint bij
  $10.000);
- hoogstens 3 per week (`ss_alert_max_per_week`): een melding over de beursdag van dag d telt mee tot en
  met dag d+6;
- hetzelfde aandeel pas na 10 dagen opnieuw, tenzij de kans 5 punten hoger is;
- vóór het versturen wordt het slot bij Yahoo nagekeken; wijkt dat meer dan 3% af van TradingView, dan
  gaat de melding niet uit (anders is ook het track record niet af te rekenen);
- gedempt of gezien houdt een melding alleen tegen onder `ss_override_min_prob`. Die staat, net als bij
  Sprinters, op 15: gelijk aan de meldgrens, dus nu houden ze niets tegen. Zet hem op bijvoorbeeld 90
  als gedempt en gezien altijd moeten winnen.

Een tik op de melding opent het tabblad op dat aandeel; de knop "Koers bekijken" opent Google Finance.
Mislukt het versturen, dan blijven de kandidaten wachten en probeert de eerstvolgende ronde het opnieuw.

**Hartje.** Een hartje in het tabblad zet het aandeel bij je favorieten en op de watchlist, met de
aantekening dat het niet meedoet in het Potje en de papieren portefeuille (`no_sim`). Er wordt niets
automatisch toegevoegd. "Gezien" haalt een aandeel uit de lijst.

**Track record** (`xinix_ss_predictions`). Per aandeel per dag: de kans, de kans vóór bijsturing, de
plaats in de regio, de instapkoers (het slot), het soort nieuws, de omzet, de beurswaarde en het aantal
vrij verhandelbare aandelen. Bij een melding ook het moment, de kans en de koers van dat moment. Na 16
dagen wordt elke voorspelling met de koersen van Yahoo afgerekend: raak, en apart of de +50% is
aangeraakt zonder stand te houden.

## 3. De eerlijke test

**Opzet.** Alle 20.608 aandelen van de 20 markten, tien jaar dagkoersen van Yahoo, opgeschoond (splits,
pence en pond door elkaar, sprongen van 40 keer of meer, stijgingen zonder volume, datums in de tijdzone
van de beurs). De uitkomst per dag is op 26,1 miljoen dagen vergeleken met die van de bestaande
rekenkern van Sprinters: nul verschillen. Gemiddeld haalt een aandeel de sprong op 0,54% van de dagen
(VS 1,02%, Canada 0,65%, Azië en Australië 0,31%, Europa 0,26%; per jaar tussen 0,23% in 2018 en 0,96%
in 2020).

Elk testjaar is voorspeld door een model dat alleen eerdere jaren zag, met 16 dagen ertussen zodat geen
uitkomst over de grens lekt. De jaren 2020 tot en met 2024 zijn gebruikt om keuzes te maken; 2025 en
2026 zijn tot het eind achtergehouden en pas bekeken toen het ontwerp vaststond. Het model van Sprinters
is op twee manieren meegenomen:

- **zoals het nu draait**: met de gewichten uit productie. Die zijn gemeten op data tot en met
  september 2026, dus dit model heeft de testjaren al gezien. Dat is in zijn voordeel;
- **opnieuw gemaakt zonder voorkennis**: dezelfde methode, per testjaar opnieuw gemeten op alleen
  eerdere jaren. Dat is de eerlijke vergelijking van de methode.

De meldingen zijn nagespeeld met de echte regels (vanaf 15%, hoogstens 3 per week, herhaalregel, per dag
de hoogste kans van alle regio's eerst). Er is geteld in dagen én in sprongen: een sprong die vijf dagen
achter elkaar raak is, telt als één sprong.

**Achtergehouden jaren 2025–2026** (5.714.037 aandeel-dagen, 475 beursdagen, 7.615 sprongen):

| | Sprinters zoals het nu draait | Sprinters zonder voorkennis | Nieuw |
|---|---|---|---|
| Meldingen | 291 (3,0 per week) | geen: komt nooit boven 15% | 250 (2,6 per week) |
| Meldingen raak | 41 van 285 = 14,4% | – | 44 van 243 = 18,1% |
| Voorspeld bij die meldingen | 21,9% | – | 18,7% |
| Verschillende sprongen geraakt | 40 | – | 43 |
| Top 5 per dag raak | 16,1% | 13,1% | 18,7% |
| Top 10 per dag raak | 15,1% | 12,9% | 17,1% |
| Dag vóór de eerste sprongdag in de top 10 / 20 / 50 | 1,1 / 2,1 / 5,0% | 1,4 / 2,5 / 5,5% | 1,6 / 3,3 / 7,2% |
| In de 5 dagen ervoor ooit in de top 50 | 8,7% | 10,2% | 12,6% |
| Plaats op de dag ervoor (mediaan, van ±12.000) | 741 | 805 | 632 |
| Voorspeld 5–10% → werkelijk | 6,9 → 5,2% | 7,2 → 6,7% | 6,9 → 6,2% |
| Voorspeld 10–15% → werkelijk | 13,1 → 9,6% | – | 11,6 → 10,9% |
| Voorspeld 15–25% → werkelijk | 21,8 → 15,2% | – | 16,8 → 15,6% |
| Voorspeld boven 25% → werkelijk | – | – | 27,9 → 28,2% (39 dagen) |
| Afwijking van de kansen (Brier, ×0,0001; lager is beter) | 71,13 | 71,08 | 70,42 |
| Log loss (lager is beter) | 0,0364 | 0,0357 | 0,0334 |

De "eerste sprongdag" is de eerste dag van een sprong waarop het aandeel 20% of meer stijgt.

**Per jaar.** 2025 was een goed jaar voor het nieuwe model, 2026 een matig jaar:

| | Sprinters zoals het nu draait | Nieuw |
|---|---|---|
| 2025: meldingen raak | 27 van 156 = 17,3% | 25 van 116 = 21,6% (voorspeld 16,7%) |
| 2025: top 5 per dag | 15,9% | 20,4% |
| 2026: meldingen raak | 15 van 129 = 11,6% | 18 van 127 = 14,2% (voorspeld 20,1%) |
| 2026: top 5 per dag | 16,4% | 16,5% |

In 2026 beloofden de meldingen dus meer dan ze waarmaakten (20% tegen 14%), en was de volgorde bovenaan
niet beter dan die van het model dat dat jaar al kende. Tegen het model zonder voorkennis was het ook in
2026 beter (top 5: 16,5% tegen 12,6%).

**Ontwikkeljaren 2020–2024** (13,7 miljoen aandeel-dagen): meldingen 80 van 425 = 18,8% (voorspeld
19,2%) tegen 102 van 686 = 14,9% (voorspeld 21,8%); top 5 per dag 16,8% tegen 13,6% en 10,5%. Alles
samen, 2020–2026: 124 van 668 = 18,6% tegen 143 van 971 = 14,7%.

**Hoe zeker is dit.** De volgorde bovenaan is het hardst: bij 2.000 keer opnieuw trekken van de weken
was het nieuwe model in 98% van de gevallen beter dan Sprinters zoals het nu draait, en altijd beter dan
Sprinters zonder voorkennis. Het percentage raak bij meldingen is ruisiger: het hangt af van welke
melding toevallig de weekplek krijgt, en schuift bij een kleine wijziging 3 tot 4 punten. Reken dus op
"ongeveer 1 op 5 à 6", niet op precies 18,1%.

**Beperkingen van de test**

- **Alleen aandelen die nu nog genoteerd zijn.** Aandelen die failliet gingen of van de beurs verdwenen
  zitten niet in de data. Het model kiest juist kleine, hard gevallen aandelen; daar vallen de meeste
  verdwijners. De werkelijke kans kan dus lager liggen dan gemeten. Het eigen track record meet dit
  vanaf nu wél goed, en de bijsturing stelt het niveau bij.
- **Eerder aan de bel trekken blijft zwak.** Ook het nieuwe model heeft maar 7% van de sprongen de dag
  ervoor in de top 50. De meeste eerste sprongen komen door nieuws, en dat zit niet in koersen.
- **De kans telt vanaf het slot van de voorspeldag**, terwijl je pas bij de volgende opening kunt kopen
  (hoofdstuk 4).

## 4. Wat een melding in de praktijk waard is

De test hierboven meet wat gevraagd was: de kans op een sprong, gerekend vanaf het slot. Daarna is
nagerekend wat het oplevert als je doet wat in het echt kan: kopen bij de opening van de dag na de
voorspelling. Zonder kosten, op dezelfde nagespeelde meldingen.

| | 2020–2024 (425 meldingen) | 2025–2026 (243 meldingen) |
|---|---|---|
| Raak, gerekend vanaf het slot (zoals getest) | 18,8% | 18,1% |
| Raak, gerekend vanaf de opening van de dag erna | 16,5% | 14,4% |
| Opening ten opzichte van dat slot, gemiddeld | +4,0% | +3,7% |
| Opening bij de latere treffers, gemiddeld | +5,9% | +12,7% |
| Kopen bij de opening, 10 handelsdagen houden: gemiddeld | +2,5% | −2,4% |
| Idem: de middelste melding (mediaan) | −5,3% | −12,8% |
| Idem: eindigt in de plus | 38% | 35% |
| Idem: eindigt op −30% of lager | 19% | 26% |
| Kopen bij de opening, verkopen op het eerste slot vanaf +50%: gemiddeld | +3,5% | −3,2% |

Wat dit zegt:

- **Een deel van de sprong is al weg bij de opening.** Bij de latere treffers opent het aandeel
  gemiddeld 6 tot 13% hoger dan het slot waar de kans op gebaseerd is.
- **Gemiddeld komt het rond nul uit, en de middelste melding verliest.** De winst zit in een paar grote
  uitschieters; ruim een derde eindigt in de plus, een vijfde tot een kwart verliest 30% of meer.
- **Eenvoudige regels lossen dit niet op.** Een stop op −20%, winst nemen op +30% of +50%, een hogere
  meldgrens of een hogere omzeteis: geen daarvan geeft in beide perioden een duidelijk beter gemiddelde
  (de uitkomsten liggen tussen −12% en +9% per melding, de mediaan blijft negatief).
- **Het model van Sprinters deed het hierin niet beter**: 12,6% raak vanaf de opening, de middelste
  melding −19,9%, 37% op −30% of lager (2025–2026).

Hier zitten geen transactiekosten, geen koersverschil bij dunne handel en geen verdwenen aandelen in.
In het echt valt het dus eerder lager dan hoger uit.

**Wat ermee te doen.** Het model doet wat gevraagd is: het vindt de aandelen met de grootste kans op een
sprong, met kansen die kloppen. Maar "grote kans op +50%" is iets anders dan "gemiddeld winst". Gebruik
de meldingen daarom als een korte lijst om zelf te beoordelen (nieuws, grafiek, omzet), niet als
koopsignaal. Het voorstel om hier een tweede maatstaf voor te bouwen staat in hoofdstuk 5, punt 1.

## 5. Knelpunten voor de kwaliteit, met voorstellen

Op volgorde van belang. Bij elk punt staat wat gemeten is en wat ik voorstel. Niets hiervan is zonder
overleg gewijzigd.

**1. De meldingen zeggen niets over wat kopen oplevert.** Dit is het grootste knelpunt voor wat je er in
de praktijk aan hebt (hoofdstuk 4). *Voorstel:* een tweede maatstaf naast de kans, gerekend vanaf de
opening van de volgende dag: de kans op +50% vanaf die opening, de kans op −30%, en het verwachte
rendement na 10 handelsdagen. Die kan in het tabblad en in het track record komen, en de meldingen
kunnen erop gerangschikt worden. Dit vraagt een onderzoek zoals dit (dezelfde data, een paar uur) en een
eerlijke test voordat het meldingen stuurt. Tot die tijd: beoordeel elke melding zelf.

**2. Het model ziet geen nieuws.** De meeste eerste sprongen komen door een bericht (goedkeuring,
financiering, contract, overname). Daardoor staat maar 7% van de sprongen de dag ervoor al in de top 50.
Met alleen koersen is hier weinig meer te halen: een model met 117 kenmerken uit vijf jaar dagkoersen
was niet beter dan het huidige. *Voorstel, in twee stappen:* (a) laat de meting lopen die nu draait: per
voorspelling staat het soort nieuws vast, en na twee tot drie maanden is te zien welke soorten meer
treffers geven dan het model al verwachtte; (b) blijkt dat zo, laat dan Claude de koppen beoordelen in
plaats van trefwoorden. Dat kost weinig (zie hoofdstuk 6) maar vraagt een sleutel die jij zelf in
Supabase zet. Een agenda van geplande gebeurtenissen (cijferdatums, besluiten van de FDA) is een derde
mogelijkheid; die is niet getest.

**3. Dunne handel.** De hoogste kansen vallen bij kleine aandelen met weinig omzet. De eerste drie
meldingen hadden $19.000, $81.000 en $34.000 omzet per dag: een order van een paar duizend euro beweegt
daar de koers. *Gemeten:* een eis van $100.000 omzet per dag voor meldingen (niet voor de lijst) kost
niets aan trefkans: 2025–2026 42 van 230 = 18,3% tegen 18,1%, 2020–2024 18,3% tegen 18,8%. *Voorstel:*
zo'n aparte omzeteis voor meldingen als instelling toevoegen. Jij koos $10.000 als ondergrens, dus dit
is jouw keuze; het is een kleine wijziging. *Besluit (14 november): gedaan.* De instelling
`ss_alert_min_dvol` staat op $100.000; een kandidaat eronder krijgt in het tabblad de notitie "niet
gemeld: omzet onder $100k per dag".

**4. De weekplekken gaan naar de eerste dag met kandidaten.** Op 13 november stonden er 30 aandelen
boven 15% (in 2026 gemiddeld 11 per dag), dus de drie meldingen van een week gaan meestal op dezelfde
ochtend uit, naar de hoogste drie van die dag. Een betere kandidaat later in de week krijgt geen plek. *Gemeten:* een hogere meldgrens
geeft minder maar betere meldingen:

| Meldgrens | 2020–2024 | 2025–2026 |
|---|---|---|
| 15% (nu) | 425 meldingen, 18,8% raak | 250 meldingen (2,6 per week), 18,1% raak |
| 18% | 228 meldingen, 24,6% raak | 157 meldingen (1,6 per week), 18,7% raak |
| 20% | 145 meldingen, 23,4% raak | 95 meldingen (1,0 per week), 23,9% raak |
| 22% | 98 meldingen, 22,4% raak | 60 meldingen (0,6 per week), 29,3% raak |

*Voorstel:* wil je liever één goede melding per week dan drie, zet de meldgrens dan op 20%
(`ss_alert_min_prob`). In beide perioden gaf dat ongeveer 24% raak. Dat kan nu al, zonder wijziging aan
de code. *Besluit (14 november): gedaan, de meldgrens staat op 20%.* Samen met de omzeteis gaf dat in de
test 0,5 tot 0,7 meldingen per week. Op de slotstanden van 13 november stonden er twee aandelen boven
20% (NOMA en DRIO), allebei onder $100.000 omzet: die dag zou er dus geen melding zijn uitgegaan.

**5. Eén bijsturing voor de hele wereld.** De bijsturing is één getal, maar de regio's lopen uiteen:
over de laatste vier maanden kwam in de VS 99% uit van wat voorspeld was, in Europa 87%, in Azië en
Australië 82% en in Canada 66%. Met een eigen bijsturing per regio waren de nagespeelde meldingen beter
(2025–2026 64 van 267 = 24,0% tegen 18,7%; 2020–2024 21,8% tegen 20,6%). Dit is pas gevonden nadat de
achtergehouden jaren bekeken waren, en geldt daarom niet als eerlijk getest. *Voorstel:* na drie maanden
eigen track record (dat de regio vastlegt) beslissen; klopt het daar ook, dan overstappen.

**6. Alleen aandelen die nog bestaan.** Zie hoofdstuk 3: de gemeten trefkans kan te hoog zijn doordat
verdwenen aandelen ontbreken. *Voorstel:* niets bouwen, maar het eigen track record na twee tot drie
maanden naast de voorspelling leggen. De bijsturing corrigeert het niveau vanzelf, binnen ×0,5 en ×2.

**7. Het model veroudert.** Het is één keer getraind (data tot en met 29 oktober 2026). De bijsturing
past het niveau aan, niet de volgorde. In de test verschilde het per jaar flink (2025 goed, 2026 matig).
*Voorstel:* elk half jaar opnieuw trainen met de scripts in de repository. Dat kan niet binnen Supabase;
het vraagt een sessie zoals deze, ongeveer een uur rekenen en 30 GB tijdelijke ruimte.

**8. Vrij verhandelbare aandelen, short interest, handel van bestuurders.** Short interest (FINRA, twee
keer per maand) is getest en voegt niets toe. Het aantal vrij verhandelbare aandelen was niet te testen:
daar bestaat geen gratis geschiedenis van. *Gedaan:* het wordt vanaf nu per voorspelling vastgelegd,
samen met omzet en beurswaarde. *Voorstel:* over een half jaar op die eigen cijfers testen. Meldingen
van bestuurders (SEC Form 4) zijn niet getest.

**9. De database is geen knelpunt voor SUPERsprinters, een oude taak wel.** SUPERsprinters gebruikt
ongeveer een kwart procent van wat de database per dag schrijft (hoofdstuk 8). Maar de bestaande taak
`xinix-deep-scan` (de explosie-motor achter Sprinters en de andere tabbladen) mislukt sinds 2 november
bij elke run: 72 keer per dag haalt hij dezelfde 21 aandelen opnieuw op bij Yahoo (ruim 1.500 verzoeken
per dag) en loopt dan vast op het wegschrijven van zijn track record. Het track record van de
explosie-motor wordt daardoor sinds begin november niet meer bijgewerkt. Dit is een bestaande functie,
dus niet aangeraakt. *Voorstel:* laten repareren; het is vermoedelijk een kleine wijziging. *Besluit
(14 november): gerepareerd.* De oorzaak: bij het terugschrijven van een afgerekende voorspelling
ontbraken drie verplichte kolommen. Hersteld in de database (`2026-11-14_xinix_deep_scan_repair.sql`),
zonder de functie opnieuw uit te rollen; daarbij komt een aandeel nu pas in de wachtrij als afrekenen
echt kan, anders was dezelfde lus in december teruggekomen. Daarna zijn de 90 verlopen voorspellingen
afgerekend en is de wachtrij leeg.

## 6. Wat geprobeerd is en niet hielp, of niet gebouwd is

- **Meer kenmerken uit vijf jaar dagkoersen** (133 in plaats van 43): even goed bovenaan (2019–2024:
  gemiddelde precisie 0,0697 tegen 0,0696). Het kleine model won, omdat het met één verzoek per markt
  bij TradingView kan draaien in plaats van met een verzoek per aandeel bij Yahoo.
- **Short interest van FINRA** (212 bestanden sinds december 2017, met de vertraging waarmee het
  gepubliceerd wordt): voegt niets toe.
- **Het rendement over vijf dagen uit TradingView**: weggelaten; dat veld loopt vlak na het slot een
  sessie achter.
- **Een lat die na elke melding omhoog gaat en daarna weer zakt**: niet beter dan de gewone regel.
- **Vrij verhandelbare aandelen**: niet te testen zonder geschiedenis; wordt nu getoond en vastgelegd.
- **SEC Form 4 en de FDA-kalender**: niet getest. Zou de SEC gebruikt worden, dan met de bestaande
  afzender van `poll-edgar-background` (`SEC_USER_AGENT`).
- **Claude voor nieuws: niet gebouwd.** Het past ruim binnen $1 per dag, maar het is niet te bewijzen op
  geschiedenis (er is geen gratis archief van oude koppen), dus het had nooit deel kunnen zijn van een
  model dat "bewezen beter" is. En het vraagt een sleutel. De rekensom, met de aantallen van nu en de
  prijzen van november 2026: per dag worden voor 44 tot 60 aandelen koppen opgehaald, hoogstens 8 per
  aandeel. Dat is ongeveer 40.000 tokens invoer en, met het nadenken van het model erbij, 24.000 tokens
  uitvoer per dag.

  | Model | Prijs per miljoen tokens (invoer / uitvoer) | Kosten per dag |
  |---|---|---|
  | Claude Haiku 5.5 | $0,10 / $0,50 | ongeveer $0,02 |
  | Claude Sonnet 5.5 | $2 / $10 | ongeveer $0,32 |
  | Claude Opus 5.5 | $4 / $20 | ongeveer $0,64 |

  Voor de hele kopgroep (380 aandelen per dag, ongeveer 120.000 tokens invoer en 68.000 uitvoer) wordt
  dat: Haiku $0,05, Sonnet $0,90, Opus $1,84. Mocht het er komen: Haiku 5.5, een dagplafond in de code,
  en zonder sleutel moet alles gewoon blijven werken. De sleutel zet je dan zelf in Supabase (Edge Functions → Secrets,
  `ANTHROPIC_API_KEY`).

## 7. Saxo-beurzen: bron en twijfelgevallen

De lijst van 20 markten is één keer nagelopen tegen Saxo's eigen overzichten (geraadpleegd op
13 november 2026):

- de prijslijst "Tarieven Zelf Beleggen" van 13 juli 2026:
  https://www.home.saxo/-/media/documents/regional/nl/pricing-unified.pdf?revision=ccab141b-bd4b-4ac5-a297-13aad21312e5
- het hulpartikel "Tot welke beurzen heb ik toegang?":
  https://www.help.saxo/hc/nl/articles/360019182238-Tot-welke-beurzen-heb-ik-toegang
- het document "Belangrijke Informatie Zelf Beleggen".

Uitkomst: 19 van de 21 regels van de oorspronkelijke lijst staan in Saxo's overzicht.

- **Niet aangeboden, dus eruit:** de Canadian Securities Exchange (was al afgesproken) en Cboe Canada
  (voorheen NEO). Saxo noemt voor Canada alleen de Toronto Stock Exchange en de TSX Venture Exchange.
- **Twijfel: de Londense AIM.** Het Engelstalige hulpartikel zegt dat AIM niet wordt aangeboden, maar op
  Saxo's eigen aandelenpagina's staan AIM-aandelen als verhandelbaar. Ze doen nu mee. Kun je een
  Londens aandeel uit de lijst niet kopen, dan is dit de reden.
- **Twijfel: First North Helsinki** is in de overzichten niet teruggevonden; de aandelen zijn bij
  TradingView niet te scheiden van de hoofdmarkt in Helsinki en doen mee.
- **SEAQ** (Londen) is volgens Saxo alleen telefonisch te verhandelen.

## 8. Zuinig met middelen: gemeten verbruik

**Vooraf gemeten.** De database schrijft 237 MB per dag aan zijn logboek (2.901 MB in 12,2 dagen sinds
de herstart van 2 november). De grootste schrijvers zijn de Hippos-scores, het bijwerken van
`edgar_polled_at` per aandeel en de explosie-motor.

**Het ontwerp.** De hele markt wordt in het geheugen van de functie gescoord; alleen de kopgroep wordt
weggeschreven, in één opdracht per ronde. Er is geen index op kolommen die elke dag veranderen. Er wordt
alleen op sleutel gelezen, nooit met doortellen van voorgaande rijen. Niets wordt gewist: scores worden
per aandeel overschreven en het track record groeit.

**Gemeten in productie** (13 en 14 november: 4 rondes, 2 ochtendmeldingen waarvan één met drie
meldingen, 3 keer afrekenen):

| | Gemeten | Dagbudget in de code |
|---|---|---|
| Runs per dag | 5 op een gewone dag | 30 |
| Verzoeken aan TradingView | 22 per dag (5 + 14 + 3) | 80 |
| Verzoeken aan Yahoo | 44 voor nieuws, 3 voor de controle bij meldingen; vanaf december tot 240 voor het afrekenen | 400 |
| Rijen geschreven | ±760 per dag door de rondes, ±50 bij een melding, vanaf december ±380 bij het afrekenen | 2.500 |
| Geschreven naar het logboek van de database | 0,75 MB voor alles tot nu toe, dus ±0,5 MB per dag; met afrekenen erbij naar schatting 0,6 à 0,7 MB | – |
| Aandeel in wat de database per dag schrijft | ongeveer 0,25% | – |
| Van schijf gelezen | 3 blokken in totaal: alles blijft in het geheugen | – |
| Rekentijd in de database | 3,5 seconden voor alle 400 opdrachten samen | – |
| Looptijd van een ronde | 7 tot 12 seconden | – |
| Looptijd van de ochtendmelding met drie meldingen | 7 seconden | – |

**Groei.** De stand per aandeel (`xinix_ss_scores`) krijgt een rij voor elk aandeel dat ooit in de
kopgroep stond: nagerekend ongeveer 3.600 rijen na een jaar (ongeveer 5 MB). Het track record groeit met
ongeveer 380 rijen per handelsdag, 95.000 per jaar (ongeveer 20 tot 35 MB). Opruimen is niet nodig en
niet ingebouwd, want wissen vraagt een bevestiging die via de telefoon niet aankomt.

**Remmen.**

- De schakelaar `signal_settings.ss_enabled` (ook als knop in het tabblad): uit betekent geen enkele run.
- Het dagbudget hierboven: is het op, dan slaat de functie de run over en zegt dat in het runlog.
- Na drie mislukte runs achter elkaar pauzeert de functie zichzelf een etmaal.
- Het afrekenen stopt na 100 seconden of als het Yahoo-budget op is; de rest komt de volgende dag.
- Mislukt het versturen van een melding, dan stopt de functie met versturen en probeert de volgende
  ronde het opnieuw.

**Tweede controle.** Op donderdag 19 november, na drie handelsdagen, wordt het verbruik opnieuw gemeten;
op woensdag 2 december nog een keer, als de eerste voorspellingen zijn afgerekend. De uitkomsten komen
in hoofdstuk 13 van dit rapport.

## 9. Fouten die na de eerste uitrol zijn gevonden en hersteld

Bij het narekenen op 14 november, na de eerste uitrol en na de eerste melding:

1. **De startwaarde van de bijsturing was te hoog** (×1,02 in plaats van ×0,89). Het onderzoeksscript
   nam de waarde van een willekeurige rij (21 mei 2026) in plaats van de laatste dag. Gevolg: de hoogste
   kansen stonden ongeveer 2 punten te hoog en er waren 45 kandidaten boven 15% waar het er 30 hadden
   moeten zijn. **De eerste drie meldingen noemden daardoor 25%, 24% en 21% waar 23%, 22% en 19%
   hoort.** De volgorde verandert niet door de bijsturing, dus het waren wel de juiste drie aandelen. De
   kans in het tabblad en in het track record is voor die eerste dag omgerekend; de kans die in de
   melding stond is bewaard zoals hij verstuurd is.
2. **De bijsturing zou in de eerste weken alle kanten op schieten**, omdat een paar dagen met uitkomsten
   het getal bijna helemaal bepaalden (40 tot 50% afwijking na 10 dagen, nagerekend op 2019–2026). Nu
   maakt de startwaarde in vier maanden geleidelijk plaats voor de eigen uitkomsten (afwijking binnen
   ongeveer 10%).
3. **Het afrekenen van het track record hield de aanwas niet bij.** Met 80 aandelen per run zou de
   wachtrij onbeperkt oplopen. Nu 240 per run. Getest tegen echte koersen van Yahoo op 138
   voorspellingen uit oktober 2026 in alle vier de regio's: alle 138 gelijk aan de uitkomst uit het
   onderzoek.
4. **Het weekplafond telde in uren in plaats van in beursdagen.** De vaste melddag zou daardoor elke
   week een dag opschuiven. Nu telt het zoals het getest is.

Ook nagerekend: de bijsturing zoals productie hem rekent (over de bewaarde kopgroep) geeft dezelfde of
iets betere meldingen dan zoals hij getest is (2025–2026: 46 van 246 = 18,7% tegen 44 van 243 = 18,1%).
En de ronde voor de VS, die 36 minuten na het slot draait, wijkt nauwelijks af van de stand zeven uur
later: gemiddeld 0,04 procentpunt, hoogstens 0,9.

## 10. Uitzetten en terugdraaien

| Wat | Hoe |
|---|---|
| Meldingen van SUPERsprinters uit, die van Sprinters weer aan | Knop onderaan het tabblad (beheertoken), of `update signal_settings set ss_alerts = false, sprint_alert_min_prob = 15 where id = 1;` |
| Alles van SUPERsprinters stilzetten (het tabblad blijft leesbaar) | Knop in het tabblad, of `update signal_settings set ss_enabled = false where id = 1;` |
| Minder of betere meldingen | `ss_alert_min_prob` (nu 20), `ss_alert_min_dvol` (nu 100000) en `ss_alert_max_per_week` (nu 3) in `signal_settings` |
| De vijf taken pauzeren | `select cron.alter_job(jobid, active := false) from cron.job where jobname like 'xinix-ss-%';` |

Er hoeft nergens iets gewist te worden. De tabellen `xinix_ss_*` en de functie `xinix-supersprint`
kunnen blijven staan; ze kosten niets als ze stilstaan.

## 11. Open punten

- **Een tweede maatstaf vanaf de opening** (hoofdstuk 5, punt 1): op 14 november akkoord om te laten
  onderzoeken, samen met nieuws, de weekplekken en de bijsturing per regio. De omzeteis, de meldgrens
  en de reparatie van `xinix-deep-scan` zijn die dag uitgevoerd.
- **AIM en First North Helsinki** doen mee terwijl niet zeker is dat Saxo ze aanbiedt (hoofdstuk 7).
- **Beurswaarde bij de explosie-motor.** TradingView geeft de beurswaarde in de lokale munt; de
  explosie-motor slaat die op als dollars (`mcap_usd` in `xinix_universe`). SUPERsprinters rekent hem
  wel om. Bestaande code, niet aangeraakt.
- **Sprinters gebruikt een weekrendement uit TradingView dat de kalenderweek volgt**, niet de laatste
  vijf handelsdagen. Op maandag is dat dus één dag. Bestaande code, niet aangeraakt.
- **De gegevens van SUPERsprinters zijn openbaar op te vragen**, net als die van de andere tabbladen:
  het inlogscherm schermt alleen de site af (zie de backlog in `CLAUDE.md`, "Inloggen stap 2").
- **Het model opnieuw trainen** rond mei 2027 (hoofdstuk 5, punt 7).

## 12. Narekenen

Alles staat in `scripts/supersprinters/` (zie de `README.md` daar):

- `test_core.ts`: de TypeScript-versie van het model geeft exact dezelfde uitkomst als LightGBM
  (grootste verschil 0,0000000000000001 op 600 testgevallen).
- `smoke.ts`: droogloop van een hele ronde en de ochtendmelding tegen het echte TradingView en Yahoo,
  met een nagebootste database en meldserver. Ook het afrekenen (`smoke.ts resolve`) en de meldregels
  (`PRE=…`) zijn hiermee getest.
- `onderzoek/`: het hele onderzoek, van het ophalen van de koersen tot het definitieve model.
  `final_eval.py` maakt de tabellen van hoofdstuk 3; `productie_check.py` rekent de keuzes van
  hoofdstuk 9 na.

Het model zelf staat in `public/ss-model.json` (210 bomen). De functie weigert een model waarvan het
controlegetal niet klopt met dat in `core.ts`.

**Uitrollen.** Alleen `supabase/functions/xinix-supersprint/index.ts` gaat naar Supabase. Dat bestand
haalt `run.ts` en `core.ts` bij het uitrollen uit de openbare repository, vastgepind op één commit. Na
een wijziging in die twee bestanden: eerst mergen, dan de commit in `index.ts` bijwerken en dat bestand
opnieuw uitrollen (`deploy_edge_function`, `verify_jwt` uit). Verandert het model, wacht dan tot GitHub
Pages het nieuwe bestand serveert voordat de functie wordt uitgerold.

## 13. Vervolgcontroles

Nog niet uitgevoerd. Gepland: 19 november 2026 (verbruik na drie handelsdagen) en 2 december 2026
(eerste afgerekende voorspellingen).
