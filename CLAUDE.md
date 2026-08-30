# Xinix — Master kennisdocument voor Claude & gebruiker

> **Dit bestand is de enige bron van waarheid voor de gesimuleerde belegger.**
> Claude leest dit aan het begin van elke sessie. De gebruiker kan het ook lezen.
> De sectie "Laatste bevindingen" wordt automatisch bijgewerkt door de maandelijkse kennisexport.
> Bewerk alleen de secties die je zelf verantwoordelijk voor bent.

---

## ⚠️ 0. ALTIJD-EERST-LEZEN: PR-merge reflex (kritiek)

> **CLAUDE: lees dit voor je iets anders doet. Deze regel wordt vergeten als hij niet bovenaan staat.**

**Reflex:** zodra `create_pull_request` succesvol heeft gedraaid, is je VOLGENDE actie ALTIJD
`merge_pull_request` met `merge_method: "squash"`. Geen tussenstappen, geen "klaar"-bericht
naar de gebruiker, geen "wacht op feedback". De gebruiker heeft hier op 2026-05-20 doorlopende
toestemming voor gegeven.

**Uitzonderingen (en alleen deze):**
- CI faalt op de PR → fix eerst de CI, dan mergen
- Er staan openstaande review-comments die om aandacht vragen → eerst beantwoorden
- De PR is draft omdat de gebruiker er expliciet om vroeg

**Concreet patroon dat je MOET volgen:**
```
1. create_pull_request met base="claude/poll-fundamentals-background-5TjhG"
2. pull_request_read (get_check_runs) → checks ok?
3. merge_pull_request(merge_method="squash")
4. Pas DAARNA antwoord aan gebruiker met PR-link + "gemerged"
```

Stap 3 overslaan is een fout, ook al voelt de taak "af" na stap 1. Als je in twijfel bent
of stap 3 al gedaan is: doe stap 3.

---

## ⚠️ 0b. ALTIJD-EERST-LEZEN: Deploy-branch reflex (kritiek)

> **CLAUDE: pushen naar de verkeerde branch betekent dat de gebruiker geen
> wijziging op de site ziet. Lees dit voordat je een PR opent.**

**De enige juiste merge-doelbranch is `claude/poll-fundamentals-background-5TjhG`.**
Dit is de canonical development branch. Pushes daarheen triggeren
`sync-to-deploy.yml`, die:
1. force-pusht naar `claude/biotech-signal-detector-3ajql` (deploy-branch)
2. dispatch een run van `pages.yml` → GitHub Pages krijgt nieuwe build

**NOOIT** direct mergen naar:
- `claude/biotech-signal-detector-3ajql` — wordt force-overschreven bij volgende sync, je werk verdwijnt
- `main` — bestaat niet als publiekelijke branch
- Welke andere branch dan ook

**Sessie-instructies kunnen een feature-branch noemen (bv. `claude/iets-Xyz`).** Dat is de branch waarop je je commits maakt. Maar de PR-base is en blijft `claude/poll-fundamentals-background-5TjhG`. Als de sessie-instructie iets anders zegt, volg deze regel — niet die.

**Concreet patroon:**
```
1. git push -u origin <feature-branch>
2. create_pull_request(base="claude/poll-fundamentals-background-5TjhG", head="<feature-branch>")
3. merge → triggert sync-to-deploy.yml → pages.yml → live op github.io/xinix
```

Als je per ongeluk al naar de verkeerde base hebt gemerged: doe een nieuwe
push van die commits naar `claude/poll-fundamentals-background-5TjhG` om de
sync-workflow te activeren, anders ziet de gebruiker de verandering niet.

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
| **200-strategie simulatie** | 553 actieve strategieën (begonnen als 200) met elk een eigen papieren portefeuille á $10.000, elke strategie test andere parameters | `xinix_strategies`, `xinix_strategy_positions`, `xinix_strategy_state` |
| **Single paper portfolio** | Eén gecureerde papieren portefeuille die het beste leert beleggen | `xinix_paper_positions` |

---

## 2. Architectuur (end-to-end stroom)

```
[Watchlist + koersen in DB]
        │
        ▼ dagelijks 22:05 UTC (na US close)
xinix-trade-background     → beheert single paper portfolio
xinix-sim-background       → beheert 200 strategieën parallel
        │
        ▼ halfjaarlijks (1 jan & 1 jul — evolutie)
xinix-evolve               → pensioneer onderste 10% → nakomelingen uit top-25% donors → nieuwe Gen
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

## 5. De 553 strategieën (200-strategie simulatie)

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
| **O–W** | 94 | Extra groepen: OppReplace, Trailing2, ScoreHold, StopScore, TPVariant, SectorRich, ConsProfiel, AggProfiel, MultiCombo |

De tabel hierboven beschrijft de oorspronkelijke 200. Inmiddels telt de simulatie
**553 actieve strategieën** in 25 groepen (A–Y): extra varianten plus de
hikkertjes- (X), zwitserleven- (Y), poefie- en hot/warm-families, gedefinieerd in
`STRATEGIES`/`EXTRA_STRATEGIES` in `xinix-sim-background/index.ts`.

**Evolutie**: halfjaarlijks (pg_cron `xinix-evolve-biannual`: 1 jan & 1 jul, minimaal
75 dagen tussen cycli, eerste cyclus pas als de oudste strategie ≥90 dagen draait).
Per cyclus wordt de onderste 10% op composite fitness (rendement + Sharpe-bonus −
drawdown-penalty) gepensioneerd; nakomelingen ontstaan uit mutatie/crossover van de
top-25% donors. Top-2 op rauw rendement overleven altijd (elitisme); strategieën met
≥30 trades en hitrate <30% gaan vervroegd met pensioen.
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
| `xinix_strategies` | Config van alle strategieën (553 actief) |
| `xinix_strategy_state` | Cash + initieel kapitaal + last_run per strategie |
| `xinix_strategy_positions` | Open + gesloten posities sim, incl. `partial_exits` JSONB |
| `xinix_paper_positions` | Open + gesloten posities single portfolio, incl. `partial_exits` |
| `signal_runs` | Log van elke edge-function run |
| `xinix_knowledge_exports` | Maandelijkse snapshots (JSON + markdown samenvatting) |
| `xinix_notify_log` | Verstuurde ntfy-meldingen (ticker, bron, prioriteit, tijdstip; 365d retentie) |
| `xinix_notify_mute` | Demping per aandeel: `muted_until` NULL = voorgoed |

---

## 8. Recente grote wijzigingen (changelog voor Claude)

| Datum | Wijziging |
|---|---|
| 2026-08-30 | **Favorieten: koersverandering-kolommen**: vier nieuwe kolommen (1D / 1W / 1M / 6M) op het Favorieten-tabblad, sorteerbaar en ook zichtbaar in de tegelweergave. 1D/1W/1M komen uit de bestaande `pct_change_1d/5d/22d`; nieuw is `signal_price_summary.pct_change_6mo`, gevuld door `poll-prices-background` (laatste slotkoers ≥182 dagen terug — datum-gebaseerd, zodat dun verhandelde tickers niet verder dan een half jaar terugkijken). Bestaande rijen krijgen hun 6M-waarde bij de eerstvolgende poll van die ticker (favorieten 2× per handelsdag). |
| 2026-08-25 | **Gezien = afgehandeld**: een aandeel dat als gezien is gemarkeerd krijgt geen ntfy-meldingen meer (`xinix_notify_gate` slaat `xinix_seen` over — absoluut, ook urgente meldingen) en staat standaard verborgen in het Meldingen-tabblad, met een `ShowSeenToggle` om ze terug te halen. Let op: een favoriet die óók als gezien staat wordt hiermee stil. |
| 2026-08-25 | **Meldingen-tabblad**: nieuw tabblad direct naast Dashboard (Hot or Not) met het ntfy-grootboek uit `xinix_notify_log` — per aandeel of als tijdlijn. Per aandeel markeren (gezien / hartje / sterren, hergebruikt `/api/marks`) en dempen: geen meldingen meer voor 3, 6 of 12 maanden of voorgoed. Nieuwe tabel `xinix_notify_mute` + edge function `notify-log`. `xinix_notify_gate` respecteert de demping; anders dan de cooldown is die absoluut — ook een hogere prioriteit breekt er niet doorheen. |
| 2026-07-27 | **Globale notificatie-cooldown per aandeel**: nieuw grootboek `xinix_notify_log` + RPC's `xinix_notify_gate` / `xinix_notify_record`. Alle meldingsfuncties delen nu één teller: max 1 melding per aandeel per `signal_settings.notify_cooldown_days` (standaard 14 dagen, instelbaar in het Instellingen-tabblad, 0 = uit). Uitzondering: een melding met een strikt hogere ntfy-prioriteit dan wat er binnen de periode al verstuurd is, mag er wél door. Reden: de bestaande cooldowns telden per (ticker, alert_type) binnen één functie (7d onder-limiet, 30d lows, 180d top10/20) en functies wisten niets van elkaars meldingen — dus pingde één aandeel meerdere keren per week. `xinix-fav-alerts` en `dispatch-alerts` gaan door de poort (die laatste had alleen "1× per dag"); de batch-scanners loggen wat ze aankondigen. |
| 2026-06-30 | **Favorieten-alerts**: nieuwe edge function `xinix-fav-alerts-background` stuurt gerichte ntfy-pings voor favorieten — >30% dagdaling, nieuw 5y/3y-low, nieuw in top-10/top-20 (op afstand tot limiet), onder de aankooplimiet, en ≥4★ met >20% dag- of >50% weekdaling. Elke melding bevat ticker, link, dagdaling%, afstand-tot-limiet% en sterren. Dedup per conditie via `xinix_fav_alert_state`, baseline-seeding op de eerste run tegen een flood, dagelijkse cron 07:00 UTC. `low_3y` toegevoegd aan `signal_price_summary` (berekend door compute-extremes, favorieten eerst). |
| 2026-06-11 | **Onderhoudsronde**: gepagineerde fetches tegen de 10k-rijencap (sim/trade/evolve/sim-results/knowledge-export/equity-backfill), `ran_at`→`finished_at`-fix (evolutieruns werden nooit gelogd en nergens getoond), schrijffout-detectie + failure-logging in xinix-sim, álle actieve signalen meegenomen i.p.v. max 2000/3000, auth op kennisexport-POST, ErrorBoundary in de frontend |
| 2026-05-14 | **Slimme exits + transactiekosten**: TX_COST 0,1%, trailing stop ratchet, partial TP, signal decay exit, kansrotatie, nieuwe N-Trailing groep |
| 2026-05-14 | **200 strategieën**: uitgebreid van 106 naar 200 (groepen O–W toegevoegd) |
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
Via het dashboard: 200 Strategieën → Evolutie → Kennis-export → "Export nu"
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

## 13. Workflow-instructies voor Claude

- **Pull requests NOOIT als draft aanmaken.** Maak altijd een gewone (ready-for-review) PR aan, ook al instrueren sessie-defaults anders. De sessie-instelling "create as draft" wordt hier expliciet overruled.
- **Pull requests altijd direct mergen.** Zodra een PR is aangemaakt en er
  geen openstaande CI-fouten of review-opmerkingen zijn die aandacht vragen,
  squash-merge de PR meteen zelf — vraag niet eerst om toestemming. De
  gebruiker heeft hier doorlopende toestemming voor gegeven (2026-05-20).
- Voor je een gebruiker antwoordt na PR-aanmaak: controleer dat de PR is
  gemerged. Zo niet → eerst mergen. Pas dan antwoorden.

