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

**Na elke merge: controleer dat "Sync to deploy branch" én "Deploy to GitHub
Pages" groen zijn** (`gh api repos/constantdynamics/xinix/actions/runs?per_page=4`).
De sync van #172 faalde op 30 sept. bij de push (exit 128, eenmalig) en het
Dagadvies-tabblad stond daardoor drie dagen niet live. Herstel:
`gh api -X POST repos/constantdynamics/xinix/actions/runs/<run-id>/rerun-failed-jobs`.

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
        ▼ werkdagen 23:10 UTC (na de sim) + elk kwartier
xinix-advice               → Dagadvies: €10k-papierportefeuille bij DEGIRO + 5 schaduwboeken,
                             orders/stops/nieuws, ntfy om 06:00 UTC en direct bij vullingen
        │
        ▼ zaterdag 09:25 UTC (wekelijks)
xinix-crypto               → Favorieten → 🪙 Crypto: crypto-aandelen op alle DEGIRO-beurzen, eigen score
                             (nieuws/fase/explosies/omzet), ntfy bij een nieuwe kandidaat met score ≥ 80
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
**Meldingen**: alle functies posten naar `signal_settings.ntfy_server`, en dat is sinds 2026-10-04 het
doorgeefluik `xinix-ntfy` (niet ntfy.sh zelf!). Dat stuurt ze ongewijzigd door naar `ntfy_upstream` (ntfy.sh),
bij de daglimiet via de database (`_shared/ntfy.ts`). Een tik opent de link die de functie zelf meegaf; alleen
Dagadvies-meldingen openen het Dagadvies. Terugzetten = `ntfy_server = ntfy_upstream`.
**E-mail** (Resend, testmodus: alleen naar het adres van het Resend-account) is sinds 2026-10-04 alleen een vangnet:
`dispatch-alerts` mailt een signaal alleen als de push mislukt; herstellinks van `xinix-auth` gaan wel per mail.
**Inloggen**: de site toont op een onbekend apparaat alleen het inlogscherm (`xinix-auth`, `src/components/AuthGate.tsx`);
de API zelf is nog niet afgeschermd. Bewerken vraagt nog steeds het beheertoken.
**Signalen**: staan in `signal_tickers` (score, rood-signaal, sectoren, medailles, buy-limit).
**Crypto-favorieten**: een hartje in het crypto-tabblad zet het aandeel op de watchlist met `signal_tickers.no_sim = true`;
het Potje, de papieren portefeuille en het Dagadvies kopen zulke aandelen niet (open posities lopen gewoon af).

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
| `signal_tickers` | 3700+ tickers: score, rood, sector, medal, buy_limit, notes, `crypto_cat` (rood CRYPTO-label: miner/treasury/exchange/tech), `no_sim` (niet in Potje, papieren portefeuille en Dagadvies) |
| `signal_price_summary` | Laatste sluitkoers per ticker |
| `xinix_strategies` | Config van alle strategieën (553 actief) |
| `xinix_strategy_state` | Cash + initieel kapitaal + last_run per strategie |
| `xinix_strategy_positions` | Open + gesloten posities sim, incl. `partial_exits` JSONB |
| `xinix_paper_positions` | Open + gesloten posities single portfolio, incl. `partial_exits` |
| `signal_runs` | Log van elke edge-function run |
| `xinix_knowledge_exports` | Maandelijkse snapshots (JSON + markdown samenvatting) |
| `xinix_notify_log` | Verstuurde ntfy-meldingen (ticker, bron, prioriteit, tijdstip; 365d retentie) |
| `xinix_notify_mute` | Demping per aandeel: `muted_until` NULL = voorgoed |
| `xinix_hippo_history` | Per ticker: gemeten tellingen uit 10 jaar dagkoersen (+50%-treffers per horizon per kenmerk-bucket, kalibratie-histogram) |
| `xinix_hippo_scores` | Hippos-ranglijst: gekalibreerde kans op +50% binnen 7, 14 en 21 dagen per ticker, factoren, laatste melding |
| `xinix_hippo_calibration` | Eén rij per horizon (7, 14 en 21 dagen): gepoolde basiskans, lifts per kenmerk, kalibratie (model vs. werkelijkheid) en het gemeten plafond |
| `xinix_hippo_predictions` | Track record: per aandeel per dag de voorspelde kans + instapkoers, met achteraf de werkelijke uitkomst per horizon |
| `xinix_universe` | Explosie-motor: ~20k aandelen van alle Saxo-beurzen (TradingView-sweep, sinds 2026-09-26 uit; alleen ≥4★ worden nog bijgewerkt) met live velden, deep-scan-samenvatting (spikes, poefies, feniks, 5j-top/-bodem), kans per event (`p_h7` … `p_rk`), `hits`, `add_hint`, `tier`, `added_at` |
| `xinix_event_history` | Per gemeten aandeel de tellingen uit 10 jaar dagkoersen (int4[2060]: dagen per kenmerk-bucket, treffers per event, kalibratie); `needs_calib` = gemeten zonder model |
| `xinix_event_pool` | Eén rij: de opgetelde tellingen van alle aandelen in de pool (watchlist + beweeglijk universum, max 6000) |
| `xinix_event_models` | Eén rij per event (h7/h14/h21/k30/k90/p30/p90/rk): basiskans, lifts per kenmerk (gebruikt ja/nee), kalibratie, plafond, backtest van de vaste criteria |
| `xinix_event_predictions` | Track record van de motor: kopgroep + favorieten per event per dag, met instapkoers en achteraf de uitkomst |
| `xinix_sprint_scores` | Sprinters: per ≥4★-favoriet de kans op +50% binnen 10 handelsdagen (model × nieuws), 7/21-daagse kans, redenen, nieuws, laatste melding |
| `xinix_sprint_news` | Per nieuwsbericht (aandeel × groep × dag): volgde er binnen 10 handelsdagen +50%? |
| `xinix_sprint_news_lift` | Gemeten effect per nieuwsgroep (berichten, treffers, lift, telt mee ja/nee) |
| `xinix_temp_list` | Tijdelijk lijstje: apart gezette aandelen (nu de 100 auto-toevoegingen van 25 sept.) met reden, markt en koers bij toevoegen |
| `xinix_sprint_predictions` | Track record Sprinters: per aandeel per dag de kans + instapkoers, met achteraf de uitkomst |
| `xinix_splits` | Door Yahoo gemelde (of handmatig ingevoerde) splits per ticker: datum, teller/noemer, eerste koers na de split, `applied_at` = posities omgerekend |
| `xinix_split_adjustments` | Per positie × split wat er is omgerekend (oude aantal/instap/rendement, factor, cash-correctie); voorkomt dubbel omrekenen |
| `xinix_price_artifact_fix_log` | Logboek van handmatige koersreparaties (pence/pond, break-even, zombie, limieten), zodat alles terug te draaien is |
| `xinix_fx_rates` | ECB-referentiekoersen (eenheden per euro), dagelijks ververst door `xinix-advice` |
| `xinix_advice_books` | Dagadvies: één rij per boek (`live` + schaduwboeken `mix`/`potje`/`hippo`/`sprint`/`signaal`): cash in euro, gevolgde bron, opgetelde DEGIRO-kosten, betaalde aansluitkosten per jaar |
| `xinix_advice_orders` | Dagadvies-kooporders (GTC-limiet in de noteringsmunt, aantal, gereserveerd bedrag, `valid_from`, `snap` tegen oude sessiedata, status) |
| `xinix_advice_positions` | Dagadvies-posities: instap, wisselkoers, kosten in euro, GTC-stop, hoogste koers, `exit_pending`, afgesloten resultaat |
| `xinix_advice_events` | Logboek + meldwachtrij: `notified_at` NULL = nog te melden (alleen `live`); `urgent` = direct, anders in de ochtendmelding |
| `xinix_advice_equity` | Waarde per boek per dag; basis voor de maandelijkse bronkeuze |
| `xinix_advice_news` | Nieuws over aandelen in een boek of met een order (Yahoo + eigen signalen), met toon `negatief`/`let_op`/`positief`/`neutraal` |
| `xinix_auth_password` | Eén rij: PBKDF2-hash van het inlogwachtwoord (`pbkdf2_sha256$iteraties$salt$hash`); het wachtwoord zelf staat nergens |
| `xinix_auth_devices` | Ingelogde apparaten: sha256 van de apparaatsleutel, naam ("iPhone · Safari"), IP, eerste/laatste gebruik, `revoked_at` |
| `xinix_auth_attempts` | Inlogpogingen (IP, apparaat, gelukt ja/nee) voor de blokkade (3 fout per IP = 1 uur) en de lijst in Instellingen; 90 dagen bewaard |
| `xinix_auth_resets` | Herstellinks: sha256 van de link-sleutel, 1 uur geldig, eenmalig, kanaal e-mail of push |
| `xinix_crypto_scan` | Crypto-tabblad: per gevonden crypto-aandeel de categorie, doet mee ja/nee + reden, score + onderdelen (`components`), fase, beurswaarde en omzet in dollars, beste maand en aantal +400%-maanden uit 10 jaar dagkoersen (`history_at`, 28 dagen geldig), crypto-nieuws (`news_at`, 3 dagen geldig), `first_seen_at`, `notified_at` |

---

## 8. Recente grote wijzigingen (changelog voor Claude)

| Datum | Wijziging |
|---|---|
| 2026-10-07 | **Favorieten → 🪙 Crypto + rood CRYPTO-label** (vraag: crypto-aandelen zoals SDEV, "een apart tabblad met crypto aandelen onder favos [...] aandelen met groeipotentie die ik vervolgens beoordeel [...] een aparte formule hiervoor maken die de andere niet interfereert"; antwoorden 1e, 2a+b+c, 3e "maar wel minimaal 1x minstens 400% gestegen in een maand", 4c, 5a+d, 6d, 7a+c, 8b, 9d, 10b). Edge function `xinix-crypto` (v4) + migratie `2026-10-07_xinix_crypto.sql`: tabel `xinix_crypto_scan`, kolommen `signal_tickers.crypto_cat` en `no_sim`, pg_cron `xinix-crypto-scan` (`25 9 * * 6`, zaterdag 09:25 UTC). **Zoeken**: TradingView op alle 20 DEGIRO/Saxo-markten (geen OTC), crypto-woorden in de bedrijfsnaam plus een vaste lijst bekende namen zonder zo'n woord (MARA, RIOT, MSTR, BMNR, COIN, CRCL, SDEV, Metaplanet …). Vier categorieën met elk een eigen label: MINER (ook AI-datacenters), SCHATKIST (treasury-bedrijven), BEURS (beurzen, brokers, wallets) en TECH (blockchain, stablecoins, tokenisatie, mining-hardware). **Eisen**: beurswaarde ≥ $20 mln, omzet ≥ $1 mln per dag, geen SPAC zonder eigen bedrijf, en uit 10 jaar Yahoo-dagkoersen minstens één keer +400% binnen een maand (slot t.o.v. het laagste slot van de 21 handelsdagen ervoor). Tegen nepstijgingen: een sprong ≥ 40× op één dag knipt de reeks (eenheidsfout), een stijging zonder volumetoename telt niet (gemiste reverse split) en de dag erna moet het aandeel nog ≥ 2,5× het dal staan (printfout); treffers die minder dan 40 handelsdagen uit elkaar liggen zijn één explosie. **Formule** (max 100, los van alle andere scores): nieuws over een cryptostrategie max 50 (keuze 4c; coins kopen en een treasury-strategie wegen 1, financiering en stablecoin 0,8, token 0,6, mining 0,5; zwaarste bericht ×30, tweede ×12, derde ×8; na 7/14/30 dagen ×0,75/0,5/0; de kop moet de ticker of het herkenbare deel van de bedrijfsnaam noemen, want Yahoo koppelt cryptonieuws aan veel aandelen tegelijk) + fase max 25 (grote stijger ≥ +100% in een maand 25, uitbraak 22, vroeg ≥ +30% 18, comeback 16, na de piek 6, rustig 3) + explosies max 15 (laatste +400%-maand ≤ 90 dagen geleden 12, ≤ 1 jaar 9, ≤ 3 jaar 6, ouder 4; +2/+3 bij 2/≥3 explosies) + omzet max 10. **Tabblad** (`src/views/Crypto.tsx`, link `?tab=favorieten&sub=crypto`): uitleg, filter per categorie, sorteren, nieuws, beste maand en een inklapbare lijst "Afgevallen" met de reden. **Hartje** = favoriet + op de watchlist (`POST {ticker, action:"adopt"}`, beheertoken) met `no_sim = true`: het Potje (`xinix-sim-background` v13), de papieren portefeuille (`xinix-trade-background` v10) en het Dagadvies (`xinix-advice` v4) kopen het niet; open posities lopen gewoon af. Favorieten herlaadt daarna het dashboard (buiten de browsercache om), zodat een nieuw aandeel meteen in de favorietenlijst staat. Aandelen die al op de watchlist stonden (BMNR, MARA, RIOT …) houden hun plek in die systemen (bevestigd door de gebruiker: "aandelen die een hartje hebben mogen naar favos, de rest is prima"). **Gezien** = weg uit het tabblad ("Toon gezien" haalt ze terug). **Melding** (ntfy prio 4, één bericht per scan, tik opent het tabblad): een nieuwe kandidaat met score ≥ 80 die geen favoriet, gezien of gedempt is en door `xinix_notify_gate` komt; elk aandeel hoogstens één keer. **Rood CRYPTO-label** (`src/components/CryptoBadge.tsx`, `GET ?labels=1`) in de 5-sterren-scanner en in de tabel en tegels van Favorieten, met de categorie als tooltip; de scan zet `crypto_cat` op watchlist-aandelen die hij vindt of die een crypto-woord in de naam hebben (nu 67). **Eerste scan** (7 okt., zonder melding): 89 gevonden, 21 doen mee, 68 vallen af (meestal nooit +400% binnen een maand). Top: BMNR 82 (al favoriet) en ASST 80 (gezien sinds 29 aug.), dus zaterdag geen melding voor die twee; daarna DFDV 66, SDEV 50, SBET 49. SDEV voldoet (fase 25, explosies 15, omzet 10, geen cryptonieuws; vijf +400%-maanden, de laatste tot 2 okt.) maar staat sinds 29 mei op gezien en is daardoor verborgen. Net niet: SUIG (+396%), CAN (+388%), CLSK (+387%), RIOT (+375%), XXI (+372%). |
| 2026-10-06 | **Tik op een melding opent weer zijn eigen link** (feedback: "als ik op de notificaties klik gaat hij nu ALTIJD naar dagadvies [...] dat moet alleen bij een notificatie over dagadvies"). Het doorgeefluik `xinix-ntfy` herschreef sinds 2026-10-04 bij elke melding zonder `?tab=`-link de `click` naar het Dagadvies en maakte van de oude link een knop. Nu stuurt het elke melding ongewijzigd door; alleen `xinix-advice` geeft zelf het Dagadvies als `click` mee. Signalen openen weer het beoordeelscherm (`?review=`), favorieten-alerts Google Finance of `?tab=favorieten`, enzovoort. Bijvangst: de herstellink-push van `xinix-auth` (`?reset=…`) werd ook herschreven, zodat een tik het Dagadvies opende in plaats van het scherm voor een nieuw wachtwoord; nu opent hij weer de herstellink. Instellingen-uitleg bij het ntfy-serverveld aangepast. Getest met een nagebootste database (signaal, favoriet, Dagadvies, herstellink, zonder link, daglimiet → database, vreemd topic → 403). Ook gecontroleerd (5 okt., eerste handelsdag met het luik): de directe route naar ntfy.sh liep 's middags weer tegen de daglimiet aan; de twee urgente Dagadvies-meldingen (gekocht NNNN 14:30 en TCRX 14:45 UTC) gingen via de database en werden binnen 5–8 seconden door ntfy aangenomen; alle 48 Dagadvies-runs zonder fouten. |
| 2026-10-04 | **Signaalmails alleen nog als vangnet** (vraag "wat zijn signaalmails?", antwoord gebruiker 1c). Een signaalmail van `dispatch-alerts` was een kopie van de pushmelding over hetzelfde signaal: koers bij/onder de eigen aankooplimiet (met genoeg medailles), feniks bij de limiet, of groot goed nieuws bij BUY/STRONG_BUY of nabij de limiet; favorieten en gezien vallen erbuiten, en de 100-dagen-afkoelperiode geldt. Nu (v24) eerst de push; alleen als die mislukt (HTTP-fout, of een netwerkfout, die `sendNtfy` nu opvangt in plaats van de hele run te laten crashen) of er geen topic is, gaat dezelfde melding per mail, met bovenaan waarom. Lukt geen van beide, dan blijft het signaal open en probeert de volgende run (elk kwartier, binnen 24 uur) het opnieuw, zoals voorheen. Werkelijk volume: 3–6 unieke signalen per maand (juni–sept. 6/4/5/3; mei 511, vóór de strengere regels). Het eerder genoemde "5–22 per maand" telde herhaalpogingen mee: op 8 sept. werd één ICU-signaal 20× geprobeerd omdat Resend (403, testmodus) én ntfy (429, daglimiet) faalden; de push kwam uiteindelijk één keer aan. Ontdekt: `alert_email_threshold` en `alert_ntfy_threshold` ("E-mail drempel"/"Push drempel" in Instellingen) worden door geen enkele functie gelezen (zie backlog). Instellingen legt onder het e-mailveld uit hoe mail nu werkt. De onzichtbare zero-width space in `safeTickerDisplay` staat nu als `\u200B` in de code (zelfde gedrag, overleeft kopiëren). Getest met een nagebootste database (push lukt / HTTP 502 / netwerkfout / geen topic) en een proefrun op productie. |
| 2026-10-04 | **E-mail werkt + vier dode crons opgeruimd** (antwoorden gebruiker: 1a "eerst testen of het nu wel werkt", 2d "nee, en ruim ze op"). Resend draait in testmodus en accepteert alleen het adres van het eigen account; `signal_settings.email` is daarom op dat adres gezet (t…@gmail.com, uit de foutmelding van Resend). Test: een herstellink via `xinix-auth` → kanaal `email`, door Resend geaccepteerd; de eerste afgeleverde mail ooit. Ook de alert-mails van `dispatch-alerts` kwamen daardoor aan (dezelfde dag teruggebracht tot vangnet, zie hierboven). De cronjobs `watchlist-digest-daily/-weekly/-monthly` en `xinix-mini-export-weekly` (deden sinds mei niets) zijn verwijderd (`2026-10-04_remove_dead_crons.sql`); er staan geen jobs met de kapotte URL-constructie meer in `cron.job`. |
| 2026-10-04 | **Inlogpagina + doorgeefluik voor alle meldingen**. *Inloggen* (antwoorden gebruiker: 1d nu alleen de site, de API later; 2a een apparaat blijft bekend tot het wordt ingetrokken; 3b na 3 foute pogingen een uur wachten; 4a+b pushmelding bij een nieuw apparaat én bij een fout wachtwoord; 5a apparatenlijst met intrekken; 6d herstellink per e-mail; 7d bewerken blijft het beheertoken vragen). Edge function `xinix-auth` (`login`, `check`, `logout`, `reset_request`, `reset`, `devices`/`revoke` met beheertoken) + migratie `2026-10-03_xinix_auth.sql` (tabellen `xinix_auth_*`, RLS dicht). Wachtwoord als PBKDF2-SHA256 (300.000 rondes) in `xinix_auth_password`; de hash is buiten de repo gezet, het wachtwoord staat nergens. Blokkade per IP (`cf-connecting-ip`, anders `x-forwarded-for`), plus 20 foute pogingen per uur over alle IP's samen = dicht voor iedereen; hoogstens 6 pushmeldingen over foute pogingen per uur. Frontend: `src/auth.ts` + `src/components/AuthGate.tsx` om `<App/>` (in `main.tsx`): zonder apparaatsleutel (`localStorage.xinix_device_token_v1`) alleen het inlogscherm, met sleutel meteen de app plus een controle op de achtergrond (ingetrokken → inlogscherm; server onbereikbaar → gewoon binnen). Een meldingslink (`?tab=…`, `?review=…`) blijft bewaard tot na het inloggen. `?reset=<sleutel>` opent het scherm voor een nieuw wachtwoord; daarna is dat apparaat meteen ingelogd. Instellingen → Apparaten: lijst, intrekken, foute pogingen (30 dagen), herstellink, uitloggen. **E-mail komt nog nooit aan** (Resend in testmodus, zie backlog), dus de herstellink valt terug op een pushmelding. Getest met een tijdelijk testwachtwoord (daarna de echte hash terug). *Doorgeefluik* `xinix-ntfy` (antwoord 8a: een tik op élke melding opent het Dagadvies): `signal_settings.ntfy_server` wijst er nu naar, de echte server staat in de nieuwe kolom `ntfy_upstream` (migratie `2026-10-04_xinix_ntfy_proxy.sql`; de database-relay gebruikt `ntfy_upstream`, anders zou hij naar het doorgeefluik terugsturen). Het luik accepteert alleen het eigen topic, zet `click` op het Dagadvies en maakt van een aandeel-link (Google Finance, Yahoo, `?review=`) een knop "📈 TICKER bekijken"; links naar een tabblad (`?tab=`) blijven staan. Het stuurt door via `publishNtfy`, dus álle meldingsfuncties (favorieten-alerts, Sprinters, Hippos, sterrenscan, scanners, dispatch) hebben nu ook de omweg via de database bij de daglimiet, zonder dat hun code is aangepast. Instellingen toont bij het ntfy-serverveld waarom het zo staat. |
| 2026-10-03 | **Dagadvies-meldingen: op tijd, en een tik opent het overzicht** (feedback: "ik zie de aanbevelingen niet, als ik op de melding klik zie ik maar 1 aandeel"). Drie oorzaken. **1. Het tabblad stond niet live**: de sync-workflow van #172 faalde bij de push (exit 128) en Pages draaide dus nog de build van #171; opnieuw gestart, live sinds 3 okt. (zie de controle-regel in §0b). **2. Meldingen kwamen een dag te laat**: ntfy.sh telt zijn daglimiet (250 berichten) per IP, en de edge functions delen hun uitgaande IP met andere Supabase-projecten, dus het limiet was vaak al halverwege de dag op (HTTP 429 "daily message quota reached"). Daardoor kwamen "GEKOCHT, zet nu je stop" en "STOP GERAAKT" pas de volgende ochtend om 06:00 NL (KPTI werd op 1 okt. gekocht én uitgestopt voordat je iets hoorde). Nieuw: RPC `xinix_ntfy_relay(payload)` + `xinix_ntfy_relay_status(id)` (migratie `2026-10-03_xinix_ntfy_relay.sql`, alleen `service_role`, post alleen naar `signal_settings.ntfy_server`) en `_shared/ntfy.ts` → `publishNtfy()`: eerst direct, bij 429/5xx/netwerkfout via pg_net vanaf het eigen IP van de database (52.211.49.17, eigen limiet van 250/dag; Xinix stuurt er 1–11 per dag), wacht tot 4 s op de uitkomst. `xinix-advice` (v3) gebruikt hem; de andere meldingsfuncties nog niet (backlog). **3. De klik**: de link was `#dagadvies`, die de oude build negeerde; de meeste andere meldingen openen Google Finance of `?review=TICKER` (het beoordeelscherm van één aandeel). Dagadvies-meldingen linken nu naar `?tab=dagadvies#dagadvies` en hebben een knop "Alle adviezen"; `App.tsx` leest `?tab=` (dus ook de bestaande `?tab=favorieten`-links van de favorieten-alerts werken nu) en wisselt van tabblad bij een `#hash`-wijziging als Xinix al openstaat. Elke Dagadvies-melding eindigt met een regel met de hele portefeuille ("📋 Portefeuille €… (±…%) · posities: … · orders: …"), zodat een melding over één aandeel niet als het hele advies leest; de berichttekst is ingekort tot 3000 tekens zodat het onder de 4096 bytes blijft (anders maakt ntfy er een bijlage van). |
| 2026-09-30 | **Dagadvies (tabblad 💼 Dagadvies naast Favorieten)**: een papieren portefeuille van €10.000 bij DEGIRO met dagelijks koop- en verkoopadvies en ntfy-meldingen, op verzoek van de gebruiker (antwoorden: €10k in euro met valutakosten, DEGIRO-tarieven, papier, de data kiest maandelijks de bron, grootte naar overtuiging met max 20% per aandeel en ≥20% cash, hele actieve watchlist met ≥ $250k omzet/dag, dagelijks evalueren en dagen-tot-weken aanhouden, alleen melden bij actie buiten de afkoelperiode om, GTC-limiet op min(watchlist-limiet, slot −3%) met een tip om de limiet te verhogen, GTC stop-loss direct na aankoop met meldingen om hem mee te trekken, meldingen direct tijdens de handelsdag, start 29 sept. met €10.000). Edge function `xinix-advice` (GET = overzicht; `?mode=daily` werkdagen 23:10 UTC na de sim; `?mode=watch` elk kwartier; POST `raise_limit`/`notify`), migratie `2026-09-29_xinix_advice.sql`. **Zes boeken** van €10.000: `live` krijgt de meldingen en volgt één bron; vijf schaduwboeken draaien exact dezelfde regels en vormen het track record: `mix` (som van de bron-overtuigingen ÷ 3, dus volle overtuiging pas bij drie bronnen), `potje` (RPC `xinix_advice_potje_picks`: wat de 10 beste strategieën over 60 dagen, met ≥5 trades in 90 dagen, deze week kochten; overtuiging = kopers ÷ 3), `hippo` (prob_14d t.o.v. basis en plafond), `sprint` (≥4★, prob t.o.v. basis en het h14-plafond), `signaal` (score + 25 bij rood/+10 bij oranje positief signaal, alleen ≤ 10% boven de aankooplimiet). Maandelijks (eerste dagrun van de maand) volgt `live` het schaduwboek met het beste rendement over ≤3 maanden, mits ≥20 handelsdagen, ≥3 afgesloten trades en ≥2 procentpunt beter dan de huidige bron; start op `mix`. **Regels**: universum = actieve watchlist op DEGIRO-beurzen (geen OTC, geen Hongkong wegens onbekende lotgroottes), ≥ $250k omzet per dag (via ECB-koersen), koers ≤ 4 dagen oud, geen open koersvlag en geen slecht nieuws in 10 dagen. Limiet = min(watchlist-limiet, slot −3%) op een gangbare tick; ligt die > 15% onder de koers dan geen order maar een stille tip in het tabblad (max 5 per dag, 1× per aandeel per 14 dagen). Grootte 10/15/20% van de waarde bij overtuiging ≥0,25/0,5/0,75, altijd ≥20% cash inclusief wat open orders vasthouden; max 5 nieuwe en 8 open orders per boek; orders vervallen na 10 handelsdagen of na 3 dagen geen kandidaat; wat 10 dagen geleden verkocht of geannuleerd is komt niet terug. Vulling alleen als de sessie-laag de limiet raakt in een sessie die begon na `valid_from` (= eerste opening na de ochtendmelding) en het koersbeeld niet gelijk is aan dat bij aanmaak (feestdagen); prijs = min(open, limiet). Stop −20% direct; vanaf +25% naar max(break-even +2%, top −20%), vanaf +50% top −15%, vanaf +100% top −12%, melding bij ≥8% verhoging (hoogstens 1× per 20 uur). Tijd-exit na 30 handelsdagen als < +10%, na 60 altijd; uitgevoerd na de volgende opening tegen koers −0,5%. Stop-verkopen tegen min(open, stop) −0,5%. **Kosten (DEGIRO 2026)**: VS/Canada €2, Europa/Londen/Azië €4,90, Australië €5 per order; AutoFX 0,25% heen en terug; €2,50 aansluitkosten per beurs per jaar (niet Euronext Amsterdam); zegelrecht Londen 0,5% bij aankoop (AIM is vrijgesteld, bewust voorzichtig) en Hongkong 0,1%. Koersen intraday via de TradingView-scanner (per regio één verzoek, alleen tijdens de sessie tot 20 min na slot), GBX/GBP-eenheden rechtgezet. **Nieuws** (gratis): Yahoo-zoeknieuws per aandeel in een boek of met een order (hoogstens eens per 2 uur, 12 per kwartier) + `signal_events` (trial_failed, financing, topline_mixed, 8-K faillissement/delisting); trefwoordclassificatie `negatief` (uitgifte geprijsd, faillissement, going concern, CRL, studie mislukt, delisting) → verkopen, `let_op` (shelf, private placement, reverse split, beursbrief minimumkoers, vertrek bestuurder) → orders annuleren en 10 dagen niet kopen, `positief` → +0,1 overtuiging; advocatenkantoor-spam telt niet. **Meldingen** (alleen `live`, prio 5 direct: vulling + stop zetten, stop geraakt, stop verhogen, verkopen, annuleren na nieuws; prio 4 om 06:00 UTC: nieuwe orders, annuleringen, tijd-exits, bronwissel), respecteert stille uren (UTC), niet de 100-dagen-afkoelperiode en bewust níét in `xinix_notify_log` (dan zouden andere meldingen voor die aandelen 100 dagen geblokkeerd worden); `signal_settings.advice_notify` zet ze aan/uit. De eerste dagrun (29 sept. 23:10) gaf 4 orders van 20% en 38 tips; na de aanpassing (mix ÷3, stille tips) opnieuw gedraaid: 5 orders van 15% (NMRA, BENF, KPTI, TRAW, TCRX). **Onderbouwing uit het Potje** (±13.000 gesloten trades, 120 dagen): stops van 15–20% doen het even goed, 5–12% slechter, trailing vanaf de start helpt niet; houdtermijnen van 7–14 dagen verliezen na kosten, 45–60 dagen doen het best; biotech +3,8% per trade, mijnbouw −7,1%. De Potje-sim kocht tegen de vorige slotkoers (ZYBT: zondag op $0,73 gekocht, maandag opende hij op $1,27), daarom vult het Dagadvies alleen als de limiet echt geraakt wordt. |
| 2026-09-29 | **Potje-datakwaliteit: vier reparaties** (op verzoek "los die problemen allemaal maar op"). **1. Marktregime**: cron `xinix-market-regime-daily` bouwde zijn URL uit `current_setting('app.supabase_url')`, die niet bestaat, en draaide dus sinds 14 mei nooit (sim en trade vallen bij een regime ouder dan 3 dagen terug op `strong_bull`). Nu `invoke_edge('xinix-market-regime')` om 21:30 UTC, vóór trade (22:00) en sim (22:30); de functie controleert de upsert en logt in `signal_runs`. Het regime is nog steeds `strong_bull` (SPY boven MA200, VIX ~16), maar nu gemeten. **2. Koersglitches** — (a) *Splits*: `poll-prices-background` vraagt `events=div,splits` op. `pasSplitsToe` (`_shared/units.ts`) zet oudere koersen om als Yahoo een split meldt terwijl de reeks nog een sprong van precies die factor bevat. Elke gemelde split gaat via RPC `xinix_record_split` (dedup ±30 dagen) naar `xinix_splits`, en `xinix_apply_splits()` (ook pg_cron `xinix-apply-splits`, 21:50 UTC) zet posities die over de split heen liepen op de nieuwe basis: aantal ÷ f, instap/stop/TP × f; deelverkopen en sluitingen ná de split worden gecorrigeerd en de cash van de strategie schuift mee. Per positie vastgelegd in `xinix_split_adjustments` (nooit dubbel); een open positie wacht tot de opgeslagen koers van ná de split is. Na één dag: 156 splits bekend, 54 posities omgerekend (ENLV, BMGL, AEHL, NFE, CIIT, SEGG, SKYE, LEXX). (b) *Londen pence/pond*: Yahoo wisselt voor LSE tussen GBp en GBP, soms binnen één reeks. `normaliseerEenheid` (`_shared/units.ts`) zet alles in de subeenheid (pence; ook ZAc voor `.JO` en ILA voor `.TA`): sprongen van 40–250× worden in de reeks teruggezet, een koers in de hoofdmunt gaat ×100, en de nieuwe koers wordt tegen de vorige opgeslagen koers gehouden. Dit draait in poll-prices, compute-extremes en equity-backfill; `signal_tickers.price_currency` houdt de munt bij. Posities, opgeslagen koersen (FADL.L, FKE.L, KCR.L, MII.L, SAVE.L, TNE.L, VOX.L) en 33 aankooplimieten (`2026-09-29_xinix_lse_limits.sql`) zijn naar pence omgezet, alles gelogd in `xinix_price_artifact_fix_log`. (c) *Vangnetten*: `xinix-sim-results` en `xinix-equity-backfill` waarderen een open positie tegen kostprijs als koers/instap ≥8 of ≤0,125 is (net als de sim); een dividendrendement boven 30% telt als 0 (nepdividend rond splits); tickers met een open positie (`xinix_held_tickers()`) worden even vaak gepollt als favorieten. *Opruimen*: zombiestrategie 1674 (niet meer in de code, maar de posities liepen door) is gesloten en gepensioneerd; equity-rijen van vóór de correctie (o.a. het weekend van 26/27 sept., +$8,7k) zijn weg en max-drawdown is herberekend. De ranglijst-top was +2.400% door glitches en staat nu op `agg_red_bio` +102,5%, mediaan +8,2%. **3. Katalysatoren**: `xinix_close_resolved_catalysts()` (pg_cron `xinix-close-catalysts`, `35 */2 * * *`) sluit een openstaande katalysator zodra er een uitslagbericht binnenkomt (mislukt, topline of fase-succes; bij PDUFA goedkeuring of CRL) en de katalysator binnen 120 dagen daarna verwacht werd. Voorwaarde is dat `xinix_catalyst_matches` bevestigt dat het bericht over díe studie gaat: een onderscheidend woord uit de studietitel, of één openstaande uitslag met een kloppende fase. De eerste versie sloot bij IONS en MIRM de verkeerde studie af; die zijn hersteld, inclusief de 45 pre_catalyst-signalen van MIRM. TENX is dicht. **4. Score**: `goud_score` was voor 2.547 van de 2.548 actieve aandelen leeg, dus alle A-Score-varianten kochten hetzelfde. `xinix_refresh_auto_scores()` (pg_cron `xinix-auto-scores`, `20 */3 * * *`) vult nu voor biotech en mining een modelscore uit `signal_scores`: ½ structureel + ¼ katalysator + ¼ timing − risicostraf, omgezet naar een rang binnen de sector (90 = beter dan 90%, ≥65 = beste 35%). `final_score` zelf is onbruikbaar, want die vermenigvuldigt en is 0 zonder katalysator. Handmatige scores gaan voor: `goud_score_auto` plus de trigger `signal_tickers_goud_score_bron` houden bij welke score van het model komt. Het dashboard kleurt tegels alleen op handmatige scores; in de tabel staat een modelscore grijs met tooltip, en de Encyclopedie legt het uit. Nu 641 modelscores (349 mining, 292 biotech); `other` en `ai` blijven zonder score. |
| 2026-09-29 | **Koerspuller: uitgehongerde favorieten + Favorieten-tab opgeschoond**: de gebruiker zag PNPN.V op −16,1% (1D) terwijl dat niet klopte — de koers was sinds 8 sept. niet meer opgehaald, net als die van 192 van de 645 favorieten (sommige sinds mei). Oorzaak in `poll-prices-background`: per favoriet-venster draaien 4 runs × 80, maar er zijn ~540 Noord-Amerikaanse favorieten, en de favorieten-query sorteerde niet, dus vielen steeds dezelfde ~220 buiten de boot. Daarnaast werd een favoriet met `exchange` NULL (PNPN.V) of een beurs die niet in de vensterlijsten stond (Stockholm, Kopenhagen, Swiss, Johannesburg, AMEX) na de eerste poll nooit meer opgehaald, en tickers met `exchange = 'NASDAQ'` (20 stuks, o.a. DWTX dat 67 strategieën vasthouden) vielen buiten de gewone wachtrij. Fix: eigen `FAV_BATCH_SIZE = 200` (~0,2–0,35 s per ticker), favorieten **oudst-gepollt eerst**, beurs → handelsregio via `REGIO_PER_BEURS` met terugval op de ticker-suffix (`regioVan`), en een inhaalmodus `?inhalen=1` (favorieten die ≥20 uur niet gepollt zijn, ook buiten hun venster). Na deploy (v20) haalde de inhaalslag 205 favorieten op; nog 11 staan oud, allemaal door Yahoo niet (meer) gekend (404/benched). **Favorieten-tab**: het blok "N favorieten zonder data" + reparatie-knop is weg (favorieten zonder data worden gewoon niet getoond, de teller telt alleen zichtbare); **↻ Ververs** gebruikt nu `fetchDashboard(true)` (omzeilt de 2-minuten browsercache); 1D/1W/1M/6M worden gedimd met tooltip als de koers ≥4 dagen oud is, gebaseerd op `summary.updated_at` (i.p.v. `price_polled_at`, dat ook bij een mislukte poll opschuift); de vier Δ-kolommen sorteren bij de eerste klik **laag → hoog**. |
| 2026-09-26 | **Tijdelijk lijstje (Favorieten → 🗂️ Tijdelijk)**: de 100 aandelen die de motor op 25 sept. automatisch toevoegde staan apart in `xinix_temp_list` (reden, markt, koers bij toevoegen), met edge function `temp-list` (GET = lijst + laatste koers, actief ja/nee, open sim-posities; POST `{ticker, action}`: `restore` zet `signal_tickers.active` weer aan en haalt hem van de lijst, `remove` haalt hem alleen van de lijst). In de tab kun je per aandeel een hartje/sterren geven (≥4★ → de motor neemt hem vanzelf mee), filteren op soort treffer (hikkertje/poefie/feniks/5★-DNA/hoge kans) en sorteren op koersverandering sinds toevoegen. |
| 2026-09-26 | **Explosie-motor draait alleen nog voor ≥4★**: op uitdrukkelijk verzoek van de gebruiker ("alleen bij aandelen met minimaal 4 sterren") doet de motor niets meer voor andere aandelen. De dagelijkse TradingView-sweep (`xinix-universe-0..4` + `finish`) is uitgeschakeld, `universe_auto_add` staat op **false** (ook als kolom-default), `xinix_deep_scan_queue` kijkt alleen nog naar favorieten met `rating ≥ sprint_min_rating` (nieuw, track-record, kalibratie, herscan per 30 dagen), en de kansen/treffers/open voorspellingen van alle andere aandelen zijn gewist. Omdat de sweep weg is, schrijft `xinix-sprint` (elke 2 uur) nu ook de kansen van alle acht events (`p_h7` … `p_rk`), `hits`, `add_hint` en `star_fit` naar `xinix_universe` voor die ≥4★-aandelen, zodat de `EngineInsight`-kaarten op de andere tabbladen actueel blijven; aandelen die onder de 4★ zakken worden daar leeggemaakt. De gepoolde 10-jaarsstatistiek (`xinix_event_pool`, 6000 aandelen) blijft staan als basis voor lifts en kalibratie, maar groeit niet meer. Migratie `2026-09-26_xinix_engine_only_4star.sql`. Van de 100 aandelen die op 25 sept. automatisch zijn toegevoegd zijn er 92 op `active = false` gezet (terug te zetten; notitie bijgewerkt); de 8 met een open positie in de strategie-simulatie blijven actief tot die positie sluit, anders zouden hun koersen niet meer bijgewerkt worden. |
| 2026-09-26 | **Favorieten → ⚡ Sprinters: ≥4★ die binnen 10 handelsdagen +50% kunnen doen, met nieuws en melding**: nieuwe edge function `xinix-sprint` (pg_cron `xinix-sprint`, `20 */2 * * 1-5`) rekent elke 2 uur op werkdagen voor alle favorieten met `rating ≥ signal_settings.sprint_min_rating` (default **4**, nu 145 aandelen) de kans uit op ≥ +50% binnen 10 handelsdagen (en de dag erna nog ≥ +20%). Kern = het h14-model van de explosie-motor op **verse TradingView-koersen** (per markt één `symbols`-verzoek via `tvQuotes`), val-terug op de sweep of `signal_price_summary`. **Nieuws**: `signal_events` worden per aandeel × groep × dag gesynchroniseerd naar `xinix_sprint_news` (`xinix_sprint_news_sync`, groepen via `xinix_sprint_news_group`: `bio_goedkeuring` (breakthrough, fase-succes, positieve topline, licentie), `bio_catalyst_kort` (beslissing/data binnen 14 dagen), `bio_catalyst_lang`, `bio_tegenvaller`, `mijn_boring` (bonanza, vondst, step-out), `mijn_mijlpaal` (resource, PEA/PFS/DFS, vergunning, first pour), `overname`, `partner`, `financiering`, `sec_8k`; signalen die uit de koers zelf komen tellen niet, die zitten al in het model). **Alleen berichten van favorieten met ≥ `sprint_min_rating` sterren** worden gesynchroniseerd, gemeten én toegepast (de gebruiker wil dit uitdrukkelijk niet voor andere aandelen; na die correctie ~1.500 berichten van ~85 aandelen i.p.v. 26.000 van 2.100). Per bericht wordt na 16 dagen met Yahoo afgerekend of er binnen 10 handelsdagen +50% volgde; de lift per groep = treffers / som van de eigen 10-jaars h14-basiskans van dezelfde aandelen, gekrompen met 5 pseudo-treffers (`xinix_sprint_news_lift`). Een groep telt alleen mee bij ≥30 berichten, ≥5 treffers en lift ≥1,5 of ≤1/1,5; nieuws van de laatste 7 dagen, totaal begrensd op ×1/3…×3 op de odds. Elke run rekent ook het nieuws van 10 aandelen af; de eenmalige achterstand is handmatig via `xinix-sprint?mode=news` weggewerkt. **Melding** (ntfy prio 5, bron `sprint`): vanaf `sprint_alert_min_prob` (default **15**), hoogstens `sprint_alert_max_per_week` (default **3**) per rollende week, per aandeel 1× per 10 dagen tenzij +5 punten; demping en "gezien" wijken alleen vanaf `sprint_override_min_prob` (default 15). Alle vier instelbaar bij Instellingen. **Track record** in `xinix_sprint_predictions` (per aandeel per dag kans + instapkoers, afgerekend na 16 dagen) + RPC `xinix_sprint_track_record`. Eerste run: 141/145 gescoord, hoogste 11,9% (ENA.V na +51% in een week), dus nog geen melding — het gemeten plafond van h14 ligt op 21,8%. |
| 2026-09-25 | **Explosie-motor: één meting voor Hippos, Raketten, Scanner, Feniks, Hikkertjes en Poefies, over alle Saxo-beurzen**: nieuwe edge function `xinix-engine` met gedeelde rekenkern `_shared/engine.ts`. Eén Yahoo-fetch van 10 jaar dagkoersen per aandeel meet alles tegelijk: 8 events (`h7/h14/h21` +50% in 5/10/15 handelsdagen en de dag erna nog ≥ +20%; `k30/k90` nieuwe hikkertje-spike binnen 21/63 dagen; `p30/p90` nieuwe poefie binnen 21/63 dagen; `rk` maand met +150% binnen 6 maanden) × 19 kenmerken (rendementen 1d/5d/22d/6m, volume, dagen sinds +50%-piek, afstand tot 1j-top/5j-top/1j-bodem, 90d-band, beweeglijkheid, dollarvolume, koers, spikes, dagen sinds poefie, 5-sterren-fit, feniks, IWM-regime). Definities van de onderdelen zijn ongewijzigd. **Universum**: `xinix-engine/universe?part=0..4` + `finish` (22:40–22:52 UTC) haalt via de TradingView-scanner ~20.300 primaire gewone aandelen op 20 Saxo-markten op (`xinix_universe`); de deep-scan (`xinix-engine/deep`, `5,25,45 * * * *`, 60 per run, ~450 ms CPU) meet eerst de watchlist, dan beweeglijke universum-aandelen (tier 1/2). Na één nacht: 13.644 aandelen gemeten, pool op het plafond van 6000, 8,7 mln handelsdagen. **Kalibratie**: de naïeve som van log-lifts bleek ~3× te stellig (helling 0,27–0,43 in log-odds, 11% van de dagen in de bovenste klasse); nu gedempt met `DAMP = 0,35`, waarna de kalibratie netjes monotoon oploopt en de kopgroep weer onderscheiden wordt. **Plafonds nu vs. oude Hippos**: h7 19,1% (was 8,4), h14 21,8% (13,0), h21 25,2% (17,1); spike-90d 37,1%, poefie-90d 30,2%, raket 41,9%. **Kenmerken met ≥1,5× lift worden gebruikt** (15–17 van de 19 per event); IWM-regime en positie in de 90d-band vallen overal af, het **5-sterren-DNA voorspelt vrijwel niets** (×0,95–1,68). Backtest van de vaste criteria op h14: hikkertje ×3,7, feniks ×2,5, poefie in 2 jaar ×2,3, +50%-piek in 45 dagen ×2,7, 5-sterren-fit ≥80 ×1,4. **Automatisch toevoegen** (`signal_settings.universe_auto_add`, `universe_max_add_per_day` = 100): treffers buiten de watchlist gaan er vanzelf in met een notitie "Auto-toegevoegd door de explosie-motor"; aandelen die ooit in `signal_tickers` stonden komen nooit terug. Dag 1: 100 toegevoegd (45 VS, 26 Hongkong, 7 Canada, …): hikkertjes 76 → 106, poefies 919 → 1019, feniksen 6 → 12. **Track record** per event in `xinix_event_predictions` (kopgroep van 25 + favorieten ≥2× basis per dag) + RPC `xinix_event_track_record`; leesbaar via `event-scores`. Elk tabblad (Hikkertjes, Poefies, Raketten, Hippos, Scanner, Feniks) toont een `EngineInsight`-kaart met gemeten trefkans, backtest, kalibratie, lifts en universum-treffers. De oude Hippo- en Raket-functies draaien door; overstappen pas als het track record van de motor minstens zo goed blijkt. De wachtrij-kalibratiecheck gebruikt de opgeslagen kolom `xinix_event_history.needs_calib` (het uitpakken van alle arrays liep tegen de statement-timeout). Rapport: `docs/explosie-motor-rapport.md`. |
| 2026-09-16 | **Hippos: derde horizon van 21 dagen (3 weken)**: op de vraag "en als we zeggen 3 weken?" is er nu een gemeten antwoord in plaats van een geschat. Naast 5 en 10 handelsdagen meet dezelfde scan ook **15 handelsdagen (≈ 21 kalenderdagen)**, op exact dezelfde dagen en met exact dezelfde acht kenmerken; alleen de uitkomst verschilt. Definitief gemeten op **4,55 mln handelsdagen** over 2441 tickers (de hele watchlist, herscand met drie vensters): basiskans **0,9% per dag over 7 dagen**, **2,3% over 14** en **3,9% over 21**, met plafonds van **8,4% / 13,0% / 17,1%**. Drie weken verdubbelt de kans ruwweg t.o.v. één week, maar **80% blijft onbereikbaar**: het plafond is de hoogste frequentie die ooit in een kansbucket gemeten is, en dat is een eigenschap van de markt. Wie meldingen wil, zet de drempel rond de 15% op 21 dagen. **Let op de verzadiging bovenin**: alle aandelen in de hoogste kansbucket krijgen dezelfde gekalibreerde waarde (nu 17,1% / 13,1% / 8,5%), dus binnen de kopgroep rangschikt `raw_prob` en niet `prob` — de sortering valt daar bewust op terug. `xinix_hippo_scores` kreeg `prob_21d`/`raw_prob_21d`/`base_rate_21d`/`factors_21d`, `xinix_hippo_predictions` kreeg `prob_21d`/`raw_prob_21d`/`touched_21d`/`held_21d`/`resolved_21d`, en `xinix_hippo_calibration` heeft een derde rij. De kolomnamen worden in de code uit de horizon-sleutel afgeleid (`probCol`, `touchedCol`, …), zodat een vierde venster alleen nog een migratie kost. Het vooruitkijken in `analyze` gebeurt in één pass tot het grootste venster: de eerste dag waarop +50% gehaald werd én standhield bepaalt meteen welke horizonnen hem tellen. `PEAK_BARS` staat bewust vast op 10 bars, anders zou de betekenis van het since-kenmerk veranderen zodra er een horizon bij komt. Batch van 75 naar **50** wegens de CPU-limiet (drie horizonnen = drie kalibratielussen per ticker). `signal_settings.hippo_alert_horizon` accepteert nu 7, 14 of 21 en staat op **21**; de drempel blijft op de gevraagde 80. Alle `scanned_at` zijn teruggezet zodat elke ticker opnieuw gemeten wordt met drie vensters — een tijdelijke cron `xinix-hippos-catchup` (elk half uur) heeft de ~2530 tickers in ongeveer een etmaal doorgehaald en is daarna weer verwijderd. |
| 2026-09-16 | **Hippos: hele watchlist in plaats van alleen favorieten**: het model rekende alleen op aandelen met een hartje, maar die beperking was nergens voor nodig — de lifts zijn algemene regelmatigheden en de kenmerken komen uit `signal_price_summary`, dat voor de hele watchlist gevuld wordt. Het universum is nu alle **actieve tickers** (~2530). **Meldingen en het track record blijven voorbehouden aan favorieten**: een ping over een aandeel dat je nooit hebt bekeken is ruis. Herscan-tempo: favorieten elke 30 dagen (vooraan in de wachtrij), de rest elke 90 — samen ~56 per dag, ruim binnen de 900 die de cron aankan. Twee maatregelen tegen de groei: de historie wordt nog maar met de benodigde kolommen opgehaald (de legacy-tellingen zijn een spiegel van horizon 14 en verdubbelden de overdracht), en `factors`/`factors_7d` worden alleen bewaard voor favorieten en de kopgroep van 250 (`TOP_FACTORS`). Nieuwe kolom `xinix_hippo_scores.is_favorite`; `hippo-scores` kent `?favorites=1`. Het tabblad opent op favorieten en heeft een filter voor de hele watchlist; een aandeel zonder hartje boven de drempel krijgt een nijlpaard mét vraagteken. **Gemeten lifts op 1,16 mln handelsdagen** (basiskans 3,4% over 14 dagen): 5-daags rendement onder −30% → 17,2% (×5,0), nooit eerder een +50%-piek → 0,8% (×0,2), 22-daags onder −40% → 10,6% (×3,1), volume ≥8× → 9,9% (×2,9), 6-maands onder −70% → 9,4% (×2,8), ≥95% onder de 5-jaarstop → 8,1% (×2,4). Het 6-maands rendement is **U-vormig**: ook +300% of meer geeft 8,1% (×2,4). Positie in de 90-daagse band is het zwakste kenmerk (×1,2 aan de onderkant). |
| 2026-09-16 | **Hippos: twee horizonnen, weekplafond, drie extra kenmerken en een track record**: op de vraag of 7 dagen bruikbaarder is dan 14 kwam een gemeten antwoord in plaats van een beredeneerd. Eén scan meet nu **beide vensters** (5 en 10 handelsdagen) op exact dezelfde dagen met exact dezelfde kenmerken; alleen de uitkomst verschilt. Gemeten op alle 641 favorieten: basiskans **1,4% per dag over 7 dagen** tegen **3,4% over 14 dagen**, plafond **13,5%** tegen **18,1%**. Een kort venster is dus ruim 2× zeldzamer én het plafond zakt mee — een drempel van 80% is er nóg verder buiten bereik. `xinix_hippo_history.horizons` bewaart de tellingen per venster (losse kolommen blijven de 14-daagse spiegel); `xinix_hippo_scores` kreeg `prob_7d`/`raw_prob_7d`/`base_rate_7d`/`factors_7d`; `xinix_hippo_calibration` is één rij per horizon met `ceiling` als eigen kolom. Nieuwe instellingen: `hippo_alert_horizon` (7 of 14, bepaalt waarop de drempel slaat) en `hippo_alert_max_per_week` (default **1**) — hoogstens zoveel meldingen per rollend venster van 7 dagen over álle aandelen samen, hoogste kans eerst, want hippo-meldingen vallen buiten de gewone afkoelperiode. **Drie extra kenmerken** (6-maands rendement, afstand tot de 5-jaarstop, positie in de 90-daagse bandbreedte), waarmee het er acht zijn. Regel voor opname: een kenmerk moet én historisch meetbaar zijn uit de koersbalken én live afleidbaar uit `signal_price_summary`. Short interest en nieuws vallen daarom af — die bestaan niet voor tien jaar terug, dus hun gewicht zou verzonnen zijn. De nieuwe vensters draaien als monotone deques mee, O(1) per dag. **Track record** (`xinix_hippo_predictions` + RPC `xinix_hippo_track_record`): elke run legt per aandeel per dag de kans en de instapkoers vast en wikkelt na 7 en 14 dagen af — raakte de koers +50% aan, en stond hij een dag later nog ≥+20%? Dezelfde eis als in de historie, op slotkoersen. Dat is het enige cijfer waar achteraf niet aan te sleutelen valt; de kalibratie blijft terugkijken op dezelfde data waar de lifts uit komen. Batch van 100 naar **75** wegens de CPU-limiet (twee horizonnen = dubbele kalibratielus). |
| 2026-09-15 | **Hippos: kans op +50% binnen 14 dagen + directe melding**: nieuw sub-tabblad Favorieten → 🦛 Hippos. `xinix-hippo-background` (pg_cron `xinix-hippos`, elke 2 uur om :45) haalt per favoriet 10 jaar dagkoersen bij Yahoo (batch ~100 per run, herscan per 30 dagen) en meet per handelsdag of er in de 10 handelsdagen daarna ≥+50% volgde (en de dag erna nog ≥+20% stond, tegen 1-dags data-pieken). Per dag vijf kenmerken in buckets (5d-rendement, 22d-rendement, volume vs 30d, dagen sinds vorige +50%-piek, afstand tot 1j-top); alleen tellingen worden bewaard in `xinix_hippo_history`. Scoren gebeurt elke run op verse koersen uit `signal_price_summary`: gepoolde basiskans × eigen-historie-lift × Π bucket-lifts (odds, gekrompen bij weinig data). Omdat de kenmerken overlappen overdrijft dat, dus een **kalibratielaag**: bij elke herscan wordt de modelkans per historische dag geteld tegen wat er echt gebeurde (`calib` per ticker, gepoold in `xinix_hippo_calibration`), en de getoonde kans is die gemeten frequentie. Resultaat in `xinix_hippo_scores`, leesbaar via `hippo-scores`. **Melding**: zodra de gekalibreerde kans van een verhandelbare favoriet ≥ `signal_settings.hippo_alert_min_prob` (nieuw, default **80**, instelbaar bij Instellingen, 0 = uit) gaat er meteen een ntfy-ping (prio 5, bron `hippos`). Die gaat bewust **buiten de globale cooldown** om (een sprint van 14 dagen kan niet 100 dagen wachten) maar respecteert demping en gezien; eigen dedup: per aandeel max 1× per 14 dagen tenzij de kans ≥10 punten hoger is. Kalibratiedata ontstaat pas bij de tweede scan-ronde per favoriet (eerst moeten er lifts zijn). **Let op — het model heeft een plafond van ~20%, de drempel van 80 vuurt nooit.** Gemeten op alle 641 favorieten (707k historische dagen): basiskans 3,4% per dag, en de kalibratie loopt van 0,6% (model zegt 0-1%) monotoon op naar 21,3% (model zegt 50-100%). De rangorde klopt dus prima, maar bovenin overdrijft het model fors, en een *gemeten* kans kan niet hoger worden dan de hoogste frequentie die ooit in een kansbucket is waargenomen. 80% zekerheid op +50% binnen twee weken bestaat niet in deze data; dat is een eigenschap van de markt, geen modelfout. Het tabblad toont daarom een `Plafond`-stat en een rode kaart zodra de ingestelde drempel daarboven ligt. Wie meldingen wil, moet de drempel rond de 15% zetten (≈4× de basiskans, in de praktijk een handvol aandelen). De drempel is bewust op de gevraagde 80 blijven staan — verlagen is een keuze van de gebruiker. |
| 2026-09-12 | **Afkoelperiode meldingen van 14 naar 100 dagen**: `notify_cooldown_days` stond ingebouwd op 14 en in productie handmatig op 30 — nog steeds te druk (93 aandelen zaten binnen het 30-daagse venster). Standaard is nu **100 dagen**, op alle vier de plekken waar die waarde stond: de kolom-default op `signal_settings`, de `COALESCE`-fallback in `xinix_notify_gate`, en de UI-fallbacks in `Settings.tsx` en `notify-log`. De bestaande rij is meteen op 100 gezet. De uitzonderingen blijven ongewijzigd: een melding met een strikt **hogere** ntfy-prioriteit breekt er wél doorheen, en demping (`xinix_notify_mute`) plus gezien (`xinix_seen`) blijven absoluut. Let op: het grootboek begint pas op 2026-06-30, dus een venster van 100 dagen omvat voorlopig het hele log — elk aandeel dat ooit een melding kreeg is nu stil tot het log ouder wordt dan 100 dagen. |
| 2026-09-07 | **Beurssuffix bij inladen + symboolcontrole bij Yahoo**: een Google-Finance URL gaf zijn beurscode niet door aan de lookup — `parseTickerInput` las `QTWO:CVE` wel als exchange `CVE`, maar `onLookup` gebruikte alleen `p.ticker` en zocht dus kale `QTWO` op. Yahoo valt bij een onbekend symbool stilletjes terug op de US-notering, dus dat leverde Q2 Holdings (NYSE, $62) op in plaats van Q2 Metals (TSXV, $2,80) — een ander bedrijf, zonder foutmelding. Nu vertaalt `YAHOO_SUFFIX` de beurscode naar een Yahoo-suffix (CVE→`.V`, ASX→`.AX`, TSE→`.TO`, LON→`.L`, HKG→`.HK`, …; US-beurzen krijgen niets) en plakt `metBeursSuffix` die erachter zolang de ticker er nog geen heeft. Aanvullend weigert `lookupOne` in `ticker-lookup` voortaan een antwoord waarin `meta.symbol` niet gelijk is aan wat er gevraagd werd; `resolve()` probeert daardoor gewoon de volgende suffix in plaats van het verkeerde bedrijf te accepteren. Gevonden tijdens een bulk-import van ~300 tickers: 3 van de 303 kwamen als het verkeerde bedrijf terug. |
| 2026-09-04 | **Favorieten-tabel: sticky kop, zebra en kolomkleuren**: de kopregel blijft staan tijdens scrollen (de tabel zit in één scroll-container met `max-h-[calc(100vh-15rem)]` en `position: sticky` op de `th`'s — sticky t.o.v. de pagina kan niet omdat de app-header zelf al sticky is en een overflow-container de koppeling met de viewport breekt). Oneven rijen krijgen `bg-white/[0.022]`; wees-rijen houden hun oranje tint. In de kolom-kiezer zit per kolom een kleurbolletje met 25 neonkleuren (`src/columnColors.ts`), opgeslagen als `table_columns.<tab>.colors` in `xinix_ui_settings` (edge function valideert op `#rrggbb`). De kleur wordt via een CSS-variabele op de cel gezet; `td.col-tint, td.col-tint *` forceert 'm met `!important`, anders zouden spans met een eigen text-kleur (winst/verlies, medailles) er doorheen komen. |
| 2026-09-04 | **AI-sector + limiet-suggestie bij inladen + breedte per tab**: `sector='ai'` als vierde sector naast biotech/mining/other (check-constraint op `signal_tickers` en `signal_scores` verruimd). AI-aandelen worden net als `other` níét algoritmisch gescoord en niet gebrieft (`poll-briefing` filtert op biotech/mining) — ze draaien op koers, limiet, medailles en meldingen. Het inlaad-paneel op Favorieten toont nu per aandeel koers, 5j-bodem/-top én een **voorgestelde aankooplimiet** die je per rij kunt aanpassen vóór toevoegen, samen met sector, sterren en een aan/uit-vinkje. De suggestie is `5y-low × (1 + limit_suggest_pct/100)` met `signal_settings.limit_suggest_pct` (nieuw, default **10**) als globale waarde, per inlaadsessie te overrulen — ook naar "% onder de huidige koers". Dezelfde instelling stuurt nu ook `compute-extremes-background`, dat al sinds jaar en dag automatisch `5y-low × 1,10` invulde voor watchlist-tickers zonder limiet — die 10% stond daar hardcoded, los van de scan-functies die sinds 2026-05-20 exact de 5y-low zetten. Eén instelling, twee plekken; handmatige limieten worden nooit overschreven. `ticker-lookup` haalt daarvoor `range=5y&interval=1wk` op en geeft `last_close`/`low_5y`/`high_5y` terug (geen extra Yahoo-calls). Nieuwe kolom **Toegevoegd** op Favorieten (sorteerbaar, uit `xinix_favorites.created_at` via `marks`), zodat je de nieuwste favorieten kunt nalopen op hun limiet. Paginabreedte is per tabblad instelbaar (normaal 1280 / breed 1800 / vol) via een schakelaar rechtsboven; opgeslagen in `xinix_ui_settings.tab_width`, default **breed**. `normalizeSector` in `tickers` maakte van elke onbekende waarde stilzwijgend `biotech` in de repo-versie — nu `other`. De repo-bronnen van `tickers` en `ticker-lookup` liepen achter op productie en zijn weer gelijkgetrokken. 31 AI-aandelen ingeladen als favoriet. |
| 2026-08-30 | **Favorieten: koersverandering-kolommen**: vier nieuwe kolommen (1D / 1W / 1M / 6M) op het Favorieten-tabblad, sorteerbaar en ook zichtbaar in de tegelweergave. 1D/1W/1M komen uit de bestaande `pct_change_1d/5d/22d`; nieuw is `signal_price_summary.pct_change_6mo`, gevuld door `poll-prices-background` (laatste slotkoers ≥182 dagen terug — datum-gebaseerd, zodat dun verhandelde tickers niet verder dan een half jaar terugkijken). Bestaande rijen krijgen hun 6M-waarde bij de eerstvolgende poll van die ticker (favorieten 2× per handelsdag). |
| 2026-08-30 | **Backfill-functie 6M**: `backfill-price-change-6mo` vult `signal_price_summary.pct_change_6mo` voor **favorieten** die die waarde nog missen (daar staat de 6M-kolom; de rest van de watchlist is er geen Yahoo-calls waard en komt vanzelf via poll-prices). Draait ook als de beurzen dicht zijn, 110s-budget per run. Raakt alleen die ene kolom aan: geen koersen, signalen of poll-status. Handmatig aanroepen via `select invoke_edge('backfill-price-change-6mo')` tot "0 bijgewerkt"; geen cron. |
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

**Datakwaliteit Potje (gevonden en opgelost 2026-09-29, zie changelog):**
- [x] **Glitches vervuilen de ranglijst**: splits worden automatisch verwerkt (`xinix_splits`), Londen staat overal in pence en de ranglijst waardeert glitch-posities tegen kostprijs.
- [x] **Marktregime staat stil sinds 2026-05-14**: cron loopt via `invoke_edge('xinix-market-regime')`.
- [x] **Katalysatordatums verouderen**: `xinix_close_resolved_catalysts()` sluit ze af bij een uitslagbericht over dezelfde studie.
- [x] **Score-dimensie is leeg**: modelscore (rang binnen de sector) voor biotech en mining, handmatig gaat voor.

**Datakwaliteit Potje: nog open (bewust niet meegenomen):**
- [ ] **Echte crashes van ≥87,5% worden gemaskeerd**: de sim en de ranglijst zien koers/instap ≤0,125 als glitch en waarderen tegen kostprijs, dus een aandeel dat echt 90% zakt blijft op break-even staan tot het gesloten wordt. Pas oplossen als splits en eenheden een tijd schoon blijven; dan kan de guard strenger (bv. alleen als er ook een split of eenheidswissel bekend is).
- [ ] **Dividend telt alleen in het rendement**: `return_usd` van de sim telt een geschat dividend mee, maar de cash van de strategie krijgt het nooit.
- [ ] **Geschorste aandelen worden nog gekocht** (o.a. SAVE.L): de koers staat stil en de sim ziet dat als een geldige instap.
- [x] **Vier crons draaien nooit** (gevonden 2026-09-30): `watchlist-digest-daily`, `-weekly`, `-monthly` en `xinix-mini-export-weekly` bouwden hun URL met een niet-bestaande instelling. De gebruiker koos ze niet aan te zetten maar op te ruimen: verwijderd op 2026-10-04 (migratie `2026-10-04_remove_dead_crons.sql`); de edge functions bestaan nog.
- [ ] **Dagadvies: een maand evalueren**: pas na de eerste maandkeuze (begin november) is te zien welke bron werkt. Denk dan aan: zegelrecht alleen rekenen voor Londense main-market-aandelen (AIM is vrijgesteld), Hongkong toelaten met de juiste lotgroottes, en of de Hippo-kopgroep (verzadigd op het plafond) genoeg onderscheid maakt.
- [ ] **Crypto-tabblad evalueren (rond 7 november)**: na een maand beslissen of de 5-sterren-scanner ook crypto-aandelen van buiten de watchlist meeneemt (keuze 9d, 2026-10-07). Kijk dan naar welke kandidaten een hartje kregen, wat de top deed en of de meldingsdrempel van 80 klopt.
- [ ] **13 strategieën met negatieve cash**: die hebben nepwinsten herbelegd voordat de glitches werden rechtgezet. Ze kopen niets meer tot hun cash weer positief is.
- [x] **Andere meldingsfuncties via de ntfy-relay**: opgelost zonder die functies aan te raken: `ntfy_server` wijst naar het doorgeefluik `xinix-ntfy` (2026-10-04).
- [ ] **Inloggen stap 2: de API afschermen**: nu toont alleen de site een inlogscherm; wie de adressen van de edge functions kent, kan de gegevens nog opvragen. Stap 2 = elke lees-functie laten controleren op een geldige apparaatsleutel (`xinix_auth_devices`). Afgesproken met de gebruiker (vraag 1d, 2026-10-03).
- [x] **E-mail komt nooit aan**: Resend draait in testmodus (geen geverifieerd domein) en accepteert alleen het adres van het Resend-account zelf. Opgelost op 2026-10-04 (keuze gebruiker): `signal_settings.email` is nu het adres van het Resend-account (t…@gmail.com); de eerste mail ooit (een herstellink) is afgeleverd. `dispatch-alerts` mailt sindsdien alleen nog als vangnet bij een mislukte push (keuze gebruiker 1c; daarvoor 3–6 signalen per maand). Verifieer je later het domein `constantdynamics.nl` in Resend (DNS-records) en zet je `RESEND_FROM` daarop, dan kan elk adres.
- [ ] **E-mail drempel en Push drempel doen niets**: `signal_settings.alert_email_threshold` en `alert_ntfy_threshold` staan in Instellingen, maar geen enkele functie leest ze (gevonden 2026-10-04). Weghalen of laten werken; eerst afstemmen met de gebruiker (die koos voor de signaalmails optie 1c "alleen als vangnet", niet 1d "drempel laten werken").
- [ ] **Kennisherinnering mailt nog niet**: `xinix-knowledge-reminder` stuurt vanaf `noreply@constantdynamics.nl` (domein niet geverifieerd) naar de env-variabele `NOTIFY_EMAIL`, dus die mail mislukt nog steeds stil (de ntfy-herinnering werkt wel). Lost zich op met de domeinverificatie hierboven.

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

