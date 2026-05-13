// Per-pagina uitleg, onderaan elk tabblad. Vervangt het losse Legenda-tab.
// Elk blokje heeft een "✓ dit snap ik"-knop die het permanent verbergt
// (in localStorage); via "weer tonen" komt het terug.
import { useState } from "react";
import { Card, SectionHeader } from "../components/ui";

export interface HelpBlock {
  id: string;
  title: string;
  body: string; // \n wordt als alinea-einde getoond
  example?: string;
}
export interface PageHelp {
  intro: string;
  blocks: HelpBlock[];
}

const DISMISS_KEY = "xinix_help_dismissed_v1";
function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function saveDismissed(s: Set<string>): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...s]));
  } catch {
    // negeren
  }
}

export const PAGE_HELP: Record<string, PageHelp> = {
  dashboard: {
    intro:
      "Elke tegel is één aandeel uit je watchlist. De achtergrondkleur van de tegel zegt hoe 'koopwaardig' het er nu uitziet (heat). Hottere tegels staan bovenaan.",
    blocks: [
      {
        id: "dash-heat",
        title: "Heat / tegelkleur — Hot · Warm · Pre · Rust",
        body:
          "De kleur is de 'sterk aanbevolen om nu te kopen'-indicator. Alleen positieve koop-triggers maken een tegel heter: een FDA-goedkeuring, een positieve studie-uitkomst, een bonanza-boorresultaat, je eigen aankooplimiet die geraakt is, enz.\nDingen die je tegel NIET heter maken: koersdalingen, generieke koersspikes die al gebeurd zijn, volume-spikes, '8-K material agreement'-ruis. Die zie je wel als signaal, maar ze zeggen niet 'kopen'.",
        example:
          "Aandeel met een verse FDA-approval → rode tegel (Hot). Hetzelfde aandeel een maand later zonder nieuwe positieve trigger → grijze tegel (Rust), ook al staat de koers nog hoog.",
      },
      {
        id: "dash-sector",
        title: "Sector-badge — BIO / MIN / OTH",
        body:
          "Biotech, Mining of Overig. Bepaalt ook welke scoring-gewichten gebruikt worden (een biotech wordt op andere dingen beoordeeld dan een mijnbouwer).",
      },
      {
        id: "dash-score",
        title: "Goud-score (rechtsboven op de tegel)",
        body:
          "Jouw handmatige curatie-cijfer (0–100): hoe sterk jíj dit aandeel als interessant hebt aangemerkt. Dit is NIET de algoritmische score — die staat op het tabblad Scores. De goud-score bepaalt mee de tegelkleur (≥80 rood, ≥65 oranje, ≥35 geel).",
      },
      {
        id: "dash-medals",
        title: "Medailles — 🥇 🥈 🥉",
        body:
          "Uit de koersgeschiedenis van de afgelopen 5 jaar: hoe vaak dit aandeel een flinke koers-run heeft gemaakt (een zigzag-run omhoog). 🥇 = de grootste klasse runs, 🥈 / 🥉 = kleinere. Geeft een gevoel of het aandeel 'beweeglijk' is.",
        example: "🥇1 🥉2 = één keer flink ge-x'ed in 5 jaar, plus twee kleinere runs.",
      },
      {
        id: "dash-price",
        title: "Koers + dagverandering",
        body:
          "Laatste slotkoers en het % verschil met de slotkoers van de vorige beursdag. Groen = omhoog, rood = omlaag. De koersen komen van Yahoo Finance (1×/~uur ververst per aandeel, round-robin door de hele lijst).",
      },
      {
        id: "dash-range",
        title: "1y / 5y range-balk (de thermometer)",
        body:
          "Laat zien waar de huidige koers staat tussen het laagste en het hoogste punt van het afgelopen jaar (1y) of de afgelopen 5 jaar (5y). Helemaal links = vlak boven het dieptepunt; helemaal rechts = vlak onder de top. De kleur loopt van groen (laag) via geel/oranje naar rood (hoog).",
        example:
          "Balk bijna helemaal links en groen = het aandeel staat dicht bij zijn 1-jaars bodem — dat is precies het soort 'gezakt / op de radar'-situatie waar je naar zoekt.",
      },
      {
        id: "dash-catalyst",
        title: "Komende catalyst-blok",
        body:
          "Het eerstvolgende bekende koers-bewegende event voor dit aandeel — een FDA-beslissingsdatum (PDUFA), een studie-readout (P2/P3), aangekondigde boorresultaten, een vergunningsbeslissing, enz. — met het aantal dagen tot dan.",
      },
      {
        id: "dash-topsignal",
        title: "Top signal-blok + aantal actieve signalen",
        body:
          "Het zwaarste signaal dat nu live is voor dit aandeel (severity rood > oranje > geel). Het roze bolletje met getal in de header = hoeveel signalen er op dit moment actief zijn voor deze ticker.",
      },
      {
        id: "dash-filters",
        title: "Filter-pills bovenaan",
        body:
          "Filteren op heat-niveau (alleen Hot, alleen Warm, enz.) zodat je niet door 3600 tegels hoeft te scrollen. Welke onderdelen op een tegel verschijnen kun je trouwens zelf aan/uit zetten via de tegel-instellingen.",
      },
    ],
  },

  scores: {
    intro:
      "Hier staat de algoritmische score per aandeel. Drie deelscores — Structureel × Catalyst × Timing — worden geometrisch gemiddeld tot één final score (0–1), die vertaalt naar een actie. Een STRONG_BUY is een trigger om zélf onderzoek te doen, geen koop-order.",
    blocks: [
      {
        id: "sc-three",
        title: "De drie deelscores — Structureel · Catalyst · Timing",
        body:
          "Structureel = bedrijfskwaliteit: marktwaarde (kleiner = meer ruimte om te x'en), cash runway (hoeveel maanden geld nog), float / aandelenaantal, jurisdictie (tier-1 = Canada/Australië/VS), enz.\nCatalyst = is er een aanstaand event dat de koers kan bewegen? Een P3-readout, FDA-datum, maiden resource estimate, boorresultaat, vergunning, overnamebod…\nTiming = is dít het juiste instapmoment? Insider buying, ongewoon volume, hoe dichtbij de catalyst is, of de koers al te hard is gestegen (sell-the-news-risico).",
        example:
          "Mijnbouwer met sterke balans (Structureel hoog) en boorresultaten over 6 weken (Catalyst hoog), maar de koers is net 80% gestegen → Timing laag (run-up-straf) → de final score blijft alsnog matig.",
      },
      {
        id: "sc-geomean",
        title: "Geometrisch gemiddelde (waarom optellen niet werkt)",
        body:
          "De drie deelscores worden niet opgeteld maar vermenigvuldigd en dan de wortel genomen. Gevolg: één zwakke dimensie drukt de hele score laag — je wilt niet dat een geweldige catalyst een waardeloze timing compenseert.",
        example: "0,9 × 0,9 × 0,2 → geometrisch ≈ 0,52 (niet 0,67 zoals bij gewoon middelen).",
      },
      {
        id: "sc-modifiers",
        title: "Confluence-bonus · risk penalty · cycle multiplier",
        body:
          "Confluence = kleine bonus als alle drie de dimensies tegelijk kloppen.\nRisk penalty = aftrek voor rode vlaggen: verwaterende aandelenuitgifte, going-concern-waarschuwing, een eerdere afwijzing (CRL) zonder strategiewijziging, een te grote koers-run vóór het event, enz.\nCycle multiplier (alleen mijnbouw): bij een dalende grondstofcyclus krijgt de score een korting — bull = ×1,0, neutraal = ×0,85, bear = ×0,5.",
      },
      {
        id: "sc-action",
        title: "Final score & Action — STRONG_BUY / BUY / WATCH / HOLD / AVOID",
        body:
          "Drempels (trader-mode): final score ≥0,75 → STRONG_BUY · ≥0,55 → BUY · ≥0,40 → WATCH · ≥0,25 → HOLD · lager of een expliciete red flag → AVOID. WATCH kan ook betekenen 'zou BUY zijn maar wordt geblokkeerd door een risk-warning'.\nBelangrijk: STRONG_BUY = 'hier is het waard om er even induiken' (persberichten checken, clinicaltrials.gov, etc.) — niet 'koop dit nu blind'.",
      },
      {
        id: "sc-tradesetup",
        title: "Trade setup — Entry · Target · Stop · R:R",
        body:
          "Als het algoritme een BUY/STRONG_BUY geeft, stelt het ook een plan voor: Entry = de huidige koers, Target = koersdoel (de mediane piek van historische winners voor dít catalyst-type), Stop = harde stop-loss, en R:R = Reward-to-Risk: (Target − Entry) ÷ (Entry − Stop). Onder de 3 doe je de trade in principe niet — je verliezers wegen dan te zwaar.",
        example:
          "Entry $12,50, Target $31,25, Stop $10,20 → winst $18,75 vs verlies $2,30 → R:R = 8,2. Voor elke €1 risico kun je ~€8 winnen áls het werkt.",
      },
      {
        id: "sc-expectation",
        title: "De verwachting-cijfers — Kans op hit · Piek bij hit · T+90 · N · wide CI · Exit window",
        body:
          "Kans op hit = historisch % vergelijkbare events waar de koers ≥+50% piekte binnen 90 dagen (per catalyst-type, op data 2018–2024). Piek bij hit = de mediane piek van die winners. T+90 mediaan = waar de koers gemiddeld stáát 90 dagen later, niet op de piek — biotech doet vaak sell-the-news (piek +150% maar T+90 +50%), mijnbouw houdt waarde beter vast. N = op hoeveel historische cases het % gebaseerd is (vaak maar 20–50). Wide CI = met zo'n kleine N is '30%' geen exacte waarheid maar een brede band — gebruik het als richting/prior, niet als belofte. Exit window = catalyst-datum + 30 dagen cushion; daarna is de edge 'verbruikt', ook al staat de positie nog groen.",
        example:
          "Kans op hit 30% bij een P3-readout = van 10 vergelijkbare trials gingen er ~3 met +50% of meer omhoog, ~7 deden niks of zakten. Piek +150% / T+90 +50% = als je niet op de piek verkoopt geef je gemiddeld ~65% van de winst terug.",
      },
      {
        id: "sc-completeness",
        title: "Data completeness",
        body:
          "Per aandeel zijn er ~15–25 invulvelden (cash runway, catalyst-datum, modality, jurisdictie, …). Completeness = ingevuld ÷ totaal. Laag = de score gokt op ontbrekende data — neem 'm dan met een korrel zout. Velden vul je in via het detail-venster op het Watchlist-tabblad.",
      },
      {
        id: "sc-mode",
        title: "Mode — trader vs investor",
        body:
          "Trader (default) = swing-trades rond catalysts: lagere structurele gewichten (het bedrijf hoeft niet 10 jaar te bestaan, alleen tot het event), hogere timing-gewichten, strengere sell-the-news-straffen. Investor = klassiek buy-and-hold-profiel.",
      },
      {
        id: "sc-recompute",
        title: "Herbereken-knop",
        body:
          "Forceert direct een nieuwe berekening. Vereist het admin-token (in te vullen via de 'token'-knop bovenaan). De scores worden sowieso elke ~10 minuten automatisch herberekend, dus dit knopje is alleen om eerder te verversen.",
      },
    ],
  },

  watchlist: {
    intro:
      "Je volledige watchlist: alle aandelen die het systeem monitort op koers, nieuws, catalysts en signalen. Hier voeg je aandelen toe of verwijder je ze, en vul je per aandeel extra velden in die de score nauwkeuriger maken.",
    blocks: [
      {
        id: "wl-sector",
        title: "Sector — biotech / mining / other",
        body:
          "Bepaalt welke scoring-gewichten en welke nieuws-bronnen gebruikt worden. Wordt bij het toevoegen automatisch geraden op basis van de bedrijfsnaam (woorden als 'Therapeutics', 'Mining', 'Lithium'…), maar je kunt 'm aanpassen. 'Other' = valt buiten biotech/mining.",
      },
      {
        id: "wl-goud",
        title: "Goud-score & goud-type",
        body:
          "Jouw handmatige label. Goud-score (0–100) = hoe interessant jij dit aandeel vindt; bepaalt mee de tegelkleur op het dashboard. Goud-type = een korte reden waarom je 'm erbij hebt gezet (bv. 'rare disease P3', 'lithium developer').",
      },
      {
        id: "wl-fields",
        title: "De detailvelden (modality, disease area, phase, jurisdiction, cash runway, market cap, …)",
        body:
          "Handmatig in te vullen via het detail-venster (klik op een rij). Hoe meer je invult, hoe minder de score hoeft te gokken (zie 'Data completeness' op Scores). Een paar in begrijpelijke taal: cash runway = hoeveel maanden geld het bedrijf nog heeft voordat het moet bijfinancieren; jurisdiction tier-1 = Canada/Australië/VS (laag landrisico), tier-3 = bv. DRC/Mali (hoog risico); phase = welke klinische fase de hoofdstudie is.",
      },
      {
        id: "wl-add",
        title: "Aandelen toevoegen + CSV-import",
        body:
          "Plak losse tickers, of een CSV met de kolommen Ticker, Name, Currency en Buy Limit. De Currency-hint helpt het systeem bij dubbelzinnige tickers. Niet-herkende tickers krijg je apart te zien zodat je ze kunt corrigeren of weglaten; grote lijsten worden in stukjes verwerkt.",
        example:
          "`2382` + currency `HKD` → het systeem snapt: Sunny Optical op de beurs van Hongkong (`2382.HK`), niet Quanta Computer op Taiwan.",
      },
      {
        id: "wl-suffix",
        title: "Beurs-suffixen (Yahoo-stijl)",
        body:
          "Achter de ticker staat de beurs: `.V` = TSX Venture (Canada), `.TO` = Toronto, `.CN` = CSE, `.AX` = Australië, `.L` = Londen, `.HK` = Hongkong, `.T` = Tokio, `.NS` / `.BO` = India (NSE/BSE), `.DE` = Xetra, `.F` = Frankfurt, `.JK` = Indonesië, `.KL` = Maleisië, enz. Géén suffix = US (NYSE/NASDAQ).",
      },
      {
        id: "wl-benched",
        title: "'Op de bank' (benched) / fout",
        body:
          "Als Yahoo een ticker na 3 pogingen niet (meer) kan ophalen wordt 'ie 'gebenched' — verschijnt dan niet meer in de koers-poll en toont een foutmelding. Bijna altijd betekent dat: verkeerd beurs-symbool of het aandeel is gedelisted / overgenomen.",
      },
    ],
  },

  limits: {
    intro:
      "Alle aandelen waarvoor je een aankooplimiet (koersdoel) hebt ingesteld. De pagina sorteert en filtert op hoe dicht de huidige koers bij jouw limiet zit, plus op medailles en dividend.",
    blocks: [
      {
        id: "lim-distance",
        title: "Afstand tot limiet (de balk + het %)",
        body:
          "Limiet ÷ koers, gecapt op 100%. 100% = 'BUY!' — de koers staat op of onder jouw limiet. 95% = nog ≤5% erboven, 80% = nog ≤25% erboven, enz. De balk + kleur lopen van groen (eronder/dichtbij) naar rood (>50% erboven).",
        example: "Koers $0,27, limiet $0,26 → 0,26 ÷ 0,27 ≈ 96% → bijna binnen.",
      },
      {
        id: "lim-medals",
        title: "Medailleklassement (sorteer-optie 'Olympisch')",
        body:
          "Sorteert net als de Olympische medaillespiegel: eerst meeste 🥇, bij gelijk meeste 🥈, dan 🥉. De medailles komen uit de 5-jaars koersgeschiedenis — hoe vaak het aandeel een flinke koers-run maakte (🥇 = grootste klasse). Handig om te zien welke aandelen op je radar historisch het beweeglijkst waren.",
      },
      {
        id: "lim-div",
        title: "Dividend — filter & kolom",
        body:
          "Of het aandeel dividend uitkeert, en zo ja hoeveel: trailing-12-maands dividend ÷ huidige koers, als percentage. '—' = nog niet opgehaald (de koers-poller loopt traag door de hele lijst; binnen een paar uur is alles gevuld). Filter: Alle / Keert dividend uit / Geen dividend.",
        example: "2,5% = je ontvangt grofweg €25 dividend per €1000 belegd per jaar.",
      },
      {
        id: "lim-range",
        title: "1y range",
        body:
          "Dezelfde thermometer als op het dashboard: waar de koers nu staat tussen het 1-jaars dieptepunt en de 1-jaars top. Links/groen = dicht bij de bodem.",
      },
      {
        id: "lim-import",
        title: "Bulk-import van limieten (onderaan de pagina)",
        body:
          "Plak `ticker prijs` per regel, óf een CSV met een 'Buy Limit'-kolom (Ticker, Name, Currency, Buy Limit). Bestaande aandelen krijgen hun limiet bijgewerkt; aandelen die nog niet in je watchlist staan worden toegevoegd (na een Yahoo-check). Lege of 0-limieten worden stil overgeslagen.",
      },
      {
        id: "lim-remove",
        title: "Limiet verwijderen",
        body: "Het ✕'je achter een rij wist alleen de aankooplimiet — het aandeel blijft in je watchlist.",
      },
    ],
  },

  backtest: {
    intro:
      "Een terugtest van de scoring-logica op een vaste set bekende historische gevallen, zodat je kunt zien of het algoritme winnaars consequent hoger zet dan verliezers.",
    blocks: [
      {
        id: "bt-pairs",
        title: "Test pairs",
        body:
          "Paren uit de briefing waarvan we wéten hoe het afliep: een historische winnaar tegenover een verliezer met een vergelijkbare uitgangssituatie (bv. twee biotechs met een P3-readout, waarvan er één werkte en één niet). De backtest controleert of de score de winnaar hoger zet.",
      },
      {
        id: "bt-run",
        title: "Backtest draaien",
        body:
          "De knop start de test — Yahoo wordt langzaam doorlopen voor de historische koersen, dat duurt ~1 minuut. Vereist het admin-token. Vernieuw daarna de pagina voor de resultaten.",
      },
      {
        id: "bt-read",
        title: "De uitkomst lezen",
        body:
          "Per paar zie je of het systeem de winnaar correct hoger scoorde. Dit is een sanity-check op de logica, geen voorspelling — de echte validatie gebeurt op het Track record-tabblad zodra er genoeg live signalen zijn geweest.",
      },
    ],
  },

  trackrecord: {
    intro:
      "De werkelijke uitkomsten van eerder uitgegeven signalen, naast de baselines die het systeem vooraf voorspelde. Zo zie je of de scoring in de praktijk klopt.",
    blocks: [
      {
        id: "tr-forward",
        title: "Forward returns (7d / 14d / 30d / 90d)",
        body:
          "Wat het aandeel daadwerkelijk deed 7, 14, 30 en 90 dagen ná het signaal. Worden automatisch achteraf gemeten.",
        example: "Signaal op dag 0, koers $1,00 → 30 dagen later $1,40 → 30d-forward-return = +40%.",
      },
      {
        id: "tr-vs-baseline",
        title: "Baseline vs werkelijk",
        body:
          "De verwachte uitkomst (de historische mediaan voor dat catalyst-type) naast de gerealiseerde return. Het verschil = of het systeem het deze keer goed had. Eén case zegt weinig — het gaat om het patroon over veel signalen.",
      },
      {
        id: "tr-confidence",
        title: "Wanneer is dit betrouwbaar?",
        body:
          "Pas na grofweg 90 STRONG_BUY-signalen over 6+ maanden bevatten deze cijfers signaal boven ruis (briefing §10). Daarvoor is de steekproef te klein om er conclusies aan te verbinden.",
      },
      {
        id: "tr-filter",
        title: "Filter op data completeness",
        body:
          "Met de minimum-completeness-filter gooi je signalen weg die op veel ontbrekende invulvelden gebaseerd waren — die voegen vooral ruis toe.",
      },
    ],
  },

  status: {
    intro:
      "Een live-overzicht van alle doorlopende achtergrond-jobs (koersen ophalen, scores berekenen, nieuws scannen, de TradingView-screeners, notificaties versturen, …). Eén oogopslag of alles draait.",
    blocks: [
      {
        id: "st-dots",
        title: "De gekleurde bolletjes",
        body:
          "🟢 = laatste run gelukt én op tijd. 🟡 = liep langer geleden dan verwacht (mogelijk vastgelopen of overgeslagen). 🔴 = de laatste run gaf een fout. ⚪ = al lang niet meer gedraaid (of nog nooit gezien). De fout-jobs staan automatisch bovenaan.",
        example:
          "Zie je `scan-bottoms` op 🔴 of ⚪ staan met een foutmelding over de TradingView-API? Stuur me die regel (of een screenshot), dan repareer ik 'm.",
      },
      {
        id: "st-fields",
        title: "Wat je per job ziet",
        body:
          "De vriendelijke naam + het technische job-id, een korte uitleg wat 'ie doet, hoe lang geleden 'ie voor het laatst startte, het verwachte interval (~elke 10 min / ~1×/dag / …), hoeveel runs er de laatste 24u waren en hoeveel daarvan gelukt zijn, en de laatste foutmelding/statusregel.",
      },
      {
        id: "st-strip",
        title: "De balkjes-rij (run-historie)",
        body:
          "De laatste ~15 runs als kleine vierkantjes, links = oudst. Groen = gelukt, rood = fout. Zo zie je in één oogopslag of iets structureel hapert of maar één keer een hik had. Houd je muis erboven voor tijd + boodschap van die run.",
      },
      {
        id: "st-falsealarm",
        title: "Bekend 'vals alarm'",
        body:
          "`dispatch-alerts` kan op 🔴 staan met een Resend-403-foutmelding — dat is alleen de e-mail die niet verstuurd kan worden (Resend test-mode); de ntfy-pushmeldingen werken wél. En `poll-metals` draait alleen op beursdagen, dus in het weekend kan 'ie even op 🟡 staan — dat is normaal.",
      },
    ],
  },
  settings: {
    intro: "Hier stel je in waar en wanneer je notificaties krijgt, en welke aandelen wél een melding waard zijn.",
    blocks: [
      {
        id: "set-channels",
        title: "E-mail & ntfy-topic",
        body:
          "Waar de pushmeldingen heen gaan. ntfy is een gratis push-app (ntfy.sh / de ntfy-app op je telefoon): kies een geheime topic-naam en abonneer je daarop in de app, vul diezelfde naam hier in. E-mail werkt momenteel alleen naar het bij Resend geverifieerde adres (test-mode) — ntfy is de betrouwbare weg.",
      },
      {
        id: "set-quiet",
        title: "Quiet hours",
        body:
          "Uren (in UTC) waarin er níéts gepusht wordt — bv. 's nachts. Buiten dat venster gaan meldingen gewoon door.",
      },
      {
        id: "set-policy",
        title: "Wat wordt er eigenlijk gepusht?",
        body:
          "Bewust streng, om ruis te voorkomen: (1) je aankooplimiet die geráákt is — altijd, voor elk aandeel; (2) 'dicht bij je aankooplimiet' — alleen voor aandelen met minimaal 2 gouden medailles; (3) bullish catalyst-nieuws — alleen als de algoritmische score op BUY of STRONG_BUY staat. Al het andere (koersdalingen, near-low, 8-K-ruis, volume-spikes, JV-nieuws…) zie je wél op het dashboard maar krijg je niet als melding.",
      },
      {
        id: "set-token",
        title: "Admin-token",
        body:
          "Het wachtwoord voor admin-acties: aandelen toevoegen, instellingen opslaan, jobs handmatig triggeren (de 'Herbereken'-knop op Scores, de Backtest-knop). In te vullen via de 'token'-knop bovenaan in de balk; wordt alleen lokaal in je browser bewaard. Als acties met '401 Unauthorized' falen, klopt dit token niet.",
      },
    ],
  },
};

export function HelpPanel({ pageId }: { pageId: string }) {
  const help = PAGE_HELP[pageId];
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  if (!help) return null;
  const visible = help.blocks.filter((b) => !dismissed.has(b.id));
  const hiddenCount = help.blocks.length - visible.length;

  function dismiss(id: string) {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    saveDismissed(next);
  }
  function resetPage() {
    const next = new Set(dismissed);
    for (const b of help.blocks) next.delete(b.id);
    setDismissed(next);
    saveDismissed(next);
  }

  return (
    <section id="page-help" className="mt-12 pt-8 border-t border-ink-5 space-y-4 scroll-mt-24">
      <SectionHeader
        eyebrow="Uitleg"
        title="Wat zie je op deze pagina?"
        subtitle={help.intro}
      />
      {visible.length === 0 ? (
        <Card className="p-4 text-sm text-neutral-400">
          Alle uitleg op deze pagina is verborgen.{" "}
          <button onClick={resetPage} className="text-fog-pink hover:underline">
            Toon weer
          </button>
        </Card>
      ) : (
        <div className="space-y-2 max-w-3xl">
          {visible.map((b) => (
            <Card key={b.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="font-bold text-neutral-50">{b.title}</div>
                <button
                  onClick={() => dismiss(b.id)}
                  className="shrink-0 text-[11px] rounded-full border border-ink-5 px-2 py-0.5 text-neutral-400 hover:text-fog-lime hover:border-fog-lime/40 transition"
                  title="Verberg dit blokje (komt terug via 'weer tonen')"
                >
                  ✓ dit snap ik
                </button>
              </div>
              <p className="text-sm text-neutral-300 leading-relaxed mt-2 whitespace-pre-line">
                {b.body}
              </p>
              {b.example && (
                <div className="text-xs rounded-lg bg-fog-pink/[0.06] border-l-2 border-fog-pink pl-3 py-2 pr-3 text-neutral-300 mt-2">
                  <span className="text-fog-pink uppercase tracking-wider text-[10px] font-bold mr-2">
                    voorbeeld
                  </span>
                  {b.example}
                </div>
              )}
            </Card>
          ))}
          {hiddenCount > 0 && (
            <button
              onClick={resetPage}
              className="text-xs text-neutral-500 hover:text-fog-pink hover:underline"
            >
              {hiddenCount} verborgen blokje{hiddenCount > 1 ? "s" : ""} op deze pagina weer tonen
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function scrollToPageHelp(): void {
  const el = document.getElementById("page-help");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  else window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}
