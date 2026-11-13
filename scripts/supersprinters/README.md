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
zien wat er geschreven zou worden, zonder iets te schrijven of te melden.

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
`compare.py` (tussentijdse vergelijkingen).

Na opnieuw trainen: `public/ss-model.json` vervangen, het controlegetal (`MODEL_SHA256`) in
`supabase/functions/xinix-supersprint/core.ts` bijwerken, `test_core.ts` draaien en de functie opnieuw
uitrollen. De functie weigert een model waarvan het controlegetal niet klopt.
