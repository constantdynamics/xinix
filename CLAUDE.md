# Xinix — Master kennisdocument voor Claude & gebruiker

> **Dit bestand is de enige bron van waarheid voor de gesimuleerde belegger.**
> Claude leest dit aan het begin van elke sessie. De gebruiker kan het ook lezen.
> De sectie "Laatste bevindingen" wordt automatisch bijgewerkt door de maandelijkse kennisexport.
> Bewerk alleen de secties die je zelf verantwoordelijk voor bent.

---

## 1. Wat is Xinix?

Xinix is een fictieve belegger die leert beleggen door te experimenteren.

- **Frontend**: React + TypeScript + Tailwind op GitHub Pages (`constantdynamics.github.io/xinix`)
- **Backend**: Supabase Edge Functions (Deno/TypeScript) + PostgreSQL
- **Scheduling**: pg_cron → `invoke_edge()` → dagelijkse en maandelijkse runs
- **Repository**: `constantdynamics/xinix`, branch `claude/poll-fundamentals-background-5TjhG`
- **Supabase project**: `zfcjugqgufsyltxhvkuu` (eu-west-1 / Ierland)

Er zijn twee gesimuleerde portefeuilles:

| Portefeuille | Functie | Schema |
|---|---|---|
| **100-strategie simulatie** | 106 parallelle papieren portefeuilles á $10.000 elk, elke strategie test andere parameters | `xinix_strategies`, `xinix_strategy_positions`, `xinix_strategy_state` |
| **Single paper portfolio** | Eén gecureerde papieren portefeuille die het beste leert beleggen | `xinix_paper_positions` |

---

## 2. Architectuur (end-to-end stroom)

```
[Watchlist + koersen in DB]
        │
        ▼ dagelijks 22:05 UTC (na US close)
xinix-trade-background     → beheert single paper portfolio
xinix-sim-background       → beheert 100+ strategieën parallel
        │
        ▼ wekelijks (evolutie)
xinix-evolve               → pensioneer onderste 5% → muteer top 5% → nieuwe Gen
        │
        ▼ 1e dag van de maand 06:00 UTC
xinix-knowledge-export     → snapshot van alle kennis → DB + docs/kennisbasis.md
        │
        ▼ 25e van de maand 08:00 UTC
xinix-knowledge-reminder   → herinnering via ntfy + email
```

**Koersen**: komen via `signal_price_summary` (dagelijks bijgewerkt door prijspuller).
**Signalen**: staan in `signal_tickers` (score, rood-signaal, sectoren, medailles, buy-limit).

---

## 3. Marktconforme transactiekosten

```
TX_COST = 0.001  (0,1% per transactie)
```

- **Kopen**: `cash -= qty × prijs × (1 + TX_COST)`
- **Verkopen**: `cash += qty × prijs × (1 - TX_COST)`
- Geldt overal: bij kopen, bij normale exits, bij vroegtijdige exits, bij deelwinst-verkopen.
- **Waarom 0,1%?** Marktconform voor kleine US posities via moderne brokers (IBKR, Alpaca).

---

## 4. Slimme exits (alle posities)

Elke open positie wordt dagelijks langs vier uitgangsregels gehaald:

### 4a. Trailing stop (stop ratchets omhoog met de koers)
```
Initieel:  stop_loss_price = entry_prijs × (1 - trailingStop%)
Dagelijks: nieuw_stop = huidige_prijs × (1 - trailingStop%)
           als nieuw_stop > huidig stop_loss_price → bijwerken in DB
Trigger:   huidige_prijs ≤ stop_loss_price
```
Elke strategie in groep N gebruikt trailing stop. De single paper portfolio gebruikt altijd trailing stop (-15%).

### 4b. Deelwinst (partial TP)
Bij strategieën mét een take-profit target:
```
Trigger:   prijs ≥ avg_price × (1 + tp × 0,5)   [halverwege het TP-target]
Actie:     verkoop helft van de positie
           sla op in partial_exits JSONB: [{qty_sold, net_proceeds, at, reason}]
           positie blijft open met resterende helft
```
Single paper portfolio: trigger bij +25%, geen TP vereist.

### 4c. Signaalverval exit
```
Trigger:   alle entry-signaaltypen verlopen (niet meer actief voor deze ticker)
           ÉN verlies > 3%
           ÉN held ≥ max(14d, holdDays × 0,33)
Actie:     sluit positie vroegtijdig
Reden:     "signal_decay"
```

### 4d. Kansrotatie (opreplace strategie)
```
Trigger:   portefeuille vol ÉN er is een kandidaat met rankScore ≥ 90
           ÉN slechtste open positie heeft verlies > -5%
Actie:     sluit slechtste positie, koop beste kandidaat
Reden:     "opportunity_replace"
```

### Rendement-berekening met deelwinsten
```typescript
origQty = huidig_qty + sum(partial_exits.qty_sold)
origCost = origQty × avg_price × (1 + TX_COST)
netProceeds_huidig = huidig_qty × prijs × (1 - TX_COST)
totaal = sum(partial_exits.net_proceeds) + netProceeds_huidig - origCost
```

---

## 5. De 106 strategieën (100-strategie simulatie)

Elke strategie beheert een eigen papieren portefeuille van **$10.000**.
Basisprofiel (`B`): Score≥65, geen rood vereist, alle sectoren, max 8 posities, $1200/positie, 60d, stop -15%, geen TP, limiet-buffer +10%, geen goud-eis, geen trailing.

| Groep | # | Dimensie die varieert |
|---|---|---|
| **A-Score** | 10 | Score-drempel: ≥0, ≥40, ≥50, ≥55, ≥60, ≥65, ≥70, ≥75, ≥80, ≥90 |
| **B-Hold** | 6 | Tijdvenster: 20d, 30d, 45d, 90d, 120d, 180d |
| **C-Stop** | 5 | Vaste stop-loss: geen, -10%, -20%, -25%, -30% |
| **D-TP** | 4 | Take-profit: +25%, +50%, +100%, +200% |
| **E-Sector** | 6 | Biotech-only (3 varianten), Mining-only (3 varianten) |
| **F-Concentratie** | 8 | Max posities (3–20) × positiegrootte ($400–$2500) |
| **G-Signaal** | 7 | Rood-signaal vereist, met score-varianten + sector |
| **H-Medaille** | 5 | Goud-medaille filter (≥1 of ≥2 goud) |
| **I-Limiet** | 5 | Buy-limit buffer: 0%, 5%, 10%, 20%, geen filter |
| **J-Exit-combo** | 8 | Combinaties van TP + stop-loss |
| **K-Profiel** | 5 | Agressieve profielen (hoog risico/hoog rendement) |
| **L-Profiel** | 5 | Conservatieve profielen (laag risico, gespreid) |
| **M-Combo** | 26 | Cross-dimensionele combinaties van bovenstaande |
| **N-Trailing** | 6 | Trailing stops (-10%, -15%, -20%), combinaties, kans-rotatie |

**Evolutie**: wekelijks worden de onderste 5% gepensioneerd, de top 5% gemuteerd.
Gepensioneerde strategieën blijven zichtbaar in het dashboard.

---

## 6. Single paper portfolio (xinix-trade-background)

Eén gecureerde portefeuille die altijd:
- Score ≥ 65 vereist
- Trailing stop -15% (ratchets mee omhoog)
- Deelwinst bij +25% (verkoop helft)
- Signaalverval exit (na 20d gehouden + verlies > 3%)
- Limiet-buffer +10%
- Max 8 posities, $1200 per positie
- Hold 60d (maar kan eerder door slimme exits)

---

## 7. Sleuteltabellen

| Tabel | Inhoud |
|---|---|
| `signal_tickers` | 3700+ tickers: score, rood, sector, medal, buy_limit, notes |
| `signal_price_summary` | Laatste sluitkoers per ticker |
| `xinix_strategies` | Config van alle 106+ strategieën |
| `xinix_strategy_state` | Cash + initieel kapitaal + last_run per strategie |
| `xinix_strategy_positions` | Open + gesloten posities sim, incl. `partial_exits` JSONB |
| `xinix_paper_positions` | Open + gesloten posities single portfolio, incl. `partial_exits` |
| `signal_runs` | Log van elke edge-function run |
| `xinix_knowledge_exports` | Maandelijkse snapshots (JSON + markdown samenvatting) |

---

## 8. Recente grote wijzigingen (changelog voor Claude)

| Datum | Wijziging |
|---|---|
| 2026-05-14 | **Slimme exits + transactiekosten**: TX_COST 0,1%, trailing stop ratchet, partial TP, signal decay exit, kansrotatie, nieuwe N-Trailing groep (6 strategieën → totaal 106) |
| 2026-05-14 | **Kenniscumulatie**: `xinix-knowledge-export` edge function, `xinix_knowledge_exports` tabel, maandelijkse pg_cron job, dashboard-sectie, `docs/kennisbasis.md` auto-update |
| 2026-05-14 | **Evolutie**: `xinix-evolve` functie, wekelijkse pensionering van onderste 5%, mutatie van top 5% |
| eerder | Watchlist (3700+ tickers), koerspuller, signaalengine, 100-strategie sim, single paper portfolio |

---

## 9. Hoe iets veranderen

### Nieuwe strategie toevoegen (sim)
1. Open `supabase/functions/xinix-sim-background/index.ts`
2. Voeg een `c({...})` toe aan `STRATEGIES[]` met een unieke slug en groepsnaam
3. Deploy: `supabase functions deploy xinix-sim-background --project-ref zfcjugqgufsyltxhvkuu`
4. De strategie wordt automatisch de volgende dag aangemaakt in de DB

### Parameter van single portfolio wijzigen
1. Open `supabase/functions/xinix-trade-background/index.ts`
2. Wijzig de constanten bovenaan (STOP_LOSS, PARTIAL_TP_PCT, TX_COST, etc.)
3. Deploy: `supabase functions deploy xinix-trade-background --project-ref zfcjugqgufsyltxhvkuu`

### Kennisexport handmatig triggeren
Via het dashboard: 100 Strategieën → Evolutie → Kennis-export → "Export nu"
Of via curl:
```bash
curl -X POST https://zfcjugqgufsyltxhvkuu.supabase.co/functions/v1/xinix-knowledge-export \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### DB migratie toepassen
Gebruik de Supabase MCP tool `apply_migration` of schrijf naar `supabase/migrations/`.

---

## 10. Laatste bevindingen (automatisch bijgewerkt)

> **Dit gedeelte wordt maandelijks automatisch bijgewerkt door `xinix-knowledge-export`.**
> De rijkere versie staat in `docs/kennisbasis.md`.
> Op dit moment zijn er nog geen exportgegevens beschikbaar (simulatie loopt nog op).

<!-- KENNISBASIS_START -->
_Nog geen exportdata beschikbaar. De eerste export wordt automatisch gegenereerd op de 1e van volgende maand, of handmatig via het dashboard._
<!-- KENNISBASIS_END -->

---

## 11. Verbeteringsideeën (backlog)

Deze ideeën zijn nog niet geïmplementeerd maar kunnen snel waarde toevoegen:

- [ ] **Marktcontext**: S&P 500 trend als filter — koop alleen als markt boven 200d MA staat
- [ ] **Positie-sizing op basis van score**: hogere score → grotere positie (Kelly-fractie benadering)
- [ ] **Sectorrotatie-signaal**: reduce exposure in sectoren met consistent negatief gemiddeld rendement
- [ ] **Seizoenseffecten**: test of "sell in May" of andere patronen zichtbaar zijn in de data
- [ ] **Correlatie-filter**: koop niet twee tickers van hetzelfde bedrijf of sterk gecorreleerde aandelen
- [ ] **Medaille-gewichten in rankScore**: goud weegt zwaarder dan zilver in entry-prioriteit
- [ ] **Dynamische hold periode**: verleng hold als positie sterk positief trending is

---

## 12. Taalinstructies voor Claude

- Schrijf code in TypeScript (Deno voor edge functions, React voor frontend)
- Schrijf user-facing tekst in het **Nederlands**
- Schrijf code-comments alleen als de WHY niet duidelijk is uit de code zelf
- Geen onnodige abstractions — directe code
- Commit altijd naar `claude/poll-fundamentals-background-5TjhG`
- Push met `git push -u origin claude/poll-fundamentals-background-5TjhG`
- Deploy edge functions met de Supabase MCP tool `deploy_edge_function`
