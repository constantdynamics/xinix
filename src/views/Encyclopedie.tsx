// Encyclopedie — een doorzoekbaar register van alle Xinix-termen, KPI's,
// secties en strategie-concepten. Bij geen match krijgt de gebruiker een
// invoerveld om een vraag in te dienen — die wordt lokaal opgeslagen
// (localStorage) zodat hij niet kwijtraakt, en kan in een volgende sessie
// aan Claude worden voorgelegd.

import { useMemo, useState } from "react";
import { Card, Button } from "../components/ui";

interface Entry {
  term: string;
  category: string;
  body: string;        // korte uitleg in plain Dutch
  related?: string[];  // gerelateerde terms (klikbaar)
  aliases?: string[];  // alternatieve spellings/afkortingen
}

// ── Inhoud van het register ──────────────────────────────────────────────────
// Houd dummyproof: één zin = wat het is, dan in detail.

const ENTRIES: Entry[] = [
  // ── Tabbladen ─────────────────────────────────────────────────────────────
  { term: "Dashboard", category: "Tabbladen", body: "Startpagina met de Hot or Not-tegels. Toont per ticker een tegel met kleur op basis van score en signalen. Rood = hot, oranje = warm, geel = lauw, wit = neutraal." },
  { term: "Scores", category: "Tabbladen", body: "Inhoudelijke score-engine: per ticker een 'trader'-score op basis van structurele factoren, catalysts en timing. Hier zie je waarom een score is wat hij is." },
  { term: "Watchlist", category: "Tabbladen", aliases: ["Tickers"], body: "Alle aandelen die Xinix volgt (3700+). De volledige tabel met sortering, filters en kolom-kiezer." },
  { term: "Limieten", category: "Tabbladen", body: "Per ticker je aankooplimiet bewerken. Bij koers ≤ limiet kan de single paper portfolio kopen." },
  { term: "Backtest", category: "Tabbladen", body: "Test op historische data hoe een specifieke strategie zou hebben gepresteerd." },
  { term: "Track record", category: "Tabbladen", body: "Performance-overzicht van de single paper portfolio over tijd." },
  { term: "Signaallog", category: "Tabbladen", body: "Chronologisch logboek van alle gegenereerde signalen per ticker." },
  { term: "Scans", category: "Tabbladen", body: "Overzicht van alle scan-jobs (bottoms, losers, phoenix, etc.) met laatste resultaten." },
  { term: "Potje", category: "Tabbladen", aliases: ["Xinix", "Sim"], body: "De 200-strategie simulatie. Elke strategie beheert een eigen papieren portefeuille van $10.000 met andere parameters. Doel: ontdekken welke parameter-mix werkt. Zwakste strategieën worden wekelijks vervangen door mutaties van de besten (evolutie)." },
  { term: "Feniks", category: "Tabbladen", aliases: ["Phoenix"], body: "Aandelen die ooit in de afgelopen 10 jaar minimaal 50× zijn gegaan en nu laag staan. Theorie: ze kunnen weer omhoog." },
  { term: "Poefies", category: "Tabbladen", body: "Aandelen die ooit minimaal 125% (2,25×) in maximaal 7 dagen zijn gestegen. Explosieve kortstondige sprongen." },
  { term: "Hikkertjes", category: "Tabbladen", body: "Aandelen die in het afgelopen jaar minimaal 2× op één dag ≥55% stegen en die stijging minimaal 3 handelsdagen vasthielden. Extreme volatiliteit." },
  { term: "Zwitserleven", category: "Tabbladen", body: "Fallen-angel dividend-aandelen: TTM-dividend ≥6,5%, ≥50% onder 5j-hoog, ooit ≥25% sprong, ≥2 groeijaren. Echte kwaliteit die tijdelijk uit de gratie is." },
  { term: "Favorieten", category: "Tabbladen", aliases: ["Favos"], body: "Aandelen die je met het hartje hebt aangemerkt op een ander tabblad. Verzamelpunt. Orphans (zonder data) verbergen we standaard." },
  { term: "Beoordelen-popup", category: "Tabbladen", body: "De rechtsboven 'beoordeel'-knop opent een swipe-flow waar je per lijst aandelen één-voor-één een hart, sterren of 'gezien'-markering geeft." },

  // ── Xinix sub-tabs ───────────────────────────────────────────────────────
  { term: "Referentie-portefeuille", category: "Tabbladen", aliases: ["Basisportefeuille"], body: "Eén gecureerde papieren portefeuille van $10.000 met vaste parameters (max 8 posities, ~$1200/positie, 60d hold, trailing -15%, deelwinst bij +25%). Dient als referentie naast de 200 experimenterende strategieën." },
  { term: "Families", category: "Tabbladen", body: "Per strategie-groep (A t/m W) een tijdlijn van het gem. rendement. Zo zie je welke parameter-families collectief beter of slechter presteren over tijd." },
  { term: "Inzichten", category: "Tabbladen", body: "Wat werkt? + aanbevelingen + bar-charts per configuratie-dimensie + rendement per signaaltype. De lerende laag bovenop de simulatie." },

  // ── Strategie-families (groepen) ─────────────────────────────────────────
  { term: "A-Score", category: "Strategie-families", body: "Score-drempel families. Strategieën verschillen alleen in de minimum-score die een ticker moet hebben om gekocht te worden: ≥0, ≥40, ≥50, ≥55, ≥60, ≥65, ≥70, ≥75, ≥80, ≥90." },
  { term: "B-Hold", category: "Strategie-families", body: "Tijdvenster families. Varieert hoe lang een positie wordt vastgehouden: 20d, 30d, 45d, 90d, 120d, 180d." },
  { term: "C-Stop", category: "Strategie-families", body: "Stop-loss families. Vaste stop-loss percentages: geen, -10%, -20%, -25%, -30%." },
  { term: "D-TP", category: "Strategie-families", body: "Take-profit families. Vaste TP-percentages: +25%, +50%, +100%, +200%." },
  { term: "E-Sector", category: "Strategie-families", body: "Sector-only families. Biotech-only of mining-only varianten." },
  { term: "F-Concentratie", category: "Strategie-families", body: "Concentratie-families. Max # posities × positie-grootte: van 3 posities × $2500 (geconcentreerd) tot 20 × $400 (gespreid)." },
  { term: "G-Signaal", category: "Strategie-families", body: "Signaal-families. Variaties die rood-signaal vereisen, gecombineerd met score-drempels en sectoren." },
  { term: "H-Medaille", category: "Strategie-families", body: "Medaille-filter families. Vereisen ≥1 of ≥2 gouden medailles op de ticker." },
  { term: "I-Limiet", category: "Strategie-families", body: "Limiet-buffer families. Hoe ver boven de aankooplimiet mag je kopen: 0%, 5%, 10%, 20% of geen filter." },
  { term: "J-Exit-combo", category: "Strategie-families", body: "Exit-combinaties. Verschillende mixen van take-profit en stop-loss." },
  { term: "K-Profiel", category: "Strategie-families", body: "Agressieve profielen. Hoog risico, hoog beoogd rendement." },
  { term: "L-Profiel", category: "Strategie-families", body: "Conservatieve profielen. Lager risico, gespreid." },
  { term: "M-Combo", category: "Strategie-families", body: "Cross-dimensionele combinaties van meerdere strategieparameters." },
  { term: "N-Trailing", category: "Strategie-families", body: "Trailing-stop families. Trailing -10%, -15%, -20% en kans-rotatie (slechtste positie vervangen door betere kandidaat)." },
  { term: "O–W", category: "Strategie-families", body: "Extra groepen: OppReplace, Trailing2, ScoreHold, StopScore, TPVariant, SectorRich, ConsProfiel, AggProfiel, MultiCombo. 94 strategieën verspreid over deze 9 groepen." },

  // ── KPI's & metrics ──────────────────────────────────────────────────────
  { term: "Rendement", category: "KPI's", aliases: ["Total return"], body: "Totaal % t.o.v. startkapitaal $10.000. Formule: (cash + open posities − initieel) / initieel × 100." },
  { term: "Hit-rate", category: "KPI's", aliases: ["Winrate"], body: "Aandeel gesloten posities met return > 0%. 50% = de helft was winst. 70%+ is zeer goed." },
  { term: "Mediaan rendement", category: "KPI's", body: "Het middelste rendement van alle gesloten trades. Robuuster dan gemiddelde, want één extreme uitschieter beïnvloedt het nauwelijks." },
  { term: "Profit factor", category: "KPI's", body: "Som winsten ($) ÷ som verliezen ($, absoluut). >1 = winstgevend. >2 = sterk. ∞ = (nog) geen verliezers." },
  { term: "Expectancy", category: "KPI's", aliases: ["Verwachte winst per trade"], body: "Gemiddeld rendement per trade. = avg_return_pct. Negatieve waarde = elke trade kost je in verwachting geld." },
  { term: "Winst-drempels", category: "KPI's", body: "Per drempel (5/10/25/50/100%) het % gesloten posities dat dat rendement haalde. Toont de distributie van winners." },
  { term: "Mega-winners", category: "KPI's", body: "Absolute aantallen trades met ≥50/100/200/500% rendement. Vervangen de oude medaille-tellers die niet accuraat te berekenen waren." },
  { term: "Dagen positief", category: "KPI's", body: "Aandeel equity-snapshots waarop de portefeuille boven startkapitaal stond. Maatstaf voor hoe vaak je 'in de plus' stond gedurende de hele run." },
  { term: "Unieke tickers", category: "KPI's", body: "Aantal verschillende aandelen ooit aangekocht door deze strategie (open + gesloten posities)." },
  { term: "Feniksen gevangen", category: "KPI's", body: "Aantal posities waarvan de 50× feniks-piek-datum binnen de hold-periode viel. Date-overlap based — accuraat." },
  { term: "Poefies gevangen", category: "KPI's", body: "Aantal posities waarvan de laatste poefie-event-datum binnen de hold-periode viel." },
  { term: "Max drawdown", category: "KPI's", body: "De grootste piek-naar-dal-daling in % die de portefeuille meemaakte. Voorbeeld: $10k → $15k → $9k = 40% drawdown." },
  { term: "Equity", category: "KPI's", body: "Totale portefeuillewaarde: cash + marktwaarde open posities." },

  // ── Strategie-parameters ─────────────────────────────────────────────────
  { term: "Score-drempel", category: "Strategie-parameters", aliases: ["minScore"], body: "Minimum-score die een ticker moet hebben om door deze strategie gekocht te worden. Hogere drempel = strenger." },
  { term: "Tijdvenster", category: "Strategie-parameters", aliases: ["Hold", "holdDays"], body: "Hoe lang een positie standaard wordt vastgehouden. Slimme exits kunnen eerder ingrijpen (stop, TP, signaalverval, kansrotatie)." },
  { term: "Stop-loss", category: "Strategie-parameters", aliases: ["Stop"], body: "Vaste of trailing verkoop-trigger als de koers met X% daalt. -15% trailing = verkoop bij 15% onder de hoogste koers sinds entry." },
  { term: "Take-profit", category: "Strategie-parameters", aliases: ["TP"], body: "Verkoop-trigger bij X% winst. Sommige strategieën verkopen halverwege het TP-target al de helft (partial TP)." },
  { term: "Sector-filter", category: "Strategie-parameters", body: "Beperkt aankopen tot één sector (biotech/mining/other) of laat alle sectoren toe." },
  { term: "Concentratie", category: "Strategie-parameters", body: "Combinatie van max # posities × positie-grootte. Geconcentreerd (3×$2500) = grote uitslag per trade; gespreid (20×$400) = stabieler." },
  { term: "Limiet-buffer", category: "Strategie-parameters", body: "Hoe ver boven de aankooplimiet je nog mag kopen. 0% = strikt onder limiet; 10% = tot 10% boven limiet OK." },
  { term: "Rood-signaal vereist", category: "Strategie-parameters", body: "Strategie koopt alleen als er een rood-signaal (sterk catalyst) actief is op de ticker." },
  { term: "Trailing stop", category: "Strategie-parameters", body: "Stop-loss die meebeweegt: zakt nooit, stijgt mee met de koers. Beschermt winst zonder vooraf vast TP." },
  { term: "Partial TP", category: "Strategie-parameters", aliases: ["Deelwinst"], body: "Halverwege het TP-target wordt de helft van de positie verkocht. Risico halveren, upside houden." },
  { term: "Signaal-verval exit", category: "Strategie-parameters", body: "Vroegtijdige exit als alle entry-signalen verlopen ÉN verlies > 3% ÉN held ≥ max(14d, holdDays×0,33)." },
  { term: "Kansrotatie", category: "Strategie-parameters", aliases: ["opportunity_replace"], body: "Slechtste open positie vervangen door betere kandidaat als portefeuille vol is. Alleen als de verlies-positie > -5% staat." },

  // ── Evolutie ─────────────────────────────────────────────────────────────
  { term: "Generatie", category: "Evolutie", body: "Hoeveelste 'editie' van een strategie. Gen 1 = origineel; Gen 2+ = via mutatie ontstaan uit een topper." },
  { term: "Mutatie", category: "Evolutie", body: "Tijdens evolutie wordt een topper licht aangepast (1 parameter wijzigt). Resultaat = nieuwe generatie." },
  { term: "Beschermde strategie", category: "Evolutie", body: "Strategie die niet wegmag bij evolutie, zelfs als hij onderaan staat. Bijvoorbeeld de referentie-config." },
  { term: "Pensioen", category: "Evolutie", body: "Strategie verdwijnt uit de actieve set. Wekelijks worden de onderste 5% strategieën gepensioneerd en vervangen door mutaties van de top 5%." },

  // ── Signalen & medailles ─────────────────────────────────────────────────
  { term: "Signaaltype", category: "Signalen", body: "Type trigger dat een aandeel verdient (bv. bonanza, permit, FDA-approval, deal, technical-bottom). Per type wordt rendement & win-rate bijgehouden." },
  { term: "Rood-signaal", category: "Signalen", body: "Sterk catalyst-signaal (bv. FDA-approval, grote permit). Verhoogt de heat naar oranje/rood." },
  { term: "Score", category: "Signalen", aliases: ["goud_score"], body: "Curatie-score 0–100 die structurele kwaliteit aangeeft. 65+ = sterk, 80+ = top." },
  { term: "Gouden medaille", category: "Signalen", aliases: ["medal_gold"], body: "Hoogste medaille-categorie voor opvallende prestaties (bv. grote koersstijging, bijzondere catalyst-historie). Aantal staat in `medal_gold` per ticker." },
  { term: "Zilveren medaille", category: "Signalen", aliases: ["medal_silver"], body: "Middencategorie medaille. Telt mee voor de hot-poort (≥1 zilver of ≥3 brons vereist voor signaal-loze hot-tegels)." },
  { term: "Bronzen medaille", category: "Signalen", aliases: ["medal_bronze"], body: "Laagste medaille-categorie. ≥3 brons = telt mee voor de hot-poort." },

  // ── Transactiekosten & broker-realisme ───────────────────────────────────
  { term: "TX_COST", category: "Realisme", aliases: ["Transactiekosten"], body: "0,1% per transactie (koop én verkoop). Marktconform voor kleine US-posities via IBKR/Alpaca. Wordt overal toegepast (entry, exit, partial TP)." },
  { term: "Buy limit", category: "Realisme", aliases: ["Aankooplimiet"], body: "Per ticker ingestelde prijs waaronder Xinix wil kopen. Voorkomt te dure aankopen." },

  // ── UI-concepten ─────────────────────────────────────────────────────────
  { term: "Column picker", category: "UI", aliases: ["Kolommen"], body: "Rechtsboven elke tabel: kies welke kolommen zichtbaar zijn en in welke volgorde. Voorkeur synct over devices." },
  { term: "Leaderboard", category: "UI", body: "In Potje: kies een KPI uit een categorie (Rendement / Drempels / Risico / Activiteit / Capture / Mega-winners) → tabel sorteert daarop en toont de waarde in een aparte kolom." },
  { term: "Per familie / Individueel", category: "UI", body: "Scope-toggle in Potje. Per familie = gemiddelde van alle strategieën in een groep, één rij per groep. Individueel = elke strategie apart." },
  { term: "Food for Thought", category: "UI", body: "Regel-gebaseerd advies in de uitklap van top-10 strategieën én van families: 'veel stop-hits → ruimere stop overwegen', 'beste trade overschreed TP met factor X → hogere TP', etc." },
  { term: "Reparatie-banner", category: "UI", body: "In Favorieten bovenaan: als je favoriete tickers hebt die niet (meer) in de watchlist staan, kun je ze met één klik terugzetten." },

  // ── Architectuur (kort) ──────────────────────────────────────────────────
  { term: "Edge function", category: "Architectuur", body: "Een Deno/TypeScript serverless functie op Supabase. Hier draait de business logic (scans, simulaties, signalen, sim-results, dashboard)." },
  { term: "pg_cron", category: "Architectuur", body: "PostgreSQL cron-job systeem. Triggert dagelijkse runs (22:05 UTC voor sim/trade) en maandelijkse exports (1e van de maand)." },
  { term: "Signal_tickers", category: "Architectuur", body: "Centrale DB-tabel met alle 3700+ tickers en hun metadata: score, sector, medailles, buy_limit, is_phoenix/is_hikkertje/is_poefie flags." },
];

// ── Component ────────────────────────────────────────────────────────────────

const ASKED_KEY = "xinix_encyclopedie_asked_v1";

interface AskedQuestion { q: string; at: string }

function loadAsked(): AskedQuestion[] {
  try {
    const raw = localStorage.getItem(ASKED_KEY);
    return raw ? (JSON.parse(raw) as AskedQuestion[]) : [];
  } catch { return []; }
}
function saveAsked(list: AskedQuestion[]): void {
  try { localStorage.setItem(ASKED_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

function entryMatches(e: Entry, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (e.term.toLowerCase().includes(needle)) return true;
  if (e.category.toLowerCase().includes(needle)) return true;
  if (e.body.toLowerCase().includes(needle)) return true;
  for (const a of e.aliases ?? []) if (a.toLowerCase().includes(needle)) return true;
  return false;
}

export function EncyclopedieView() {
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState<AskedQuestion[]>(() => loadAsked());
  const [askDraft, setAskDraft] = useState("");

  const filtered = useMemo(() => ENTRIES.filter((e) => entryMatches(e, query)), [query]);
  const byCategory = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of filtered) {
      const arr = m.get(e.category) ?? [];
      arr.push(e);
      m.set(e.category, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  function submitQuestion() {
    const q = askDraft.trim();
    if (!q) return;
    const next = [{ q, at: new Date().toISOString() }, ...asked].slice(0, 50);
    setAsked(next);
    saveAsked(next);
    setAskDraft("");
  }
  function removeAsked(at: string) {
    const next = asked.filter((x) => x.at !== at);
    setAsked(next);
    saveAsked(next);
  }
  function copyAllToClipboard() {
    if (asked.length === 0) return;
    const text = asked.map((x) => `- ${x.q}`).join("\n");
    void navigator.clipboard?.writeText(text);
  }

  const noMatch = query.trim().length > 0 && filtered.length === 0;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div>
          <div className="font-bold text-base text-neutral-100 mb-1">📖 Xinix-encyclopedie</div>
          <p className="text-sm text-neutral-400 leading-relaxed">
            Doorzoekbaar register van alle termen, tabbladen, KPI's en strategie-concepten in Xinix.
            Typ een woord (bv. "a-score", "drempels", "feniks") om de uitleg te vinden. Als de term niet
            voorkomt, kun je hem onderaan als vraag indienen — ik kijk er bij een volgende sessie naar.
          </p>
        </div>
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Zoek… (bv. a-score, profit factor, kansrotatie)"
          className="w-full px-3 py-2 rounded-lg bg-ink-3 border border-ink-5 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-fog-lime/60"
        />
        <div className="text-[11px] text-neutral-500">
          {filtered.length} van {ENTRIES.length} entries{query && ` voor "${query}"`}
        </div>
      </Card>

      {/* No-match fallback: vraag indienen */}
      {noMatch && (
        <Card className="p-4 border-fog-warn/40 bg-fog-warn/[0.04] space-y-2">
          <div className="text-sm font-semibold text-fog-warn">
            Geen uitleg gevonden voor "{query}"
          </div>
          <div className="text-xs text-neutral-300 leading-relaxed">
            Dien je vraag in — ik bekijk hem bij de volgende sessie en voeg de uitleg toe aan het register.
          </div>
          <textarea
            value={askDraft || `Wat betekent "${query}" in Xinix?`}
            onChange={(e) => setAskDraft(e.target.value)}
            rows={3}
            className="w-full px-2 py-1.5 rounded bg-ink-3 border border-ink-5 text-xs text-neutral-100 focus:outline-none focus:border-fog-warn/60"
          />
          <Button size="sm" onClick={submitQuestion}>+ Vraag indienen</Button>
        </Card>
      )}

      {/* Register-content per categorie */}
      {byCategory.map(([cat, entries]) => (
        <Card key={cat} className="p-0 overflow-hidden">
          <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-neutral-400 font-bold border-b border-ink-5 bg-ink-3/30">
            {cat} <span className="text-neutral-600 ml-1">({entries.length})</span>
          </div>
          <div className="divide-y divide-ink-5/40">
            {entries.map((e) => (
              <div key={e.term} className="px-4 py-3">
                <div className="flex items-baseline gap-2 mb-1">
                  <div className="font-semibold text-sm text-neutral-100">{e.term}</div>
                  {e.aliases && e.aliases.length > 0 && (
                    <div className="text-[10px] text-neutral-500">
                      ook: {e.aliases.join(", ")}
                    </div>
                  )}
                </div>
                <div className="text-xs text-neutral-300 leading-relaxed">{e.body}</div>
                {e.related && e.related.length > 0 && (
                  <div className="text-[11px] text-neutral-500 mt-1">
                    Zie ook: {e.related.join(" · ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}

      {/* Open vragen-lijst */}
      {asked.length > 0 && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold">
              📥 Mijn openstaande vragen ({asked.length})
            </div>
            <Button size="sm" variant="ghost" onClick={copyAllToClipboard}>📋 Kopieer alle</Button>
          </div>
          <div className="text-[11px] text-neutral-500 leading-relaxed">
            Lokaal opgeslagen op dit apparaat. Kopieer ze naar Claude in een volgende sessie en
            ik voeg de uitleg toe aan het register.
          </div>
          <ul className="space-y-1.5">
            {asked.map((x) => (
              <li key={x.at} className="flex items-start gap-2 text-xs">
                <span className="flex-1 text-neutral-200">{x.q}</span>
                <button
                  onClick={() => removeAsked(x.at)}
                  className="text-neutral-600 hover:text-fog-loss"
                  title="Verwijder"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Ook bij hit: ruimte om handmatig vraag te stellen */}
      {!noMatch && (
        <Card className="p-3 border-ink-5/60">
          <details>
            <summary className="text-xs text-neutral-400 cursor-pointer hover:text-neutral-200">
              + Term mist of vraag stellen
            </summary>
            <div className="mt-2 space-y-2">
              <textarea
                value={askDraft}
                onChange={(e) => setAskDraft(e.target.value)}
                rows={3}
                placeholder="Typ je vraag…"
                className="w-full px-2 py-1.5 rounded bg-ink-3 border border-ink-5 text-xs text-neutral-100 focus:outline-none focus:border-fog-lime/60"
              />
              <Button size="sm" onClick={submitQuestion} disabled={!askDraft.trim()}>+ Vraag indienen</Button>
            </div>
          </details>
        </Card>
      )}
    </div>
  );
}
