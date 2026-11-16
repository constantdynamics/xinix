# SUPERsprinters: rapport (13–15 november 2026)

SUPERsprinters is een tabblad onder Favorieten dat op alle beurzen die Saxo aanbiedt de aandelen zoekt
die binnen 10 handelsdagen minstens 50% kunnen stijgen, en meldt over de beste. Een treffer is hetzelfde
als bij Sprinters: het slot komt binnen 10 handelsdagen minstens 50% boven het slot van de dag van de
voorspelling, en staat een dag later nog minstens 20% hoger.

Dit rapport is geschreven voor iemand die het werk niet heeft gezien. Alle cijfers zijn na te rekenen
met de scripts in `scripts/supersprinters/` (zie hoofdstuk 12).

**Bijgewerkt op 15 november.** Hoofdstuk 14 beschrijft de tweede ronde: de meldregels zijn opnieuw
doorgerekend en aangepast (lat 26% zonder weekplafond, geen melding voor heel beweeglijke aandelen,
Europa meldt voorlopig niet), en het track record legt nu ook vast wat kopen bij de opening oplevert.
Waar hoofdstuk 1 tot en met 13 over meldregels gaan, geldt wat in hoofdstuk 14 staat.

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
- **Bijgesteld op 15 november** (hoofdstuk 14): de meldgrens is 26% zonder weekplafond, aandelen die in
  de week ervoor gemiddeld meer dan 30% per dag bewogen krijgen geen melding, Europa meldt voorlopig
  niet, en Azië en Australië worden gemeld direct na hun ronde.

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

**Meldingen.** Twee meldmomenten per dag, elk vóór de volgende opening van de eigen beurzen: om 09:33
UTC voor Azië en Australië (een kwartier na hun ronde) en om 04:12 UTC, direct na de stille uren, voor
de VS, Canada en Europa. Wat op een melding wacht gaat uit met de hoogste kans eerst. De regels sinds
15 november (hoofdstuk 14):

- vanaf 26% (`ss_alert_min_prob`; bij de start 15%, op 14 november 20%);
- alleen bij een omzet van minstens $100.000 per dag (`ss_alert_min_dvol`; de lijst zelf begint bij
  $10.000);
- niet als het aandeel in de week ervoor gemiddeld meer dan 30% per dag bewoog
  (`ss_alert_max_volw`; 0 = geen grens);
- alleen uit de VS, Canada en Azië-Pacific (`ss_alert_regions`); Europa staat in de lijst maar meldt
  voorlopig niet;
- geen weekplafond (`ss_alert_max_per_week = 0`; tot 15 november hoogstens 3 per week);
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
aangeraakt zonder stand te houden. Sinds 15 november ook: de beweeglijkheid van de week (voor de
risicoklasse) en wat er gebeurde vanaf de opening van de dag na de voorspelling: hoe hoog hij opende,
of +50% vanaf die opening gehaald werd, het rendement na 10 handelsdagen en het laagste en hoogste slot
onderweg.

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
eerlijke test voordat het meldingen stuurt. Tot die tijd: beoordeel elke melding zelf. *Uitgevoerd op
15 november (hoofdstuk 14):* een model dat op de uitkomst vanaf de opening is getraind, rangschikt niet
beter dan het huidige, en het verwachte rendement is nauwelijks te voorspellen. Wat wel hielp: een
grens op heel beweeglijke aandelen en een hogere lat. Het track record houdt de uitkomst vanaf de
opening nu bij.

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
*Besluit (15 november): geen weekplafond meer, lat 26%.* Het plafond zelf maakte in de test geen verschil
voor de kwaliteit (1, 2, 3 of 5 per week: 24 tot 26% raak); de hoogte van de lat wel (hoofdstuk 14).

**5. Eén bijsturing voor de hele wereld.** De bijsturing is één getal, maar de regio's lopen uiteen:
over de laatste vier maanden kwam in de VS 99% uit van wat voorspeld was, in Europa 87%, in Azië en
Australië 82% en in Canada 66%. Met een eigen bijsturing per regio waren de nagespeelde meldingen beter
(2025–2026 64 van 267 = 24,0% tegen 18,7%; 2020–2024 21,8% tegen 20,6%). Dit is pas gevonden nadat de
achtergehouden jaren bekeken waren, en geldt daarom niet als eerlijk getest. *Voorstel:* na drie maanden
eigen track record (dat de regio vastlegt) beslissen; klopt het daar ook, dan overstappen. *Nagerekend
op 15 november (hoofdstuk 14):* bij de lat van 20% geeft een bijsturing per regio geen duidelijke winst
(2020–2024 28% tegen 26% raak, 2025–2026 24% tegen 25%). Niet ingevoerd. Wel meldt Europa voorlopig
niet: daar kwam in geen van beide perioden uit wat voorspeld was.

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
| Meer of minder meldingen | `ss_alert_min_prob` (nu 26), `ss_alert_min_dvol` (nu 100000), `ss_alert_max_per_week` (nu 0 = geen plafond), `ss_alert_max_volw` (nu 30; 0 = geen grens) en `ss_alert_regions` (nu `{0,1,3}`) in `signal_settings`. De grens op beweeglijkheid en Europa hebben ook een knop onderaan het tabblad |
| Terug naar de regels van 14 november | `update signal_settings set ss_alert_min_prob = 20, ss_alert_max_per_week = 3, ss_alert_max_volw = 0, ss_alert_regions = '{0,1,2,3}' where id = 1;` |
| Het meldmoment voor Azië uitzetten | `select cron.alter_job((select jobid from cron.job where jobname = 'xinix-ss-flush-apac'), active := false);` (de ochtendmelding neemt die kandidaten dan weer mee) |
| De zes taken pauzeren | `select cron.alter_job(jobid, active := false) from cron.job where jobname like 'xinix-ss-%';` |

Er hoeft nergens iets gewist te worden. De tabellen `xinix_ss_*` en de functie `xinix-supersprint`
kunnen blijven staan; ze kosten niets als ze stilstaan.

## 11. Open punten

- **Nieuws** (hoofdstuk 14.8): de enige bron die nog iets wezenlijks kan toevoegen. Berichten bij de
  SEC zijn op geschiedenis te testen; een beoordeling door Claude wordt gemeten vanaf het moment dat de
  sleutel in Supabase staat.
- **Europa** meldt voorlopig niet. Opnieuw bekijken als het eigen track record drie maanden beslaat.
- **De cijfers van hoofdstuk 14 zijn geen eerlijke test meer**: de jaren 2025–2026 waren al bekeken toen
  de nieuwe regels gekozen werden. De keuzes zijn op 2020–2024 gemaakt; het eigen track record moet
  laten zien of ze standhouden.
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
- `smoke.ts`: droogloop van een hele ronde en het meldmoment tegen het echte TradingView en Yahoo,
  met een nagebootste database en meldserver. Ook het afrekenen (`smoke.ts resolve`, ook vanaf de
  opening) en de meldregels (`PRE=…`, `MAX_VOLW`, `MAX_WEEK`, `REGIONS`) zijn hiermee getest.
- `onderzoek/`: het hele onderzoek, van het ophalen van de koersen tot het definitieve model.
  `final_eval.py` maakt de tabellen van hoofdstuk 3; `productie_check.py` rekent de keuzes van
  hoofdstuk 9 na; `labels_open.py` tot en met `ronde2_keuzes.py` zijn de tweede ronde (hoofdstuk 14).

Het model zelf staat in `public/ss-model.json` (210 bomen). De functie weigert een model waarvan het
controlegetal niet klopt met dat in `core.ts`.

**Uitrollen.** Alleen `supabase/functions/xinix-supersprint/index.ts` gaat naar Supabase. Dat bestand
haalt `run.ts` en `core.ts` bij het uitrollen uit de openbare repository, vastgepind op één commit. Na
een wijziging in die twee bestanden: eerst mergen, dan de commit in `index.ts` bijwerken en dat bestand
opnieuw uitrollen (`deploy_edge_function`, `verify_jwt` uit). Verandert het model, wacht dan tot GitHub
Pages het nieuwe bestand serveert voordat de functie wordt uitgerold.

## 13. Vervolgcontroles

Nog niet uitgevoerd. Gepland: 19 november 2026 (verbruik na drie handelsdagen; ook de eerste automatische
rondes met versie 8 van de functie en het tweede meldmoment) en 2 december 2026 (eerste afgerekende
voorspellingen, ook vanaf de opening).

## 14. Tweede ronde (15 november 2026): betrouwbaarder, en wat daarvan lukte

Aanleiding: het verzoek van 14 november ("optimaliseren zodat het écht nog veel betrouwbaarder wordt,
ook met onderzoek en nieuws en dunne handel en weekplekken en bijsturing; als het iets kost wil ik dat
horen") en de keuzes van 15 november:

- betrouwbaar betekent: vaak +50% én weinig grote verliezers;
- liever één heel goede melding per maand dan drie matige per week;
- geen weekplafond, maar een hoge lat;
- alleen regio's waar de kansen aantoonbaar kloppen;
- kopen met een limietorder rond het vorige slot, verkopen rond +50%;
- de omzeteis van $100.000 per dag blijft;
- alle nieuwsbronnen mogen onderzocht worden; een tweede bericht vlak voor de opening alleen als de
  test laat zien dat het helpt.

Alles is nagerekend op dezelfde opgeslagen testvoorspellingen als hoofdstuk 3 (elk jaar voorspeld door
een model dat dat jaar niet zag). Keuzes zijn gemaakt op 2020–2024; 2025–2026 dient als controle. Die
laatste twee jaren waren al bekeken, dus dit is geen eerlijke test meer in de zin van hoofdstuk 3: het
eigen track record moet laten zien of het standhoudt.

### 14.1 Uitkomst in het kort

| Regels | 2020–2024 | 2025–2026 |
|---|---|---|
| 14 november: lat 20%, omzet ≥ $100.000, hoogstens 3 per week | 117 meldingen · 25,6% raak · 23,1% raak vanaf de opening · 19% eindigt 30% of meer lager | 79 meldingen · 25,3% · 19,0% · 30% |
| 15 november: lat 26%, omzet ≥ $100.000, niet boven 30% dagbeweging, zonder Europa, geen plafond | 148 meldingen · 26,4% · 26,4% · 10% | 13 meldingen · 6 raak (46%) · 5 raak vanaf de opening (38%) · 2 eindigen 30% of meer lager (15%) |

Wat dit zegt:

- **Veel vaker raak wordt het niet.** Ook de beste meldingen komen ongeveer één op de vier keer uit. Een
  hogere lat, een ander model en andere regels gaven in 2020–2024 geen hogere trefkans dan 25 à 27%. Met
  alleen koersgegevens is dit het plafond.
- **Wel veel minder grote verliezers, en de melding is ook raak als je pas de dag erna koopt.** Bij de
  regels van 14 november eindigde één op de vijf tot één op de drie meldingen 30% of meer lager; nu één
  op de tien (2020–2024) en 2 van de 13 (2026). De middelste melding stond na tien handelsdagen in de
  plus (+6% in beide perioden); bij de oude regels was dat −0% en −15%.
- **Het zijn er weinig.** In 2026 dertien meldingen, ongeveer één per maand. In 2022, 2023, 2024 en 2025
  geen enkele. In 2020 en 2021 samen 164, met soms meerdere per dag (hoogstens 12).
- De cijfers van 2025–2026 berusten op dertien meldingen. Dat is te weinig om er meer uit te lezen dan
  "het wijst dezelfde kant op".
- **Bedrijfsnieuws laten lezen door Claude maakt het niet aantoonbaar betrouwbaarder** (proef van 16
  november met het API-tegoed, 14.13–14.16). Claude las 4.938 stukken van de SEC bij 13.696 Amerikaanse
  kandidaat-dagen. Van de negentien vooraf vastgelegde feiten onderscheidt er geen één treffers of grote
  verliezers in beide perioden op de dagen die een melding kunnen krijgen. Kosten: $47,37.

### 14.2 Gerekend vanaf de opening

De kans telt vanaf het slot van de voorspeldag, maar kopen kan pas daarna. Daarom is elke uitkomst ook
gerekend vanaf de opening van de volgende handelsdag (`labels_open.py`): raak vanaf die opening, het
rendement na 5 en 10 handelsdagen, het hoogste en laagste slot onderweg.

- Van alle aandeel-dagen is 0,54% raak vanaf het slot en 0,51% vanaf de opening; 89% van de treffers
  vanaf het slot is ook raak vanaf de opening.
- Opschonen was nodig: bij 16.411 van de 26,5 miljoen rijen klopte de openingskoers niet (opening
  buiten de koersen van die dag, of een omgekeerde split die de bron niet meldde en die eruitziet als
  een sprong). Die tellen niet mee (`rsplit.py`, `mask_open.py`). Op de uitkomsten van hoofdstuk 3 heeft
  dit geen merkbaar effect (83 van de 142.841 treffers; geen enkele melding in 2025–2026).
- Vijf modellen zijn getraind op uitkomsten vanaf de opening, met dezelfde kenmerken en dezelfde
  opzet als het huidige model (`exp_open.py`): raak vanaf de opening, idem met de opening zelf als
  kenmerk, 30% of meer lager na tien dagen, 20% of meer hoger na tien dagen, en het verwachte rendement.

Uitkomst (`eval_open.py`): **het model dat op de opening is getraind, rangschikt niet beter.** De vijf
hoogste van elke dag waren vanaf de opening 15,9% raak tegen 15,4% bij het huidige model (2020–2024) en
15,5% tegen 16,3% (2025–2026). Het verwachte rendement is nauwelijks te voorspellen: dat model stopte na
1 tot 18 leerrondes en zijn kopgroep bestond uit rustige aandelen die vrijwel nooit +50% doen. Het
huidige model blijft dus staan.

### 14.3 Verliesrisico: hoe wild het aandeel de afgelopen week bewoog

Het model voor "30% of meer lager" onderscheidt binnen de kandidaten wel degelijk (in elk van de zeven
jaren; onderscheidend vermogen 0,56 tot 0,74, waarbij 0,5 niets is). Maar één bestaand kenmerk doet
bijna hetzelfde (0,54 tot 0,71): de gemiddelde dagbeweging van de laatste week, het verschil tussen de
hoogste en de laagste koers van de dag. Dat is gekozen, omdat het geen tweede model vraagt en een vaste
eenheid heeft.

Kandidaten vanaf 15% met minstens $100.000 omzet per dag, in vier klassen (`ronde2_risico.py`):

| Dagbeweging deze week | 2020–2024: raak vanaf de opening | 30% of meer lager | 2025–2026: raak vanaf de opening | 30% of meer lager |
|---|---|---|---|---|
| laag (tot 12%) | 11,4% | 5,8% | 9,8% | 9,4% |
| gemiddeld (12–21%) | 15,2% | 7,6% | 10,9% | 21,3% |
| hoog (21–30%) | 16,4% | 11,5% | 16,6% | 25,9% |
| zeer hoog (boven 30%) | 20,1% | 16,6% | 16,2% | 41,7% |

De bovenste klasse had in elk van de zeven jaren het grootste aandeel grote verliezers (10 tot 45%). De
trefkans loopt een beetje mee op, maar binnen de meldingen maakt dat niets uit: bij de lat van 20% waren
de meldingen uit de bovenste klasse 19% en 23% raak vanaf de opening, tegen 23% en 19% voor alle
meldingen, terwijl 38% en 45% ervan 30% of meer lager eindigde.

**Regel: geen melding boven 30% dagbeweging** (`ss_alert_max_volw`). Bij de lat van 20% en het
weekplafond van 3:

| | 2020–2024 | 2025–2026 |
|---|---|---|
| Zonder de regel | 117 meldingen · 23,1% raak vanaf de opening · 19% op −30% of lager · gemiddeld +4,0% na tien dagen | 79 · 19,0% · 30% · −8,8% |
| Met de regel | 109 · 22,0% · 10% · +7,4% | 70 · 20,0% · 26% · −4,5% |

In vier van de vijf jaren met meldingen was het resultaat met de regel beter of gelijk. Het tabblad
toont de klasse bij elk aandeel ("risico hoog", "risico zeer hoog") en de melding noemt hem.

### 14.4 De lat en het weekplafond

Zonder weekplafond, met de omzeteis en de grens op beweeglijkheid (`ronde2_keuzes.py`):

| Lat | 2020–2024 | 2025–2026 |
|---|---|---|
| 20% | 1.120 meldingen · 17,1% raak vanaf de opening · 9% op −30% of lager | 94 · 19,1% · 25% |
| 22% | 617 · 20,3% · 10% | 54 · 18,5% · 20% |
| 24% | 328 · 21,3% · 11% | 23 · 34,8% · 26% |
| 26% | 164 · 25,6% · 10% | 13 · 38,5% · 15% |
| 28% | 73 · 27,4% · 4% | 10 · 40,0% · 10% |

De lat van 26% is gekozen op 2020–2024: daar is het verschil tussen "raak" en "groot verlies" het
grootst bij nog een redelijk aantal meldingen, en de middelste melding staat na tien dagen op +6%.
Meldingen per jaar bij 26%: 2020: 62, 2021: 102, 2022 tot en met 2025: geen, 2026: 13 (januari 3,
februari 1, maart 2, april 3, mei 2, juli 1, augustus 1).

Het weekplafond zelf deed er voor de kwaliteit niet toe. Bij de lat van 20% gaf een plafond van 1, 2, 3
of 5 per week steeds 24 tot 26% raak (2020–2024) en 22 tot 25% (2025–2026). Het plafond hield vooral in
2020 en 2021 meldingen tegen: zonder plafond waren het er toen gemiddeld ruim vier per week. De plekken
aan de rustigste aandelen geven in plaats van aan de hoogste kans was slechter (12% raak vanaf de
opening tegen 22%).

### 14.5 Regio's

Komt uit wat voorspeld is, binnen de groep die een melding kan krijgen (omzet ≥ $100.000, dagbeweging
tot 30%)? Voorspeld → werkelijk:

| Kandidaten | VS | Canada | Europa | Azië-Pacific |
|---|---|---|---|---|
| vanaf 15%, 2020–2024 | 18,1 → 16,9% | 19,0 → 12,2% | 18,0 → 10,8% | 18,2 → 14,2% |
| vanaf 15%, 2025–2026 | 16,6 → 13,3% | 15,9 → 7,7% (26 dagen) | 17,1 → 9,0% (78) | 17,8 → 19,9% |
| vanaf 24%, 2020–2024 | 26,2 → 22,3% | 26,7 → 23,6% | 26,0 → 16,4% | 26,2 → 19,7% |
| vanaf 24%, 2025–2026 | 27,4 → 20,0% (15) | geen | geen | 27,9 → 55,6% (18) |

Europa blijft in elke regel waar gegevens zijn ver onder de voorspelling. De VS en Canada klopten in
2020–2024 op het niveau van de meldingen, Azië-Pacific in 2025–2026. **Europa meldt daarom voorlopig
niet** (`ss_alert_regions`); het staat wel in de lijst. Op de cijfers maakt dat weinig uit: bij de lat
van 26% ging het om 16 meldingen in vijf jaar (3 raak) en geen enkele in 2025–2026. Eerlijk is ook: per
regio zijn de aantallen op het niveau van de meldingen klein, en de VS en Azië-Pacific wisselden tussen
de twee perioden van plaats (2026: 3 Amerikaanse meldingen, geen raak; 10 uit Azië-Pacific, 6 raak).

Een eigen bijsturing per regio (hoofdstuk 5, punt 5) is opnieuw nagerekend en niet ingevoerd: bij de
lat van 20% 28% tegen 26% raak in 2020–2024 en 24% tegen 25% in 2025–2026.

### 14.6 Kopen met een limietorder, verkopen op +50%

Nagespeeld op de dagkoersen (opening, hoogste, laagste, slot) voor de meldingen bij de lat van 26%:
kopen zoals in de eerste kolom, verkopen met een limiet op +50%, anders na tien handelsdagen.

| Kopen | 2020–2024 (164 meldingen) | 2025–2026 (13 meldingen) |
|---|---|---|
| Marktorder bij de opening | altijd gevuld · 35% haalt +50% · gemiddeld +14,7% (de middelste +7,6%) · 9% op −30% of lager | 5 van 13 halen +50% · gemiddeld +5,1% (de middelste −1,3%) · 3 op −30% of lager |
| Limiet op het slot, één dag geldig | 79% gevuld · 36% · +14,3% (+8,5%) · 8% | 9 gevuld · 4 halen +50% · +5,6% (−4,4%) |
| Limiet op het slot, drie dagen geldig | 88% gevuld · 36% · +14,7% (+9,1%) · 8% | 10 gevuld · 4 halen +50% · +3,1% (−11,9%) |
| Limiet 5% boven het slot, één dag | 94% gevuld · 34% · +13,9% (+7,6%) · 10% | 10 gevuld · 2 halen +50% · −7,0% |

- **Een limietorder op het slot werkt even goed als een marktorder.** Ongeveer één op de vijf orders
  wordt niet gevuld; dat zijn vaak de aandelen die meteen wegliepen (38 tot 65% daarvan was raak). Het
  gemiddelde resultaat van wat wel gevuld wordt is hetzelfde.
- **Ruim één op de drie haalt de verkooplimiet van +50%.** Dat is meer dan "raak" in de tabellen
  hierboven, omdat een verkooplimiet ook afgaat als de koers binnen de dag +50% aantikt.
- **Opent een aandeel meer dan 30% boven het slot, sla het dan over.** Onder alle kandidaten vanaf 15%
  gaf instappen op zo'n opening gemiddeld −16% (2020–2024) en −15% (2025–2026) na tien dagen. Tussen
  +15% en +30% is het beeld niet eenduidig. Dit staat nu in elke melding. Een apart bericht vlak voor
  de opening is niet gebouwd: buiten dit ene geval liet de test geen voordeel zien.
- **Azië en Australië.** De ochtendmelding van 04:12 UTC kwam voor die markten als de volgende sessie
  al uren liep. Een dag later instappen kostte in de test ongeveer een punt trefkans (12,5 → 11,7% en
  15,4 → 14,8%). Sinds 15 november gaat die melding een kwartier na hun ronde uit (09:33 UTC), ruim
  vóór de volgende opening. Azië-Pacific was goed voor een kwart van de meldingen.

### 14.7 Dunne handel

De omzeteis van $100.000 per dag blijft: die gaat over de vraag of je kunt kopen en verkopen, niet over
de kwaliteit. Aandelen onder die grens deden het in de test niet slechter (kandidaten vanaf 15% met
$10.000 tot $100.000 omzet: 13,8% en 15,8% raak vanaf de opening). Een bovengrens op de omzet helpt
niet: binnen de rustige kandidaten vanaf 20% liep de trefkans in 2020–2024 juist op met de omzet (15%
bij $100.000–250.000, 23% boven $10 miljoen). Geen nieuwe regel.

### 14.8 Nieuws

Het model ziet geen nieuws (hoofdstuk 5, punt 2). Wat er is en wat er kan:

| Bron | Op geschiedenis te testen? | Kosten | Stand |
|---|---|---|---|
| Koppen van Yahoo met trefwoorden | nee (geen archief) | geen | draait sinds 13 november; per voorspelling vastgelegd, meting loopt |
| Berichten bij de SEC (uitgiftes, prospectussen, 8-K) | ja, alleen Amerikaanse aandelen | geen | getest op 15 november (14.11): te zwak om op te selecteren, wel bruikbaar als toelichting |
| Claude leest koppen en SEC-berichten per kandidaat | nee, wel te meten vanaf de start | enkele dollars per maand uit het tegoed van $100 | wacht op de sleutel in Supabase (`ANTHROPIC_API_KEY`) |
| Finnhub (gratis sleutel): één jaar bedrijfsnieuws, alleen de VS | beperkt (één jaar) | geen | nog niet aangesloten |
| Betaald nieuwsarchief met jaren geschiedenis | ja | vanaf ongeveer $20 per maand (EODHD noemt $19,99 voor nieuws en agenda; hoe ver het archief teruggaat staat er niet bij). Finnhub: gratis één jaar, betaald twintig jaar, prijs niet bevestigd | niet aangeschaft: de SEC-test geeft geen reden om er nu geld aan uit te geven |

### 14.9 Wat er is gewijzigd

- Instellingen (`signal_settings`): `ss_alert_min_prob` 26, `ss_alert_max_per_week` 0, nieuw
  `ss_alert_max_volw` 30 en `ss_alert_regions` `{0,1,3}`.
- Tabellen: `xinix_ss_scores.vol_w`; `xinix_ss_predictions.vol_w`, `gap_open`, `hit_open`, `ret10_open`,
  `min10_open`, `max10_open`. Voor de 373 voorspellingen van 13 november is de beweeglijkheid achteraf
  ingevuld (de beurzen waren sindsdien dicht; de maandwaarde was bij alle 373 gelijk aan wat toen was
  opgeslagen).
- Taak `xinix-ss-flush-apac` (werkdagen 09:33 UTC).
- Functie versie 8; het tabblad toont het verliesrisico, de nieuwe regels en het track record vanaf de
  opening en per risicoklasse.
- Migratie: `supabase/migrations/2026-11-15_xinix_ss_ronde2.sql`.

Getest: het afrekenen vanaf de opening tegen echte Yahoo-koersen op 105 voorspellingen in vier regio's
(treffer vanaf het slot en vanaf de opening 105 van 105 gelijk aan het onderzoek; rendement en opening
overal binnen één punt); een droogloop van de rondes met het meldmoment; het tabblad op desktop- en
telefoonbreedte tegen de uitgerolde functie.

### 14.10 Wat het kost

Niets van het bovenstaande kost geld: geen grotere database, geen betaalde bron. Het extra verbruik is
één run per werkdag (het tweede meldmoment) en zes kleine kolommen per voorspelling.

### 14.11 De test met berichten bij de SEC

Uitgiftes van nieuwe aandelen zijn de bekendste reden dat een sprong van een klein aandeel weer inzakt.
Daarom is getest of de stukken die een bedrijf bij de SEC indient iets zeggen over treffers en grote
verliezers (`sec_fetch.py`, `sec_test.py`).

- Voor de 1.939 Amerikaanse aandelen die ooit kandidaat waren: alle stukken sinds midden 2018 (646.668
  stuks): prospectussen (424B), registraties (S-1, S-3 en het bericht dat een registratie van kracht is),
  8-K's met hun onderdelen, te late cijfers, meldingen van bestuurders en grootaandeelhouders.
- Per kandidaat-dag telt alleen wat op het slot van die dag al bekend was (ontvangen vóór 16:00 uur New
  York).
- 13.696 kandidaat-dagen (kans vanaf 15%, omzet vanaf $100.000) bij 1.327 aandelen.

Kandidaat-dagen met een dagbeweging tot 30%: aandeel dat tien handelsdagen later 30% of meer lager stond,
met en zonder het kenmerk.

| Kenmerk | 2020–2024 met / zonder | 2025–2026 met / zonder | Raak vanaf de opening, met / zonder |
|---|---|---|---|
| Registratie van kracht geworden in de laatste 30 dagen | 12,7% / 8,0% | 29,3% / 18,4% | 15,7 / 15,5% en 11,3 / 12,2% |
| S-1 of F-1 ingediend in de laatste 60 dagen | 12,0% / 8,1% | 26,2% / 18,2% | 13,8 / 15,7% en 11,8 / 12,2% |
| Prospectus (424B) in de laatste 30 dagen | 10,8% / 7,9% | 22,7% / 18,6% | 14,0 / 15,9% en 13,7 / 11,6% |
| Drie of meer prospectussen in een jaar | 9,5% / 7,9% | 25,3% / 15,5% | 13,7 / 16,3% en 11,6 / 12,5% |
| Oproep voor een aandeelhoudersvergadering in de laatste 30 dagen | 5,7% / 8,7% | 17,3% / 19,9% | 19,9 / 15,1% en 19,4 / 11,0% |

Wat dit zegt:

- **Het verband bestaat, maar is zwak.** Rond een uitgifte of registratie eindigen kandidaten in beide
  perioden vaker fors lager: 3 tot 11 punten meer. De trefkans verandert nauwelijks.
- **Als extra model voegt het niets toe.** Een model met al deze kenmerken naast de kans en de
  beweeglijkheid, geleerd op 2020–2024, onderscheidde in 2025–2026 de grote verliezers niet beter (0,657
  tegen 0,666; 0,5 is niets) en de treffers slechter (0,49 tegen 0,58).
- **Als regel op de meldingen helpt het niet.** Amerikaanse meldingen bij de lat van 20% zonder de
  aandelen met een prospectus in de laatste 30 dagen: 18,2% raak vanaf de opening tegen 18,3% (2020–2024)
  en 11,8% tegen 15,4% (2025–2026); grote verliezers 10,0% tegen 10,3% en 26,5% tegen 28,8%.
- Opvallend maar niet verklaard: een oproep voor een aandeelhoudersvergadering in de laatste 30 dagen
  ging in beide perioden samen met meer treffers (+5 en +8 punten). Dat is één van dertig bekeken
  kenmerken; het kan toeval zijn.

**Besluit:** geen regel op basis van SEC-berichten. Het is wel bruikbare toelichting bij een melding
("twaalf dagen geleden een prospectus ingediend"); dat hoort bij de beoordeling door Claude (14.8).

Twee dingen die hierbij boven water kwamen:

- **De afzender voor de SEC is niet ingesteld.** De SEC vraagt bij elk verzoek een naam en een
  contactadres. In Supabase staat `SEC_USER_AGENT` niet, waardoor de bestaande functie
  `poll-edgar-background` een standaardwaarde met een niet-bestaand adres meestuurt. Dat werkt, maar is
  niet wat de SEC vraagt. Instellen kan alleen de eigenaar: Supabase → Edge Functions → Secrets →
  `SEC_USER_AGENT`, bijvoorbeeld een naam gevolgd door een e-mailadres.
- **Vanuit een Claude-sessie is sec.gov niet bereikbaar.** De gegevens zijn daarom opgehaald via een
  tijdelijke hulpfunctie in Supabase (`xinix-ss-sec-onderzoek`, bron in `onderzoek/sec_proxy.ts`), met
  dezelfde afzender als `poll-edgar-background` en ruim binnen het tempo dat de SEC toestaat. Die functie
  is na gebruik vervangen door een lege functie en kan in het dashboard worden verwijderd.

### 14.12 Drie ideeën die gratis na te rekenen waren (15 november)

De gebruiker vroeg of het maandelijkse API-tegoed de betrouwbaarheid op een andere manier kan verhogen
(meer of ander nieuws, een dagelijkse scan). Drie ideeën konden zonder tegoed op de bestaande gegevens
worden nagerekend. Geen van de drie levert iets op.

**1. Themakoorts: springt een aandeel vaker als zijn bedrijfstak al in beweging is?** (`thema_test.py`)

Het model kent het klimaat van de hele markt per regio, niet dat van de eigen bedrijfstak. Per kandidaat
is geteld welk deel van de andere aandelen in dezelfde bedrijfstak (130 soorten volgens TradingView) of
sector (21) vandaag ≥ +10% of ≥ +20% deed, in vijf dagen ≥ +30%, of in een maand ≥ +50% of ≥ +100%: binnen
de eigen regio en wereldwijd (van een andere regio alleen de sessie die al gesloten was), ook als verschil
met de hele markt. In totaal 60 kenmerken op 18.584 kandidaat-dagen (kans vanaf 15%, omzet vanaf
$100.000); een kandidaat heeft doorgaans 41 andere aandelen in zijn bedrijfstak en regio, 138 wereldwijd.

- Geen enkel kenmerk onderscheidt treffers in beide perioden: het beste komt niet verder dan 0,51 en 0,51
  (0,5 is niets; de beweeglijkheid van de week haalt 0,56 en 0,55, de kans van het model 0,56 en 0,53).
- In drie gelijke groepen (weinig, gemiddeld, veel sectorgenoten die vandaag ≥ +20% deden): 15,8 / 16,1 /
  16,8% raak in 2020–2024 en 14,2 / 14,3 / 15,4% in 2025–2026; grote verliezers 8,4 / 8,2 / 9,3% en
  24,8 / 26,9 / 25,8%.
- Een tweede model (de kans plus de themakenmerken, steeds geleerd op de jaren vóór het testjaar) was in
  2021–2024 slechter dan de kans alleen (0,539 tegen 0,555) en in 2025–2026 beter (0,554 tegen 0,534);
  per jaar wisselt het van kant.
- Bij de meldingen van lat 26% leek een rustige bedrijfstak beter (30% tegen 22% raak in 2020–2024), maar
  bij lat 20% is dat verschil weg (18,9% tegen 19,1%, en 25,0% tegen 24,3%). Toeval.

**Besluit:** niet gebouwd. Een fijnere indeling in thema's (door Claude) heeft weinig kans als de grove
indeling niets laat zien.

**2. Vastgepind na een overnamebod.** Een aandeel waarop een bod in contanten ligt, kan geen +50% meer
doen. Komt bijna niet voor: bij 11 van de 15.119 kandidaat-dagen in 2020–2024 en 7 van de 3.465 in
2025–2026 bleven de tien volgende sloten binnen een band van 4%; onder de kandidaat-dagen vanaf 26% bleven
er 2 van de 397 en 0 van de 27 binnen 6%. Een regel die overnamedoelwitten uitsluit levert niets op.

**3. Een vaste stop-order.** (`stop_test.py`) Nagespeeld op dagkoersen: kopen bij de opening, verkooplimiet
op +50%, stop op −X% onder de aankoopprijs, anders verkopen na tien handelsdagen. Voorzichtig gerekend:
raakt de koers op één dag de stop én de verkooplimiet, dan telt de stop.

Meldingen bij lat 26% in 2020–2024 (148):

| | Verkocht op +50% | Gestopt | Gemiddeld resultaat | Eindigt op −30% of lager | Eindigt op −20% of lager |
|---|---|---|---|---|---|
| Zonder stop | 36% | n.v.t. | +14,9% | 8,8% | 17% |
| Stop −15% | 27% | 52% | +7,8% | 0,7% | 3% |
| Stop −20% | 30% | 41% | +9,3% | 0,7% | 7% (41% als de verkoop 3% doorglijdt) |
| Stop −25% | 31% | 30% | +10,5% | 0,7% | 31% |
| Stop −30% | 33% | 22% | +12,0% | 22% | 25% |
| Stop −40% | 35% | 7% | +13,8% | 10% | 18% |

- Deze aandelen bewegen zo wild dat een stop vaak geraakt wordt; van de gestopte meldingen had 15 tot 18%
  later alsnog +50% gehaald.
- In 2025–2026 (13 meldingen) werd 8 van de 13 gestopt bij −20% en was het gemiddelde +3,9% tegen +5,1%
  zonder stop. Bij lat 20% (90 meldingen): −1,9% zonder stop, +0,7% met een stop op −15%, +0,6% op −25%;
  in 2020–2024 (1.014 meldingen) +10,1% zonder stop tegen +7,3% met een stop op −20%.
- Kopen met een limietorder op het slot geeft hetzelfde beeld.

**Besluit:** een stop ruilt een paar grote verliezen voor veel middelgrote. In goede jaren kost dat 3 tot 6
punten gemiddeld resultaat, in slechte jaren maakt het weinig uit. Het is een keuze over hoe je verlies
neemt, geen verbetering van de meldingen; er komt geen stop-advies in de melding.

Wat hierbij opviel: een groot verlies bouwt zich meestal in dagen op. Van de kandidaten die na tien
handelsdagen 30% of meer lager stonden, stond 77% (2020–2024) en 79% (2025–2026) na vijf dagen al 15% of
meer lager; maar 7% en 15% opende de eerste dag al 10% of meer lager.

**Wat nog niet getest is:** de tekst van het bedrijfsnieuws zelf. De SEC-test (14.11) keek alleen naar het
soort stuk en de datum, niet naar wat erin staat. Persberichten van Amerikaanse bedrijven staan als bijlage
bij een 8-K sinds jaren bij de SEC; die door Claude laten lezen (wat is er gemeld, op welke voorwaarden
wordt er geld opgehaald) is op dezelfde geschiedenis te testen. Dat is het voorstel voor het API-tegoed;
het wacht op de keuzes van de gebruiker en op de sleutel.

### 14.13 Proef op de geschiedenis met het API-tegoed: opzet (vastgelegd vóór de uitkomst)

De gebruiker heeft $100 API-tegoed per maand en koos op 15 november de adviezen bij de zeven vragen: eerst
een proef op de geschiedenis en daarna alleen bouwen wat bewezen is; later de onderdelen oorzaak van de
beweging, verwatering, bewaking na een melding en toelichting; de uitkomst van Claude wordt alleen getoond
en vastgelegd tot de proef hem in beide perioden bevestigt; dagelijks voor de kandidaten vanaf 15%;
dagelijks Opus 5.5, voor de proef eerst 300 stukken door Opus en Sonnet en bij overeenstemming de rest met
Sonnet; proef hoogstens $80, daarna $1,50 per dag; zelf zoeken op internet alleen voor aandelen die een
melding krijgen en voor de bewaking daarna.

**Wat Claude doet en niet doet.** Claude leest stukken en legt feiten vast: wat is er gemeld, is het
bindend of een voornemen, en op welke voorwaarden haalt het bedrijf geld op. Claude voorspelt niets. Het
kent de afloop van oude koersen uit zijn training, dus een voorspelling op oude gevallen zou niets
bewijzen; feiten uit een stuk halen heeft daar geen last van. Wat de feiten waard zijn, bepaalt de telling
achteraf.

**Wat er gelezen wordt.** De SEC-test van 14.11 keek naar het soort stuk en de datum. Nu gaat het om de
inhoud, voor dezelfde 13.696 Amerikaanse kandidaat-dagen (kans vanaf 15%, omzet vanaf $100.000):

- nieuws: de laatste drie 8-K's of 6-K's van de afgelopen 7 dagen, met het persbericht dat erbij zit;
- geld: het laatste prospectus (424B) en de laatste registratie (S-1, S-3, F-1, F-3) van de afgelopen 90
  dagen: het begin van het stuk, waar de voorwaarden staan.

Dat zijn 4.940 verschillende stukken (2.999 nieuws, 1.079 prospectussen, 862 registraties); 8.583 van de
13.696 kandidaat-dagen (63%) hebben er minstens één. Per stuk staan twee momenten vast: bekend op het slot
van de dag (ontvangen vóór 16:00 uur New York) en bekend vóór de melding van de volgende ochtend (ontvangen
op die kalenderdag; een uitgifte wordt vaak na het slot geprijsd). Lange stukken worden ingekort (een 8-K
tot 8.000 tekens, een persbericht tot 14.000, een prospectus tot 28.000); Claude krijgt te zien waar de
tekst ophoudt en mag wat er niet staat niet invullen.

**Feiten die getest worden** (deze lijst lag vast voordat er één uitkomst was):

| | Feit op de kandidaat-dag |
|---|---|
| N1 | bedrijfsnieuws (8-K of 6-K) in de laatste 2 dagen |
| N2 | hard positief bedrijfsnieuws in 2 dagen (studie-uitslag of besluit van een toezichthouder, contract, product, cijfers, overname door het bedrijf; bindend, positief) |
| N3 | zacht positief nieuws in 2 dagen (dezelfde soorten, maar een voornemen) |
| N4 | uitgifte van aandelen gemeld in 7 dagen |
| N5 | uitgifte geprijsd of gesloten in 2 dagen |
| N6 | uitgifte met warrants in 7 dagen |
| N7 | prijs die meebeweegt met de koers (converteerbare lening, kredietlijn in aandelen) in 90 dagen |
| N8 | nieuwe koers van het bedrijf of aankoop van cryptomunten als strategie in 7 dagen |
| N9 | bod op het bedrijf zelf in 7 dagen |
| N10 | noteringsprobleem of omgekeerde split in 7 dagen |
| N11 | negatief nieuws in 7 dagen (ook: twijfel over voortbestaan, wanbetaling) |
| N12 | geen enkel stuk: geen nieuws in 7 dagen en geen prospectus of registratie in 90 dagen |
| P1 | geprijsde uitgifte in de laatste 30 dagen |
| P2 | doorlopend verkoopprogramma (at-the-market) of kredietlijn in aandelen in 90 dagen |
| P3 | registratie waarmee bestaande houders mogen verkopen in 90 dagen |
| P4 | uitgifte groot ten opzichte van het bedrijf (aandelen in de uitgifte ≥ 20% van wat er uitstond) |
| P5 | koers nu ruim boven de uitgifteprijs of de warrantprijs (≥ 20% erboven) |
| P6 | het bedrijf mag per jaar maar een derde van zijn vrij verhandelbare waarde uitgeven (de regel voor kleine bedrijven) |
| P7 | twijfel over het voortbestaan genoemd in het prospectus |
| K1–K3 | kas voor minder dan 6 maanden, voor minder dan 12 maanden, of een positieve kasstroom (uit de kwartaalcijfers, zonder Claude) |
| K4–K5 | aantal aandelen in twaalf maanden met meer dan 50% of meer dan 200% gegroeid (zonder Claude) |

Op 16 november, na de eerste steekproef en vóór de eerste uitkomst, is vastgelegd hoe elk feit uit de
antwoorden van Claude wordt afgeleid (14.15, `tekst_feiten.py`); de lijst zelf is niet veranderd.

**Wanneer telt iets als bewezen.** Een feit moet in 2020–2024 én in 2025–2026 dezelfde kant op wijzen, met
minstens 5 punten verschil in trefkans of in het aandeel grote verliezers, bij minstens 100 kandidaat-dagen
met dat feit in elke periode. Daarna moet het ook als regel op de meldingen en naast de bestaande kans
standhouden. Met ruim twintig feiten en drie uitkomsten zullen er een paar door toeval goed lijken; daarom
tellen losse uitschieters niet.

**Kosten.** De opgehaalde teksten zijn samen 82 miljoen tekens, geschat ±28 miljoen tokens. In bulk (de helft
van de prijs) is dat ongeveer $2 met Haiku 5.5, $45 met Sonnet 5.5 en $115 met Opus 5.5. Het script telt de
tokens eerst gratis na en weigert te versturen als de uitgaven boven $80 zouden komen (`tekst_batch.py`,
het kasboek).

**Hoe het loopt.** De sleutel voor de Claude API staat alleen in Supabase (`ANTHROPIC_API_KEY`); vanuit een
Claude-sessie is hij niet te lezen. Alle verzoeken, ook die aan de SEC, lopen via de tijdelijke
hulpfunctie `xinix-ss-sec-onderzoek` (bron: `onderzoek/sec_proxy.ts`). Die schrijft niets in de database,
laat alleen drie modellen toe, geen hulpmiddelen (dus geen zoekkosten), en heeft een noodrem op het aantal
opdrachten. Na de proef wordt hij weer vervangen door een lege functie.

**Stand op 15 november:** de teksten zijn opgehaald (4.938 van de 4.940), de steekproef van 300 is getrokken,
de vraagstelling en de scripts staan klaar en zijn met verzonnen antwoorden doorgetest. Het deel zonder
Claude (K1–K5) is geteld: zie 14.14. Het lezen door Claude wacht op de sleutel. De kleine bestanden die
nodig zijn om de proef af te maken staan in `scripts/supersprinters/onderzoek/proefdata/`.

### 14.14 Kas en verwatering uit de verslagen (het deel van de proef zonder Claude)

Een bedrijf met weinig geld in kas moet aandelen uitgeven, en doet dat het liefst als de koers net is
gesprongen. Daarom is uit de jaar- en kwartaalverslagen (XBRL bij de SEC) per kandidaat-dag gehaald wat
toen al gepubliceerd was: de kas, de kasstroom uit de bedrijfsvoering en het aantal uitstaande aandelen
(`kas_haal.py`, `kas_test.py`). Voor 85% van de 13.696 kandidaat-dagen zijn kas en kasstroom bekend, voor
72% de groei van het aantal aandelen. Op de kandidaat-dagen waar het bedrijf geld verbruikt, is er bij de
helft kas voor minder dan 8 maanden en bij een kwart voor minder dan 3 maanden; op 27% van de dagen is de
kasstroom positief.

Kandidaat-dagen met een dagbeweging tot 30%, met het feit tegenover zonder:

| Feit | Kandidaat-dagen met het feit | Raak vanaf het slot 2020–2024 | Raak 2025–2026 | Grote verliezers 2020–2024 | Grote verliezers 2025–2026 |
|---|---|---|---|---|---|
| K1 kas voor minder dan 6 maanden | 2.346 en 812 | 17,1% / 16,6% | 12,7% / 13,3% | 9,4% / 8,0% | 23,0% / 15,1% |
| K2 kas voor minder dan 12 maanden | 3.303 en 1.090 | 16,6% / 16,9% | 14,0% / 11,4% | 8,7% / 8,2% | 22,4% / 13,0% |
| K3 positieve kasstroom | 2.355 en 266 | 18,6% / 16,0% | 10,2% / 13,5% | 7,0% / 9,0% | 13,9% / 19,5% |
| K4 aantal aandelen in een jaar meer dan +50% | 1.887 en 432 | 17,3% / 16,6% | 13,2% / 15,3% | 9,2% / 7,1% | 21,5% / 14,9% |
| K5 aantal aandelen in een jaar meer dan +200% | 804 en 235 | 20,3% / 16,3% | 13,2% / 15,0% | 10,6% / 7,3% | 17,0% / 16,9% |

- **Geen feit haalt de lat** (beide perioden dezelfde kant op, minstens 5 punten).
- Weinig kas en veel nieuwe aandelen gaan in beide perioden samen met meer grote verliezers, maar in
  2020–2024 scheelt het 1 tot 2 punten en pas in 2025–2026 7 tot 9. Per jaar wijst kas voor minder dan 6
  maanden in vijf van de zes jaren die kant op; in 2024 andersom (9% tegen 21%).
- Voor de trefkans maakt het niets uit of het wisselt van kant.
- Als regel op de meldingen werkt het niet. Bij de lat van 20% hadden de meldingen met weinig kas in
  2020–2024 juist iets minder grote verliezers (8,7% van 172 tegen 10,9% van 442); in 2025–2026 meer
  (7 van de 18 tegen 4 van de 25).

**Besluit:** geen regel. Het is hetzelfde beeld als bij de registraties in 14.11: het verband met grote
verliezen bestaat, maar is te zwak en te wisselend om meldingen op tegen te houden. Het hoort wel in de
toelichting bij een melding ("kas voor ongeveer vier maanden"). Voor het lezen door Claude betekent dit
dat de verwachting bescheiden moet zijn: de feiten over geld ophalen gaan over hetzelfde mechanisme.

### 14.15 Het lezen door Claude: verloop

**15 november, 16:00 UTC: de sleutel staat in Supabase.** Hij stond eerst in een ander project van
dezelfde eigenaar (eten-avontuur); de functies van Xinix draaien in het project maikel en kunnen daar niet
bij. De hulpfunctie laat sindsdien op verzoek de namen zien van de secrets die hij kan lezen, nooit de
waarden.

**Tokens geteld (gratis, bij de API zelf).** Twee dingen vielen anders uit dan geschat:

- Elke opdracht draagt een vast deel van ±3.000 tokens mee: de vraagstelling (±1.250) en het
  antwoordschema (±1.700, ook als alle uitleg eruit is). Bij 4.938 stukken is dat een derde van alles.
- Deze teksten (juridisch, veel getallen) tellen 3,1 tekens per token in plaats van 4.

Samen ±42 miljoen tokens in plaats van 28. Daarom wordt het vaste deel nu door de API onthouden
(`cache_control`): de eerste opdracht betaalt er 1,25 keer de prijs voor, volgende opdrachten binnen vijf
minuten 0,05 keer. Het voorblad van een 8-K (adres, aankruisvakjes) gaat niet meer mee.

**Steekproef, Opus 5.5.** Alle 300 stukken gelezen in vier minuten, geen enkele mislukt. Het vaste deel
werd bij 99% van de opdrachten onthouden. Kosten $4,56: $0,022 per prospectus of registratie en $0,011
per nieuwsstuk; een antwoord is gemiddeld 340 tokens. Doorgerekend naar alle 4.938 stukken: ±$74 met Opus,
±$37 met Sonnet.

Wat Opus in de steekproef vond:

- 180 nieuwsstukken: cijfers 34, uitgifte van aandelen 31, bestuur 22, lening of converteerbaar 14,
  aandeelhoudersstemming 12, studie of toezichthouder 9, contract 9, noteringsprobleem 9, omgekeerde split
  7, overname door het bedrijf 6, cryptostrategie 4. Hard positief nieuws in 43 stukken, een voornemen in
  10, negatief in 40. Geen enkel bod op het bedrijf zelf.
- 120 prospectussen en registraties: doorverkoop door houders 46, geprijsde uitgifte 28, plankregistratie
  12, doorlopend verkoopprogramma 9, voorlopige uitgifte 9, kredietlijn in aandelen 8. Bij 21 geldt de
  regel voor kleine bedrijven, bij 15 beweegt een prijs mee met de koers.

Twaalf antwoorden zijn met de hand naast de tekst gelegd (zes van Sonnet, zes van Opus): soort, bedragen,
aantallen aandelen en warrants klopten met wat er stond.

**Sonnet en Haiku: 2 stukken elk, daarna weigerde de API.** De melding: "You have reached your specified
API usage limits. You will regain access on 2026-12-01". Op het account van de gebruiker staat een
bestedingslimiet van ongeveer $5 per maand; die was na de steekproef van Opus bereikt (uitgegeven volgens
het kasboek: $4,73). De vergelijking tussen de modellen en de rest van de stukken wachtten tot de
limiet was verhoogd; het script stuurt mislukte opdrachten dan vanzelf opnieuw mee.

**16 november: limiet verhoogd, eerste vergelijking.** Sonnet en Haiku lazen dezelfde 300 stukken ($2,20
en $0,12). Vergeleken met Opus, op de ja/nee-feiten per stuk waar de meting op draait (tien bij nieuws,
zeven bij prospectussen en registraties): Sonnet gaf bij nieuws in 94 tot 99% van de stukken hetzelfde
antwoord en bij prospectussen in 96 tot 100%; Haiku in 92 tot 99% en 93 tot 98%. Op de losse velden
scheelde het meer: de rol van een prospectus was bij Sonnet in 90% van de stukken gelijk aan Opus, alle
soorten gebeurtenissen in een nieuwsstuk samen in 73%. De verschillen zaten niet in het lezen, maar in
vijf punten waar de vraagstelling twee lezingen toeliet:

1. Een doorlopend verkoopprogramma verkoopt tegen de koers van de dag. Sonnet noemde dat "een prijs die
   meebeweegt met de koers", Opus niet. Bedoeld was: een belegger of geldschieter die tegen een korting
   op de toekomstige koers mag kopen of omzetten.
2. Bij een registratie waarmee houders mogen doorverkopen beschreef Opus de plaatsing waar die aandelen
   uit kwamen; Sonnet liet dat leeg, omdat het bedrijf er zelf niets aan verdient. De registratie waarmee
   de belegger achter een kredietlijn doorverkoopt noemde Opus een kredietlijn, Sonnet een doorverkoop.
3. Kwartaalcijfers met een vooruitblik telde Opus als twee gebeurtenissen (cijfers, en een voornemen),
   Sonnet als één.
4. De toon van cijfers: een nettoverlies of een vertrekkende topman noemde Opus vaker negatief.
5. Twijfel over het voortbestaan die alleen in de opsomming van risico's staat: Sonnet telde hem, Opus
   niet.

**Aangescherpt (versie 2), vóórdat er één uitkomst naast de antwoorden lag.** Op twee manieren. De
vraagstelling zegt op die vijf punten nu wat er bedoeld is; er kwam een soort gebeurtenis bij
(reorganisatie of strategische heroriëntatie) en een beursgang met definitieve voorwaarden telt als
geprijsde uitgifte. En de feiten worden zo uit de antwoorden afgeleid dat een andere lezing niet meer
uitmaakt: een verkoopprogramma telt nooit als prijs die meebeweegt (dat is feit P2), een geprijsde
uitgifte (P1) is een prospectus met de definitieve voorwaarden van een verkoop door het bedrijf zelf, en
de doorverkoop achter een kredietlijn hoort bij de kredietlijn. Acht twijfelgevallen zijn eerst los
geprobeerd, daarna is de steekproef opnieuw gelezen door Opus en Sonnet ($4,63 en $2,21). Sonnet gelijk
aan Opus, beide keren met dezelfde afleiding van de feiten:

| Feit per stuk | Eerste vraagstelling | Aangescherpt |
|---|---|---|
| Nieuws: hard positief | 97,8% | 95,0% |
| Nieuws: uitgifte van aandelen | 95,0% | 97,2% |
| Nieuws: uitgifte geprijsd of gesloten | 96,7% | 98,9% |
| Nieuws: prijs die meebeweegt | 99,4% | 100% |
| Nieuws: noteringsprobleem of omgekeerde split | 97,8% | 99,4% |
| Nieuws: negatief | 93,9% | 96,1% |
| Prospectus: geprijsde uitgifte | 100% | 100% |
| Prospectus: verkoopprogramma of kredietlijn | 97,5% | 100% |
| Prospectus: houders mogen verkopen | 97,5% | 99,2% |
| Prospectus: prijs die meebeweegt | 96,7% | 98,3% |
| Prospectus: twijfel over het voortbestaan | 96,7% | 100% |
| Prospectus: regel voor kleine bedrijven | 100% | 99,2% |

Op de losse velden: de rol van een prospectus van 90% naar 98% gelijk, alle soorten gebeurtenissen in een
nieuwsstuk samen van 73% naar 84%. Dat is overeenstemming in de zin van de afspraak; de rest is dus door
Sonnet gelezen. Zacht positief nieuws (een voornemen) komt met de aangescherpte vraag nog maar in 2 van
de 180 nieuwsstukken voor.

**De rest: 4.638 stukken door Sonnet, in 27 bulkopdrachten.** Na ongeveer acht minuten was alles klaar;
geen enkel stuk mislukte en het vaste deel van de opdracht werd vrijwel altijd onthouden. Kosten $33,34,
dat is $0,007 per stuk.

Twee controles zonder uitkomsten:

- Twijfel over het voortbestaan volgens Sonnet tegenover de woorden "going concern" of "substantial
  doubt" in de tekst: gelijk bij 1.933 van de 1.940 prospectussen en registraties.
- De koers die een prospectus zelf noemt tegenover de koers op de kandidaat-dag (stukken van hoogstens
  drie dagen oud, 828 kandidaat-dagen): de middelste verhouding is 1,01 en bij 90% scheelt het minder dan
  een factor twee. De stukken hangen dus aan het goede bedrijf en de goede dag.

**Kosten volgens het kasboek: $47,37** van het plafond van $80.

| Onderdeel | Stukken | Kosten |
|---|---|---|
| Eerste steekproef: Opus, Sonnet, Haiku | 300 elk | $4,57 + $2,20 + $0,12 |
| Los geprobeerd (vraagstelling) | 15 | $0,30 |
| Tweede steekproef: Opus, Sonnet | 300 elk | $4,63 + $2,21 |
| De rest: Sonnet | 4.638 | $33,34 |

Het kasboek rekent tokens maal prijs; wat Anthropic werkelijk afschrijft staat in de console. Alle
antwoorden en het kasboek staan in `scripts/supersprinters/onderzoek/proefdata/`; die van de eerste
steekproef (versie 1) zijn bewaard maar tellen niet mee in de meting.

### 14.16 Uitkomst van de proef: geen feit dat meldingen betrouwbaarder maakt

**Het lezen van de stukken maakt de meldingen niet aantoonbaar betrouwbaarder.** Geen van de negentien
feiten haalt de vooraf vastgelegde lat op de kandidaat-dagen die een melding kunnen krijgen. Op alle
kandidaat-dagen samen halen twee feiten hem, allebei over een verse uitgifte van aandelen en allebei
alleen voor het aandeel grote verliezers. Voor de trefkans is er niets gevonden.

**Wat Claude vond** (`tekst_test.py`). In de 2.998 nieuwsstukken was de belangrijkste gebeurtenis het
vaakst: cijfers (476), een uitgifte van aandelen (455), bestuur (320), een lening of converteerbare
lening (254), een aandeelhoudersvergadering (185), een contract (175), een overname door het bedrijf
(128), een noteringsprobleem (106), een studie of besluit van een toezichthouder (97) en een omgekeerde
split (92). Een bod op het bedrijf zelf kwam 8 keer voor. Van de 1.940 prospectussen en registraties gaan
er 623 over doorverkoop door houders, 472 over een geprijsde uitgifte, 250 zijn een plankregistratie, 245
een doorlopend verkoopprogramma en 120 een kredietlijn in aandelen.

Op 37% van de kandidaat-dagen is er geen enkel stuk (geen nieuws in zeven dagen, geen prospectus of
registratie in negentig); op 20% is er bedrijfsnieuws van de laatste twee dagen. Voor de meeste sprongen
ligt er bij de SEC dus geen verklaring.

**De feiten, met het feit tegenover zonder**, op de kandidaat-dagen met een dagbeweging tot 30% (alleen
die kunnen een melding krijgen); stukken die bekend waren vóór de melding van de volgende ochtend:

| Feit | Kandidaat-dagen met het feit (2020–2024 en 2025–2026) | Raak vanaf de opening 2020–2024 | Raak vanaf de opening 2025–2026 | Grote verliezers 2020–2024 | Grote verliezers 2025–2026 |
|---|---|---|---|---|---|
| N1 bedrijfsnieuws in 2 dagen | 1.720 en 503 | 15,5% / 15,5% | 15,9% / 11,0% | 9,2% / 8,3% | 20,7% / 19,2% |
| N2 hard positief nieuws in 2 dagen | 373 en 114 | 15,3% / 15,5% | 13,2% / 12,1% | 11,3% / 8,3% | 11,4% / 20,0% |
| N3 zacht positief nieuws in 2 dagen | 37 en 26 | te weinig | te weinig | te weinig | te weinig |
| N4 uitgifte van aandelen in 7 dagen | 739 en 226 | 13,8% / 15,7% | 13,3% / 12,0% | 12,4% / 8,1% | 21,7% / 19,3% |
| N5 uitgifte geprijsd of gesloten in 2 dagen | 237 en 62 | 13,9% / 15,5% | 11,3% / 12,1% | 14,3% / 8,3% | 25,8% / 19,4% |
| N6 uitgifte met warrants in 7 dagen | 230 en 61 | 13,9% / 15,5% | 16,4% / 12,0% | 15,2% / 8,3% | 18,0% / 19,6% |
| N7 prijs die meebeweegt met de koers | 279 en 236 | 13,6% / 15,6% | 14,0% / 11,9% | 7,5% / 8,5% | 26,7% / 18,7% |
| N8 nieuwe koers of cryptostrategie in 7 dagen | 62 en 128 | 19,4% / 15,5% | 14,8% / 11,9% | 24,2% / 8,3% | 22,7% / 19,3% |
| N9 bod op het bedrijf in 7 dagen | 22 en 0 | te weinig | te weinig | te weinig | te weinig |
| N10 noteringsprobleem of omgekeerde split | 233 en 119 | 15,5% / 15,5% | 14,3% / 12,0% | 7,7% / 8,5% | 31,1% / 18,9% |
| N11 negatief nieuws in 7 dagen | 778 en 131 | 16,1% / 15,5% | 14,5% / 12,0% | 6,7% / 8,6% | 22,1% / 19,4% |
| N12 geen enkel stuk | 3.859 en 623 | 15,9% / 15,2% | 9,1% / 13,3% | 7,5% / 9,1% | 15,4% / 21,2% |
| P1 geprijsde uitgifte in 30 dagen | 1.036 en 147 | 12,5% / 15,9% | 14,3% / 12,0% | 11,8% / 8,0% | 20,4% / 19,5% |
| P2 verkoopprogramma of kredietlijn in 90 dagen | 817 en 396 | 18,6% / 15,2% | 12,4% / 12,1% | 9,5% / 8,3% | 25,8% / 18,1% |
| P3 houders mogen verkopen (90 dagen) | 974 en 530 | 11,5% / 16,0% | 13,8% / 11,6% | 9,0% / 8,4% | 20,2% / 19,3% |
| P4 uitgifte ≥ 20% van de uitstaande aandelen | 1.524 en 455 | 12,7% / 16,0% | 11,6% / 12,2% | 8,8% / 8,4% | 23,1% / 18,6% |
| P5 koers ≥ 20% boven uitgifte- of warrantprijs | 1.170 en 285 | 13,5% / 15,8% | 17,9% / 11,2% | 11,4% / 8,0% | 20,4% / 19,4% |
| P6 regel voor kleine bedrijven | 697 en 166 | 12,1% / 15,8% | 21,1% / 11,4% | 9,9% / 8,3% | 16,3% / 19,8% |
| P7 twijfel over het voortbestaan in het prospectus | 692 en 154 | 14,2% / 15,6% | 18,2% / 11,6% | 11,4% / 8,2% | 26,0% / 19,1% |

- **Geen feit haalt de lat** (beide perioden dezelfde kant op, minstens 5 punten, minstens 100
  kandidaat-dagen met het feit in elke periode).
- **Trefkans: niets.** Hard positief nieuws maakt een kandidaat niet vaker raak (15,3% tegen 15,5% en
  13,2% tegen 12,1%). Feiten die in 2020–2024 minder treffers gaven, gaven er in 2025–2026 juist meer:
  een registratie voor doorverkoop (11,5% tegen 16,0%, daarna 13,8% tegen 11,6%), de regel voor kleine
  bedrijven (12,1% tegen 15,8%, daarna 21,1% tegen 11,4%), een koers boven de uitgifteprijs.
- **Grote verliezers: de verse uitgifte komt het dichtst bij.** Een uitgifte die in de laatste twee
  dagen is geprijsd (N5) gaat in beide perioden samen met 6 punten meer grote verliezers, maar in
  2025–2026 zijn dat 62 kandidaat-dagen: te weinig. Een uitgifte met warrants (N6) wijst in 2025–2026 de
  andere kant op.
- **Op alle kandidaat-dagen** (ook de heel beweeglijke) halen N5 en N6 de lat wel, alleen op grote
  verliezers: 15,8% tegen 9,1% en 31,1% tegen 25,7% (N5, 292 en 122 kandidaat-dagen); 16,0% tegen 9,1% en
  31,0% tegen 25,7% (N6, 257 en 100). Per jaar: duidelijk in 2021 en 2025, zwak in 2026, niet in 2020.
- **Alleen wat op het slot al bekend was** geeft hetzelfde beeld; ook dan haalt geen feit de lat.
- **Alle feiten samen in een klein model** naast de kans en de beweeglijkheid, steeds geleerd op de
  jaren ervoor: het onderscheid wordt slechter in plaats van beter (treffers 0,56 → 0,48 in 2021–2024
  en 0,56 → 0,49 in 2025–2026; grote verliezers 0,64 → 0,56 en 0,69 → 0,65; 0,5 is raden). Wat het model in eerdere jaren leert, geldt in
  latere jaren niet meer.

**Als regel op de meldingen** (verkennend; nagespeelde meldingen in de VS, dagbeweging tot 30%), met
"verse uitgifte" voor N5, N6 of P1:

| Lat | Periode | Meldingen met een verse uitgifte (raak = vanaf het slot) | Zonder |
|---|---|---|---|
| 20% | 2020–2024 | 82: 13% raak, 17% grote verliezers, gemiddeld −1% | 630: 21% raak, 9%, gemiddeld +11% |
| 20% | 2025–2026 | 5: 3 raak, 1 grote verliezer | 47: 11% raak, 30%, gemiddeld −12% |
| 15% | 2020–2024 | 298: 16% raak, 13% grote verliezers, gemiddeld +6% | 2.606: 17% raak, 9%, gemiddeld +8% |
| 15% | 2025–2026 | 98: 16% raak, 19% grote verliezers, gemiddeld −7% | 969: 13% raak, 19%, gemiddeld 0% |
| 26% | 2020–2024 | 9: 4 raak, 2 grote verliezers | 85: 27% raak, 9%, gemiddeld +17% |

Bij de lat van 26% (de regel van nu) had in 2020–2024 één op de tien meldingen een verse uitgifte; in
2025–2026 waren er in de VS drie meldingen, geen ervan met een uitgifte. In 2020–2024 deden meldingen met
een verse uitgifte het bij de lat van 20% duidelijk slechter, in 2025–2026 is dat niet terug te zien.

**Besluit: er komt geen regel bij, en Claude telt niet mee in de kans of in de keuze welke meldingen
uitgaan.** Dat is de afspraak (alleen bouwen wat in beide perioden is bevestigd). Het is de derde test
die hetzelfde zegt: de registraties van 14.11, de kas van 14.14 en nu de inhoud van de stukken. Rond een
uitgifte zijn er meer grote verliezers, maar het verschil is te klein en te wisselend om meldingen op
tegen te houden, en bij de strenge lat van nu komt het te weinig voor om het te kunnen bewijzen.

Wat de proef wel heeft opgeleverd:

- Het lezen zelf werkt en is goedkoop: $0,007 per stuk met Sonnet en $0,015 met Opus (in bulk), en de
  twee modellen zijn het op de feiten van de meting in 95 tot 100% van de stukken eens. Een toelichting bij een melding ("twee dagen geleden een
  uitgifte van $6 miljoen tegen $1,05 met warrants", "kas voor vier maanden") is dus te maken voor een
  paar cent per melding. Zo'n toelichting maakt de melding niet betrouwbaarder; hij helpt bij het
  beoordelen.
- De vraag of nieuws iets toevoegt is voor Amerikaanse aandelen nu beantwoord met de stukken zelf, niet
  met een vermoeden.

Niet getest: nieuws buiten de SEC (persberichten die niet bij een 8-K zitten, berichten op sociale
media), aandelen buiten de VS, en wat er ná een melding gebeurt (zie 14.17).
