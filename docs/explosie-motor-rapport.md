# Explosie-motor en Sprinters — rapport voor/na (25–26 september 2026)

Doel: meer aandelen vinden die voldoen aan de criteria van Hippos, Raketten, de Scanner (5-sterren en
Feniks), Hikkertjes en Poefies, en de voorspellende waarde van elk onderdeel meten in plaats van schatten.
De definities van de onderdelen zijn niet veranderd.

## 0. Update 26 september: alleen nog ≥4★

Op jouw verzoek draait de motor nu **alleen voor favorieten met minstens 4 sterren** (145 aandelen):

- de dagelijkse sweep van ~20.300 aandelen staat uit;
- automatisch toevoegen aan de watchlist staat uit;
- de deep-scan meet alleen nog ≥4★-aandelen;
- kansen, treffers en open voorspellingen van andere aandelen zijn gewist;
- de Sprinters-run werkt elke 2 uur de kansen op alle tabbladen bij, alleen voor ≥4★.

De tellingen uit 10 jaar koersdata (de pool van 6.000 aandelen) blijven de basis van het model, maar er
wordt voor andere aandelen niets nieuws meer gemeten. De cijfers hieronder beschrijven de eerste meting van
25 september.

## 1. Bereik

| | Voor | Na |
|---|---|---|
| Aandelen die bekeken worden | ~2.530 (watchlist) | ~20.300 op 20 Saxo-markten (TradingView-sweep, dagelijks) |
| Aandelen met 10 jaar dagkoersen doorgemeten | 2.445 (alleen Hippos) | 13.644 (watchlist + beweeglijk universum) |
| Handelsdagen in het model | 4,56 mln (Hippos) | 8,7 mln (pool van 6.000 aandelen) |
| Actieve watchlist | 2.535 | 2.637 |
| Hikkertjes op de watchlist | 76 | 106 |
| Poefies op de watchlist | 919 | 1.019 |
| Gevallen feniksen op de watchlist | 6 | 12 |

De 100 toevoegingen van de eerste dag (het dagplafond) kwamen uit 11 markten: 45 VS, 26 Hongkong,
7 Canada, 5 Zweden, 5 Frankrijk, 4 Noorwegen, 3 VK, 2 Duitsland en elk 1 uit Polen, Australië en Japan.
Buiten de watchlist voldoen nu nog 60 hikkertjes, 314 poefies, 55 feniksen, 56 sterren, 163 hippo's
en 485 raketten aan hun criterium; die komen er met 100 per dag bij.

## 2. Voorspellende waarde: gemeten, niet geschat

Per event de gemiddelde kans en het plafond (de hoogste kansklasse die in de historie gemeten is,
met minstens 1.000 dagen):

| Event | Basiskans | Plafond nu | Plafond oude Hippos |
|---|---|---|---|
| +50% binnen 7 dagen | 0,9% | 19,1% | 8,4% |
| +50% binnen 14 dagen (10 handelsdagen) | 2,3% | 21,8% | 13,0% |
| +50% binnen 21 dagen | 3,8% | 25,2% | 17,1% |
| Nieuwe hikkertje-spike binnen 30 dagen | 1,0% | 26,4% | — |
| Nieuwe hikkertje-spike binnen 90 dagen | 2,6% | 37,1% | — |
| Nieuwe poefie binnen 30 dagen | 0,8% | 21,5% | — |
| Nieuwe poefie binnen 90 dagen | 2,1% | 30,2% | — |
| Maand met +150% binnen 6 maanden (raket) | 7,5% | 41,9% | — |

De kopgroep is dus veel scherper af te bakenen dan voorheen. Het plafond voor 14 dagen ging van
13% naar 22%. Oorzaak: meer data, 19 in plaats van 8 kenmerken, en een demping op het model
(`DAMP = 0,35`). Het ruwe model bleek ~3× te stellig: 11% van alle dagen belandde in de hoogste klasse,
waardoor de hele kopgroep één en dezelfde kans kreeg.

## 3. Welke kenmerken ertoe doen (regel: minstens 1,5× effect)

- **Gebruikt** (15–17 van de 19 per event): 1-, 5- en 22-daags rendement, 6-maands rendement (U-vormig),
  volume, dagen sinds de vorige +50%-piek, afstand tot 1j-top en 5j-top, afstand tot 1j-bodem,
  beweeglijkheid, dollarvolume, hikkertje-spikes, dagen sinds de vorige poefie en feniks.
- **Valt af**: het small-cap-regime (IWM) en de positie in de 90-daagse band; de koers in dollars bij
  een deel van de events.
- **Opvallend**: het **5-sterren-DNA voorspelt vrijwel niets**. De backtest geeft ×1,0–1,7 en de fit valt
  bij de meeste events onder de drempel. De Scanner is dus een goede zeef op *soort* aandeel, maar
  geen timing-signaal.

## 4. Backtest van de vaste criteria (h14: +50% binnen 10 handelsdagen)

| Criterium | Keer de basiskans |
|---|---|
| Hikkertje (≥2 spikes in een jaar) | ×3,7 (voor een nieuwe spike binnen 30 dagen: ×8,6) |
| +50%-piek in de afgelopen 45 dagen | ×2,7 |
| Gevallen feniks | ×2,5 |
| Poefie in de afgelopen 2 jaar | ×2,3 |
| Ooit een poefie (10 jaar) | ×2,0 |
| 5-sterren-fit ≥ 80 | ×1,4 |

## 5. Sprinters (nieuw tabblad)

Favorieten → ⚡ Sprinters: je 145 aandelen met ≥4★, elke 2 uur op werkdagen doorgerekend op verse
koersen, met gemeten nieuws erbij:

- biotech: goedkeuring, doorbraak of positieve resultaten, en een beslissing die binnen 14 dagen valt;
- mijnbouw: sterke boorresultaten, resource-updates, studies en vergunningen;
- overnames, samenwerkingen, financieringen en 8-K's.

Het nieuws wordt alleen voor je 4- en 5-sterrenaandelen verzameld, gemeten en meegewogen (~1.500
berichten van ~85 aandelen sinds mei). Een nieuwssoort telt alleen mee als hij aantoonbaar verschil maakt.

Melding vanaf 15% (≈ 6× de basiskans), hoogstens 3 per week, met ntfy-prioriteit 5. Eerste meting:
de hoogste kans is 11,9%, dus nog geen melding.

## 6. Track record

Het enige cijfer waar achteraf niet aan te sleutelen valt:

- **Motor:** legt per event dagelijks de kopgroep en verhoogde favorieten vast. Dat waren 1.161 voorspellingen
  op de eerste dag.
- **Sprinters:** legt dagelijks alle ≥4★ vast.
- **Wanneer de uitkomsten komen:** na 10 handelsdagen voor Hippos en Sprinters, en na 1 tot 6 maanden voor de
  andere events.
- **Oude Hippos (nulmeting):** sinds 16 september 1.832 voorspellingen afgerekend, 16 raak (0,87%), gemiddeld
  voorspeld 1,28%. De kansklasse van 8–12% haalde 5,4%.

## 7. Wat bewust níet is gedaan

- Hippos en Raketten schrijven nog uit hun eigen, oude functie. Overstappen doen we pas als het track record
  van de motor minstens even goed blijkt.
- Een melding "80% zeker" blijft onmogelijk. Geen enkele kansklasse in 10 jaar data komt daarbij in de buurt.
