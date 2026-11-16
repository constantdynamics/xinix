# SUPERsprinters: onderzoek en controles

Alles waarmee het model van SUPERsprinters is gemaakt en getest. De uitkomsten staan in
`docs/supersprinters-rapport.md`; de productiecode in `supabase/functions/xinix-supersprint/`.

## Controles (snel, zonder data)

```bash
node --experimental-strip-types scripts/supersprinters/test_core.ts <testvectors.json>
```

Bewijst dat de TypeScript-versie van het model exact dezelfde uitkomst geeft als LightGBM
(`testvectors.json` komt uit `train_final.py`). Met een marktnaam erachter haalt het script die markt
bij TradingView op en schrijft de kenmerken weg; `onderzoek/check_parity.py` legt ze dan naast de
kenmerken uit verse Yahoo-dagkoersen.

```bash
node --experimental-strip-types scripts/supersprinters/smoke.ts amerika 2026-11-13 <fx.json>
```

Droogloop van een hele ronde tegen het echte TradingView en Yahoo met een nagebootste database: laat
zien wat er geschreven zou worden, zonder iets te schrijven of te melden. Met `alerts` erachter volgt het
meldmoment tegen een nagebootste ntfy-server; `PRE='[[…],[…]]'` zet eerdere meldingen klaar en draait
meerdere gevallen na elkaar (weekplafond, herhaalregel), `NTFY=down` maakt de server onbereikbaar.
`MIN_PROB`, `MIN_DVOL`, `MAX_VOLW`, `MAX_WEEK` en `REGIONS` zetten de meldregels (lat, omzeteis, grens op
de beweeglijkheid, weekplafond, regio's die mogen melden).

```bash
node --experimental-strip-types scripts/supersprinters/smoke.ts resolve <open.json> <fx.json>
```

Rekent voorspellingen af tegen echte Yahoo-koersen. `open.json` is een lijst `{ticker, made_on, y}`; met
`y` (de uitkomst uit het onderzoek) erbij vergelijkt het script de twee. Zo getest op 138 voorspellingen
uit oktober 2026 in alle vier de regio's: 138 gelijk. Met `yo`, `r10o` en `gap1` erbij (de uitkomsten
vanaf de opening van de volgende dag) worden ook die vergeleken: 105 voorspellingen uit september en
oktober 2026, alle gelijk.

## Het onderzoek opnieuw doen (map `onderzoek/`)

Data komt in `scripts/supersprinters/ssdata/` (staat in `.gitignore`; reken op ±30 GB en een uur).
Nodig: Python met numpy, pandas, pyarrow, lightgbm, scikit-learn, aiohttp, requests; Node 22.

| Stap | Script | Wat het doet |
|---|---|---|
| 1 | `universe.py ssdata/universe.parquet` | alle gewone aandelen op de 20 markten bij de TradingView-scanner |
| 2 | `download.py ssdata/universe.parquet ssdata/bars` | 10 jaar dagkoersen bij Yahoo (hervatbaar), plus wisselkoersen |
| 3 | `prep.py ssdata/bars ssdata/prep` | opschonen: splits, pence/pond, datafouten, datum in de tijdzone van de beurs (`clean.py`) |
| 4 | `make_engine_ref.py` en `harness.ts ssdata/prep 0 42` | het bestaande h14-model (`_shared/engine.ts`) op dezelfde reeksen |
| 5 | `build.py ssdata/prep ssdata/bars ssdata/feat` | kenmerken en uitkomst per aandeel per dag (`feat.py`) |
| 6 | `consolidate.py ssdata/prep ssdata/feat ssdata/all` | alles in één dataset; controleert dat de uitkomst gelijk is aan die van de motor |
| 7 | `exp.py lite_v3 lite_no5d+b+c 2019,…,2026 refit=1` | per testjaar een model dat alleen eerdere jaren zag |
| 8 | `final_eval.py lite_v3 ssdata/runs/final_lite_v3.json` | oud tegen nieuw op dezelfde aandelen en dagen (vier maatstaven) |
| 9 | `train_final.py ssdata/final` | definitief model → `public/ss-model.json`, testvectoren, startwaarden marktklimaat |

Overig: `check_tv.py` (definities van de TradingView-velden tegen de dagkoersen), `policy.py` en
`calib_exp.py` (ijking en meldregels), `finra.py` en `si_feat.py` (short interest: getest, voegt niets toe),
`compare.py` (tussentijdse vergelijkingen), `productie_check.py` (drie keuzes in de productiecode nagerekend
op de testvoorspellingen: hoeveel aandelen per run het afrekenen van het track record nodig heeft, de
bijsturing over de bewaarde kopgroep in plaats van de top 300, en de opstartregel van de bijsturing).

### Tweede ronde (15 november 2026): uitkomsten vanaf de opening en de meldregels

Bouwt voort op stap 1 tot en met 8 (de dataset in `ssdata/all` en de testvoorspellingen in `ssdata/runs`).

| Stap | Script | Wat het doet |
|---|---|---|
| a | `labels_open.py ssdata` | uitkomsten gerekend vanaf de opening van de dag na de voorspelling |
| b | `rsplit.py ssdata` en `mask_open.py ssdata` | gemiste omgekeerde splits en onbruikbare openingskoersen opsporen en weglaten |
| c | `open_modellen.sh` (`exp_open.py`) | vijf modellen op die uitkomsten, elk testjaar met een model dat het jaar niet zag |
| d | `reduce_open.py ssdata/runs/final_lite_v3_rows.parquet ssdata/runs/open_red` | per jaar alleen de rijen die ertoe doen (kandidaten en de hoogste 40 per dag) |
| e | `eval_open.py ssdata/runs/open_red` | rangschikkingen en meldregels vergeleken op kopen bij de opening |
| f | `ronde2_regels.py ssdata/runs/final_lite_v3_rows.parquet ssdata/runs/open_red` | bijsturing per regio, het weekplafond, een dag later instappen, de lat |
| g | `ronde2_risico.py ssdata/runs/open_red` | verliesrisico: de beweeglijkheid van de week als aanwijzer, de regel op meldingen |
| h | `ronde2_keuzes.py ssdata ssdata/runs/open_red` | de regels van 15 november: lat zonder weekplafond, per regio, limietorder en verkooplimiet nagespeeld |

`gap_rule.py` en `region_open.py` zijn de eerste verkenningen van de opening en de regio's. De uitkomsten
staan in hoofdstuk 14 van `docs/supersprinters-rapport.md`.

### Berichten bij de SEC (alleen Amerikaanse aandelen)

Vanuit een Claude-sessie is sec.gov niet bereikbaar, en de SEC vraagt een afzender met contactgegevens.
Het ophalen loopt daarom via een tijdelijke hulpfunctie in Supabase, met dezelfde afzender als
`poll-edgar-background`.

| Stap | Script | Wat het doet |
|---|---|---|
| i | `sec_proxy.ts` | de hulpfunctie: per bedrijf de lijst van ingediende stukken (datum, soort, onderdelen van een 8-K, moment van ontvangst); sinds de proef met het API-tegoed ook de tekst van een stuk, cijfers uit de verslagen en het doorgeven van leesopdrachten aan de Claude API. Uitrollen als `xinix-ss-sec-onderzoek` met een eigen sleutel in de bron; na gebruik vervangen door een lege functie |
| j | `SEC_KEY=… python3 sec_fetch.py ssdata <url>` | haalt de lijsten op voor alle Amerikaanse aandelen die ooit kandidaat waren (hervatbaar, ±7 verzoeken per seconde) |
| k | `sec_test.py ssdata ssdata/runs/open_red` | per kandidaat-dag alleen wat op het slot al bekend was; kenmerk voor kenmerk, als model, en als regel op de meldingen |
| l | `thema_test.py ssdata ssdata/runs/open_red` | themakoorts: het klimaat in de eigen bedrijfstak en sector als los kenmerk, als tweede model en op de meldingen (geen signaal) |
| m | `stop_test.py ssdata ssdata/runs/open_red` | de meldingen nagespeeld met een vaste stop-order van 10 tot 40% (ruilt grote verliezen voor veel middelgrote) |
| n | `SEC_KEY=… python3 tekst_lijst.py ssdata <url>` | proef met het API-tegoed: per kandidaat-dag de stukken met tekst kiezen (nieuws van 7 dagen, prospectus en registratie van 90 dagen), met de twee momenten waarop een stuk bekend was |
| o | `SEC_KEY=… python3 tekst_haal.py ssdata <url>` | de tekst van die stukken ophalen (hervatbaar; `OPNIEUW=6-K` haalt 6-K's zonder bijlage opnieuw op) |
| p | `SEC_KEY=… python3 kas_haal.py ssdata <url>` | kas, kasstroom en aantal aandelen uit de jaar- en kwartaalverslagen (XBRL) |
| q | `SEC_KEY=… python3 tekst_batch.py ssdata <url> <opdracht>` | Claude de stukken laten lezen: steekproef, tokens tellen, in bulk versturen, uitkomsten ophalen, modellen vergelijken, kasboek met plafond; de sleutel voor de Claude API staat alleen in Supabase. De vraagstelling is versie 2 (aangescherpt na de eerste steekproef); antwoorden van versie 1 staan apart en tellen niet mee |
| r | `kas_test.py ssdata` | het deel zonder Claude: kas voor minder dan 6 of 12 maanden, positieve kasstroom, groei van het aantal aandelen (geen feit haalt de lat) |
| s | `tekst_test.py ssdata` | de meting op de antwoorden van Claude: de vooraf vastgelegde feiten met en zonder, als klein model naast de kans en als regel op de meldingen (`vlaggen.py` = de tabel en de lat, `tekst_feiten.py` = de afleiding van feiten per stuk). Uitkomst: geen feit haalt de lat op de dagen die een melding kunnen krijgen (rapport 14.16) |
| t | `bewaking_test.py ssdata` | bewaking na een melding, zonder Claude: wat gebeurt er als het bedrijf binnen tien handelsdagen na een melding een prospectus, registratie of onderhandse verkoop indient (geen verschil in 2020–2024, 4 tot 8 punten slechter in 2025–2026; haalt de lat niet) |

De kleine bestanden van deze proef (kandidaat-dagen met uitkomst, gekozen stukken, steekproef, het kasboek en alle antwoorden van Claude) staan in `onderzoek/proefdata/`, met uitleg hoe ze terug te zetten zijn: daarmee is de meting na te rekenen zonder opnieuw te betalen.

Na opnieuw trainen: `public/ss-model.json` vervangen, het controlegetal (`MODEL_SHA256`) in
`supabase/functions/xinix-supersprint/core.ts` bijwerken, `test_core.ts` draaien en de functie opnieuw
uitrollen. De functie weigert een model waarvan het controlegetal niet klopt.
