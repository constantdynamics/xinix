# v1.1 adaptatie plan — briefing → xinix

**Versie**: 1.0 (mapping)
**Datum**: 2026-05-07
**Bron**: Claude Code Briefing v1.1 (overdrachtsdocument signal_toolkit Python project)
**Doel**: in kaart brengen welke briefing-concepten al in xinix zitten, welke ontbreken, en in welke volgorde we ze toevoegen — zonder de bestaande pollers/UI/dispatch te breken.

---

## 0. TL;DR

De Python‑toolkit‑briefing en xinix delen ~40% gemeenschappelijke
methodologie maar verschillen fundamenteel in:

- **Score‑aggregatie**: xinix heeft één `goud_score` per ticker; briefing
  vraagt drie sub‑scores (S/C/T) met geometric mean.
- **Action labels**: xinix gebruikt severity (yellow/orange/red) per
  *signal*; briefing gebruikt action labels (STRONG_BUY → AVOID) per
  *ticker*.
- **Trader output**: xinix heeft geen TradeSetup; briefing eist entry,
  target, stop, R:R, position size, exit signals.
- **Forward returns**: xinix heeft `signal_backtest_results` voor
  historische cases; briefing eist nightly tracking voor live signals.
- **Trial design / mining quality / commodity cycle**: in xinix
  helemaal niet aanwezig; briefing v1.1 hangt hier de hele
  discrimination‑uplift aan op.

Dit is geen "patch" — dit is een **scoring‑engine herschrijving** die
3‑5 fases nodig heeft.

---

## 1. Wat al overeenkomt

| Briefing concept | xinix equivalent | Status |
|---|---|---|
| Sectoren biotech + mining | `signal_tickers.sector` | ✓ |
| Catalyst events | `signal_catalysts` | ✓ |
| Pre‑event severity windows | severity ramp 7d/14d/30d/60d | ✓ |
| Insider activity tracking | `signal_filings` (EDGAR) | ✓ partial |
| Pricing + EMAs | `signal_prices` + summary | ✓ |
| Macro/commodity cycle data | `signal_macro` (27 rows) | ✓ partial |
| Risk adjusters (going concern, dilution) | enkele in `signal_tickers` | ✓ partial |
| Mining factor count | `factor_count` + `factors_json` | ✓ |
| Historische backtest | `signal_backtest_results` (107 cases) | ✓ |
| Dedup logica | `insertSignal()` met dedup_key | ✓ |
| Cron-driven scan loop | Netlify scheduled functions | ✓ |
| YAML‑driven config | env vars + hardcoded gewichten | ✗ (ad hoc) |

## 2. Wat ontbreekt — gemapt op briefing‑hoofdstukken

### Briefing §4: Driedimensionaal scoring model
**Mist volledig.** xinix heeft één score per ticker (`goud_score`)
en aparte severity per signal event. Nodig:
- Nieuwe tabel `signal_scores` met `ticker, scan_date, structural,
  catalyst, timing, confluence, risk_penalty, final_score, action,
  mode (investor|trader), expected_outcome jsonb, trade_setup jsonb`
- Module `_lib/scoring.mts`: weighted contributions per groep + geom.
  mean + theoretical_max berekening
- Module `_lib/theoretical_max.mts` met `GROUP_PATTERNS` (regex) —
  zonder dit krijgen we de bug uit briefing §4.3 (alle scores 1.00)

### Briefing §4.3: Theoretical max grouping
**Mist.** Cruciaal voor correcte normalisatie. Implementatie:
TS object met `{ pattern: RegExp, group: string }` lijst. Bij elke
nieuwe signaal‑weight verifiëren dat het in de juiste groep valt.

### Briefing §4.4: Investor vs Trader mode
**Mist.** Nodig: `mode` query param + aparte weight‑sets.
TradeSetup builder voor trader mode met entry/target/stop/R:R/size/
max_hold/exit_signals.

### Briefing §6.1.1: Trial design quality (biotech)
**Mist.** Velden om toe te voegen aan `signal_trials` of nieuwe tabel
`signal_biotech_specific`:
- `patient_population_severity` (early/moderate/late)
- `endpoint_duration_weeks`
- `mechanism_has_clinical_precedent` bool
- `primary_endpoint_powered_for_subgroup` bool
- `prior_crl_count` int
- `label_narrowed_after_crl` bool
- `has_ex_us_safety_dataset` bool
- `fda_advisory_committee_outcome` enum

Bron: clinicaltrials.gov v2 API + FDA briefing docs (handmatig
voor topcases, scrape later).

### Briefing §6.1.2: Sell‑the‑news risk check
**Mist.** Veld `pre_event_ytd_return_pct` in `signal_tickers` (afleidbaar
uit `signal_prices` 1y window). Penalty bij run‑up >100% (-0.05 mild,
-0.15 moderate, -0.25 extreme).

### Briefing §6.1.3: Mining quality differentiators
**Mist alle 4 sub‑modules**:
- Geological setting (dual gravity+mag anomaly, cover depth, prior geophysics)
- Processing technology (proven vs unproven DLE/Lilac/etc)
- Operational status (operational vs pre‑development)
- Share structure (tight float, recent consolidation, promoter concentration)

Velden toevoegen aan `signal_tickers` of nieuwe `signal_mining_specific`.
Bron: parse ASX/SEDAR persberichten — fragiel, dus eerst handmatig
gevuld voor watchlist‑namen.

### Briefing §6.1.4: Commodity cycle filter
**Mist als multiplier.** xinix heeft `signal_macro` met commodity
prices, maar het wordt niet als final_score multiplier toegepast.
Implementatie: `detect_cycle_phase(commodity)` → bull/neutral/bear,
multiplier 1.0/0.85/0.50 (strenger in trader: 1.0/0.80/0.40).

### Briefing §6.1.5: Catalyst baselines
**Mist.** Statische lookup `{p3_readout: 0.30, pdufa: 0.40,
tier1_drilling: 0.55, …}` om in UI naast elke signal de baseline
hit‑rate te tonen.

### Briefing §6.1.6: Expected outcome (peak vs T+90)
**Mist.** Per catalyst type een PEER_PEAK_RETURNS lookup +
sector ratio (biotech 0.35, mining 0.55) voor T+90 mediaan. Zonder
dit blijft de gebruiker denken dat het buy‑and‑hold targets zijn.

### Briefing §8.3: Forward returns tracking
**Mist als nightly job.** `signal_backtest_results` bestaat voor
historische cases, maar er is geen job die voor élk live signal van
N=7/14/30/90 dagen oud de huidige prijs ophaalt en hit/miss
classificeert. Nieuwe tabel `signal_forward_returns` + cron job.

### Briefing §10: App UX
**Deels.** Dashboard bestaat, maar mist:
- Per signal: breakdown van S/C/T met component contributions
- TradeSetup card (entry/target/stop/R:R)
- Expected outcome card (peak target + T+90 + exit window warning)
- Track record view (hit rate per action over rolling 30/90/180d)

---

## 3. Voorgestelde fases

Elke fase eindigt met **werkende deploy + groen pad door bestaande
tests**. Geen fase wordt gemerged voordat de vorige stabiel is.

### Fase 1 — Scoring engine fundament (1‑2 dagen)
**Goal**: ticker krijgt naast `goud_score` ook `structural/catalyst/
timing/confluence/final_score/action`. Backwards‑compatible (bestaande
severity blijft).

- [ ] Migratie: nieuwe tabel `signal_scores`
- [ ] `_lib/theoretical_max.mts` met GROUP_PATTERNS + tests
- [ ] `_lib/scoring/biotech.mts` en `mining.mts` met weight tabellen
  (start met de YAML‑inhoud uit briefing Appendix B als TS const)
- [ ] `_lib/scoring/aggregator.mts`: geom mean + risk penalty +
  cycle multiplier (mining)
- [ ] `_lib/scoring/action_labels.mts`: 5‑level mapping met thresholds
- [ ] Refactor `compute-signals-background` om per actieve ticker S/C/T
  te berekenen en op te slaan in `signal_scores`
- [ ] UI: nieuwe kolommen op Dashboard tabel

**Niet in fase 1**: trader mode, TradeSetup, expected outcome,
trial_design — daarvoor moet de basis eerst staan.

### Fase 2 — Trader mode + TradeSetup (1 dag)
- [ ] Tweede weight‑set in `_lib/scoring/biotech.mts` /
  `mining.mts` (`MODE.TRADER` vs `MODE.INVESTOR`)
- [ ] `_lib/scoring/trade_setup.mts`: entry/target/stop/R:R/size/
  max_hold/exit_signals
- [ ] `signal_scores.trade_setup jsonb` kolom + zichtbaar in UI
- [ ] R:R minimum check (default 3.0) met `notes` veld bij subpar

### Fase 3 — Sell‑the‑news + commodity cycle filter (0.5 dag)
- [ ] `pre_event_ytd_return_pct` afleiden uit `signal_prices`
- [ ] Penalty toepassen in biotech aggregator (asymmetrisch)
- [ ] `detect_cycle_phase()` op `signal_macro` (lithium/au/ag/cu/REE/Sb)
- [ ] Multiplier op final_score in mining aggregator

### Fase 4 — Trial design + mining quality velden (1‑2 dagen)
- [ ] Migraties: nieuwe kolommen op `signal_tickers` of nieuwe tabellen
  `signal_biotech_specific` / `signal_mining_specific`
- [ ] Eerste vulling **handmatig** voor watchlist‑namen — geen scraper
  zonder validatie
- [ ] `trial_design.mts` weights + integratie in catalyst sub‑score
- [ ] `mining_quality.mts` 4 sub‑modules + integratie in structural
- [ ] Lookalike pair tests: ETNB vs AKRO, AKBA vs APLT, UAMY vs PPTA
  — assert dat winner > loser

### Fase 5 — Forward returns + expected outcome (0.5‑1 dag)
- [ ] Nieuwe tabel `signal_forward_returns`
- [ ] Nightly Netlify scheduled function die voor elk signal van
  N=7/14/30/90 dagen oud de Yahoo prijs trekt en hit/miss berekent
- [ ] `expected_outcome.mts` met PEER_PEAK_RETURNS + catalyst baselines
- [ ] UI: per signal de peak target / T+90 target / exit window /
  baseline hit‑rate display
- [ ] Track record view (hit rate per action, rolling 30/90/180d)

### Fase 6 — Validatie & herkalibratie (continu, na 30 dagen live)
- Pas na fase 5 draait + 30+ live signalen heeft. Volgens
  briefing §11.3.3: "Validatie‑driven, niet intuïtie‑driven."
- Geen weight‑aanpassingen tot er forward returns zijn.

---

## 4. Vraag aan de owner

Drie vragen voordat ik begin:

1. **Welke fase eerst?** Mijn voorkeur: fase 1 (fundament). Zonder S/C/T
   sub‑scores in DB werken alle andere fases niet.
2. **Mode default**: investor of trader? Briefing zegt dat de owner
   swing trades wil → trader, maar fase 1 werkt voor allebei.
3. **Trial design / mining quality velden**: handmatig invullen voor
   ~50 watchlist tickers (1 avond werk) of pas later via scrapers
   (weken werk, fragiel)?

---

## 5. Wat ik NIET ga doen

Volgens briefing §11.3:

- Geen weights tweaken op anekdotes — pas data‑driven na fase 5.
- Geen 10 signalen tegelijk toevoegen — één per PR, met meting.
- Geen drempels lager zetten om "meer successen" te claimen — dat is
  zelfbedrog (briefing C.8).
- Geen scrapers bouwen voor sources die ik niet heb gevalideerd —
  eerst handmatig vullen, dan scraper als veld bewezen waarde heeft.

---

## 6. Bestaande security‑debt eerst oplossen

Supabase advisor flagt: `signal_macro` en `signal_backtest_results`
hebben geen RLS. Voor productie (briefing §10.5 multi‑user) moet dit
opgelost. Voorgestelde SQL (laat de owner dit zelf draaien — beslis
of de service‑role bypass voldoende is of dat aparte policies nodig
zijn):

```sql
ALTER TABLE public.signal_macro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_backtest_results ENABLE ROW LEVEL SECURITY;
-- Plus policies, bv:
CREATE POLICY "anon_read" ON public.signal_macro
  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON public.signal_backtest_results
  FOR SELECT TO anon USING (true);
```
