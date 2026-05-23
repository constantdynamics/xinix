# Xinix — Volledige data-export

> Automatisch wekelijks gegenereerd. Dit is een **kennisbehoud-archief**:
> als de Xinix-website ooit verdwijnt, bevat dit bestand alle opgebouwde
> data én de uitleg om er meteen mee verder te kunnen.

**Laatste export:** 2026-05-21T03:19:35.395744+00:00  
**Totaal rijen:** 18.128

## Bestanden

- `xinix-data-export.json` — de volledige export: uitleg + alle data.
- `README.md` — dit bestand.

## Wat is Xinix?

Xinix is een fictieve belegger die leert beleggen door te experimenteren. Het systeem onderhoudt een watchlist van 3700+ aandelen (biotech + mining), detecteert koers- en nieuwssignalen, en test beleggingsstrategieën op papier (geen echt geld). Er zijn twee gesimuleerde portefeuilles: (1) een 200-strategie-simulatie — 200 parallelle papieren portefeuilles van $10.000, elk met andere parameters, die wekelijks evolueren (slechtste 5% gepensioneerd, beste 5% gemuteerd); en (2) één gecureerde 'single paper portfolio' die het beste leert beleggen. Het doel: ontdekken welke selectie- en exit-regels historisch het beste werken.

## Architectuur

Frontend: React + TypeScript op GitHub Pages. Backend: Supabase Edge Functions (Deno/TypeScript) + PostgreSQL. Scheduling via pg_cron. Dagelijks na de Amerikaanse beurssluiting draaien de simulaties; wekelijks de evolutie; periodiek de kennis-exports. Koersen komen van Yahoo Finance, nieuws/catalysts van Google News RSS en ClinicalTrials.gov/openFDA.

## Inhoud van de export (rijen per tabel)

| Tabel | Rijen | Beschrijving |
|---|---:|---|
| `signal_tickers` | 3.700 | De watchlist — de meest waardevolle, met de hand gecureerde data. Eén rij per aandeel. Sleutelvelden: ticker, company, sector (biotech/mining), goud_score, medal_gold/silver/bronze, buy_limit, is_phoenix/is_poefie/is_hikkertje (speciale koerspatroon-classificaties), active. |
| `signal_price_summary` | 3.684 | Laatste bekende slotkoers per ticker. Volledig. Sleutelvelden: ticker, last_close. |
| `signal_events` | 2.000 | Gedetecteerde gebeurtenissen — ingekort tot de recentste ~2000. Sleutelvelden: ticker, signal_type, severity (yellow/orange/red), title, detail, detected_at, payload. |
| `signal_catalysts` | 133 | Aankomende/recente fundamentele catalysts (resource estimate, PFS, FDA-besluit, ...). Volledig. Sleutelvelden: ticker, catalyst_type, expected_date, status. |
| `signal_scores` | 2.000 | Berekende scores per ticker — ingekort tot de recentste ~2000. Sleutelvelden: ticker, scan_date, structural, catalyst, timing, final_score, action. |
| `xinix_strategies` | 553 | Config van alle simulatie-strategieën (incl. gepensioneerde). Volledig. Sleutelvelden: id, slug, name, grp, config (JSON), generation, active, parent_id. |
| `xinix_strategy_state` | 553 | Kas + kapitaal per strategie. Volledig. Sleutelvelden: strategy_id, cash, initial_capital, max_equity, max_drawdown_pct. |
| `xinix_strategy_positions` | 4.493 | Alle open + gesloten posities van de simulaties. Volledig. Sleutelvelden: strategy_id, ticker, qty, avg_price, opened_at, closed_at, return_pct, partial_exits. |
| `xinix_paper_positions` | 10 | Posities van de single gecureerde papieren portefeuille. Volledig. |
| `xinix_paper_config` | 1 | Configuratie van de single paper portfolio (stop-loss, positiegrootte, ...). Volledig. |
| `market_regime` | 1 | Huidige marktfase op basis van SPY + VIX. Velden: regime (strong_bull/weak_bull/bear), spy_close, ma_50, ma_200, vix_close. |
| `xinix_knowledge_exports` | 0 | Maandelijkse kennis-snapshots (samenvatting + markdown). Zonder export_data-blob. |
| `signal_runs` | 1.000 | Log van edge-function-runs (recentste ~1000). Ingekort. Velden: job, ok, message, metrics, started_at/finished_at. |

## Een vervangende site bouwen

Een vervangende website bouwen: (1) maak een PostgreSQL-database met de tabellen uit 'tabellen' als schema; (2) importeer de rijen uit 'data'; (3) de watchlist (signal_tickers) en de strategie-resultaten (xinix_strategies + _state + _positions) zijn de kern — daarmee weet je welke parameters historisch werkten; (4) koersen en nieuws kun je opnieuw ophalen, maar de gecureerde watchlist en de leerresultaten zijn onvervangbaar. Dit bestand alleen al is genoeg voor een vliegende start.

---

De volledige veld-uitleg en concepten staan ook in `xinix-data-export.json` onder de sleutel `documentation`.
