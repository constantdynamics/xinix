# Gegevens van de proef met het API-tegoed (15–16 november 2026)

De onderzoeksgegevens van SUPERsprinters staan in een tijdelijke map (zie `../../README.md`) en zijn te groot voor de
repository. Deze map bevat het kleine deel dat nodig is om de proef van rapport 14.13 na te rekenen zonder de hele
dataset opnieuw op te bouwen:

| Bestand | Inhoud |
|---|---|
| `cand_sec.parquet` | de 13.696 Amerikaanse kandidaat-dagen (kans vanaf 15%, omzet vanaf $100.000) met de uitkomst: `y` raak vanaf het slot, `yo` raak vanaf de opening, `r10o` rendement na tien handelsdagen vanaf de opening, `p_glob` de kans, `vw` de dagbeweging van de week, `px` de koers, `cik` het nummer van het bedrijf bij de SEC |
| `tekst_docs.parquet` | de 4.940 gekozen stukken (bedrijf, nummer van het stuk, soort, de twee momenten waarop het bekend was) |
| `tekst_cand.parquet` | welke stukken bij welke kandidaat-dag horen |
| `steekproef.json` | de 300 stukken van de steekproef (180 nieuws, 120 prospectus of registratie) |
| `kasboek.json` | de nummers van de bulkopdrachten bij de Claude API, de versie van de vraagstelling en wat ze kostten; de uitkomsten blijven daar 29 dagen opvraagbaar |
| `uit_<model>_alles.jsonl.gz` | de gelukte antwoorden van Claude per stuk op de vraagstelling van versie 2: hier draait de meting op (`tekst_batch.py … bewaar proefdata` schrijft ze) |
| `v1_uit_<model>_alles.jsonl.gz` | de antwoorden van de eerste steekproef (versie 1 van de vraagstelling, 300 stukken door Opus, Sonnet en Haiku); alleen gebruikt om de vraagstelling aan te scherpen, tellen niet mee in de meting |

Terugzetten in een nieuwe werkmap:

```bash
mkdir -p ssdata/sec/claude/v1 && cp proefdata/*.parquet ssdata/sec/ && cp proefdata/kasboek.json proefdata/steekproef.json proefdata/uit_*.jsonl.gz ssdata/sec/claude/ && cp proefdata/v1_uit_*.jsonl.gz ssdata/sec/claude/v1/ && gunzip -f ssdata/sec/claude/uit_*.jsonl.gz ssdata/sec/claude/v1/*.gz && for f in ssdata/sec/claude/v1/v1_uit_*; do mv "$f" "${f/v1_uit_/uit_}"; done
```

Daarna draait `tekst_test.py ssdata` de meting (met `kas_test.py` erbij als `kas_haal.py` de cijfers uit de verslagen
opnieuw heeft opgehaald, ±30 minuten). De teksten zelf zijn alleen nodig om opnieuw te laten lezen of om een antwoord
naast de tekst te leggen: `tekst_haal.py` haalt ze in ±1 uur opnieuw op.
