# Gegevens van de proef met het API-tegoed (15 november 2026)

De onderzoeksgegevens van SUPERsprinters staan in een tijdelijke map (zie `../../README.md`) en zijn te groot voor de
repository. Deze map bevat het kleine deel dat nodig is om de proef van rapport 14.13 af te maken of na te rekenen
zonder de hele dataset opnieuw op te bouwen:

| Bestand | Inhoud |
|---|---|
| `cand_sec.parquet` | de 13.696 Amerikaanse kandidaat-dagen (kans vanaf 15%, omzet vanaf $100.000) met de uitkomst: `y` raak vanaf het slot, `yo` raak vanaf de opening, `r10o` rendement na tien handelsdagen vanaf de opening, `p_glob` de kans, `vw` de dagbeweging van de week, `px` de koers, `cik` het nummer van het bedrijf bij de SEC |
| `tekst_docs.parquet` | de 4.940 gekozen stukken (bedrijf, nummer van het stuk, soort, de twee momenten waarop het bekend was) |
| `tekst_cand.parquet` | welke stukken bij welke kandidaat-dag horen |
| `kasboek.json` | (zodra er verstuurd is) de nummers van de bulkopdrachten bij de Claude API en wat ze kostten; de uitkomsten blijven daar 29 dagen opvraagbaar |
| `uit_*.jsonl.gz` | (zodra ze er zijn) de antwoorden van Claude per stuk |

Terugzetten in een nieuwe werkmap:

```bash
mkdir -p ssdata/sec/claude && cp proefdata/*.parquet ssdata/sec/ && cp proefdata/kasboek.json proefdata/uit_*.jsonl.gz ssdata/sec/claude/ 2>/dev/null; gunzip -kf ssdata/sec/claude/uit_*.jsonl.gz 2>/dev/null
```

Daarna haalt `tekst_haal.py` de teksten opnieuw op (±1 uur) en `kas_haal.py` de cijfers uit de verslagen (±30 minuten);
`tekst_test.py` en `kas_test.py` hebben alleen deze bestanden en de antwoorden nodig.
