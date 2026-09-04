// Per-pagina uitleg, onderaan elk tabblad. Vervangt het losse Legenda-tab.
// Elk blokje heeft een "✓ dit snap ik"-knop; onderaan staat "Ik snap het" om
// alles in één keer weg te klikken. Via "Toon weer" komen verborgen blokken terug.
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
  meldingen: {
    intro:
      "Het grootboek van alle ntfy-pings die zijn verstuurd: welk aandeel, wanneer, door welke bron en met welke prioriteit. Per aandeel markeer je hier wat je ervan vond, en zet je of je er nog meldingen over wilt.",
    blocks: [
      {
        id: "meld-views",
        title: "Twee weergaven — Per aandeel · Tijdlijn",
        body:
          "Per aandeel = één regel per ticker, met het aantal meldingen, de laatste datum en de hoogste prioriteit die ooit is gebruikt. Hier markeer en demp je.\nTijdlijn = elke melding los, nieuwste eerst. Puur om terug te lezen wat er wanneer is gestuurd; markeren gebeurt per aandeel, niet per melding.",
      },
      {
        id: "meld-markeren",
        title: "Markeren — gezien · hartje · sterren",
        body:
          "Dezelfde drie markeringen als op de andere tabbladen, en ze delen dezelfde opslag: wat je hier aanvinkt zie je terug op het Dashboard, in de Watchlist en bij Favorieten.\nGezien (vinkje) = afgehandeld. Het aandeel verdwijnt uit dit overzicht en je krijgt er geen ntfy-meldingen meer over, ook geen urgente. Met de knop 'Toon gezien' haal je ze terug in beeld; het vinkje weghalen zet de meldingen weer aan.\nHartje = favoriet, komt in de favorieten-lijst en wordt vaker gepolld. Sterren 1-5 = jouw waardering; een aandeel sterren geven maakt het automatisch favoriet.\nLet op de combinatie: een favoriet die je ook als gezien afvinkt wordt stil, ook al staat hij in je favorieten. Wil je alerts blijven krijgen, laat het gezien-vinkje dan uit.",
      },
      {
        id: "meld-dempen",
        title: "Meldingen ontvangen — dempen per aandeel",
        body:
          "Kies per aandeel of je er nog ntfy-meldingen over wilt: gewoon ontvangen, of niet meer voor 3, 6 of 12 maanden, of voorgoed. Een demping die afloopt hoef je niet op te ruimen — daarna komen meldingen vanzelf weer door.\nLet op het verschil met de cooldown in Instellingen. De cooldown onderdrukt alleen herhaling (niet vaker dan eens per zoveel dagen) en laat een melding met een hogere prioriteit er wel doorheen. Een demping is absoluut: die houdt ook urgente meldingen tegen. Dat is bewust — je hebt expliciet gezegd dit aandeel niet meer te willen horen.",
        example:
          "Een aandeel dat je hebt afgeschreven zet je op 'Niet - 12 maanden'. Over een jaar komt het vanzelf weer in beeld als er dan nog steeds iets speelt.",
      },
      {
        id: "meld-prio",
        title: "Prio — ntfy-prioriteit 1 t/m 5",
        body:
          "De prioriteit waarmee de ping is verstuurd. 4 (hoog) en 5 (urgent) komen ook door een stille telefoon heen; 1 t/m 3 blijven rustig. De prioriteit bepaalt ook of een melding door de cooldown mag breken.",
      },
    ],
  },
  dashboard: {
    intro:
      "Elke tegel is één aandeel uit je watchlist. De achtergrondkleur van de tegel zegt hoe 'koopwaardig' het er nu uitziet (heat). Hottere tegels staan bovenaan.",
    blocks: [
      {
        id: "dash-topbar",
        title: "Knoppen in de topbalk — token · ↓uitleg · ↻ vernieuw",
        body:
          "● token = je admin-wachtwoord invullen. Vereist voor acties die de DB wijzigen (aandelen toevoegen, instellingen opslaan, jobs handmatig starten). Wordt alleen lokaal in je browser opgeslagen.\n↓ uitleg = scrolt direct naar dit uitleg-blok onderaan de pagina.\n↻ vernieuw = haalt een verse snapshot op van de backend (normaal gebeurt dit automatisch elke 60 seconden). Het groene bolletje naast de tijd pulseert ~3 seconden na een verse reload.",
      },
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
        title: "Sector-badge — BIO / MIN / AI / OTH",
        body:
          "Biotech, Mining, AI of Overig. Bepaalt ook welke scoring-gewichten gebruikt worden (een biotech wordt op andere dingen beoordeeld dan een mijnbouwer). AI en Overig worden niet algoritmisch gescoord: die volg je op koers, limiet en medailles.",
      },
      {
        id: "dash-score",
        title: "Goud-score (rechtsboven op de tegel)",
        body:
          "Jouw handmatige curatie-cijfer (0–100): hoe sterk jíj dit aandeel als interessant hebt aangemerkt. Dit is NIET de algoritmische score — die staat op het tabblad Scores. De goud-score bepaalt mee de tegelkleur (≥80 rood, ≥65 oranje, ≥35 geel).",
      },
      {
        id: "dash-medals",
        title: "Medailles — 🏆 🥈 🥉",
        body:
          "Uit de koersgeschiedenis van de afgelopen 5 jaar: hoe vaak dit aandeel een flinke koers-run heeft gemaakt (een zigzag-run omhoog). 🏆 = de grootste klasse runs, 🥈 / 🥉 = kleinere. Geeft een gevoel of het aandeel 'beweeglijk' is.",
        example: "🏆1 🥉2 = één keer flink ge-x'ed in 5 jaar, plus twee kleinere runs.",
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
        title: "Filter-pills bovenaan — heat-filter",
        body:
          "Filteren op heat-niveau (alleen Hot, alleen Warm, enz.) zodat je niet door 3600 tegels hoeft te scrollen. Klik op een pill om te activeren; opnieuw klikken zet 'm uit. 'Alles' toont de volledige watchlist.",
      },
      {
        id: "dash-tileprefs",
        title: "Tegel-instellingen (via het ⚙ icoon of Instellingen-tab)",
        body:
          "Welke velden er op een tegel verschijnen kun je zelf aan/uitzetten: medailles, goud-score, range-balk, catalyst-blok, signaal-blok, dagverandering, enz. Pas je dit aan, dan wordt de voorkeur opgeslagen in je browser.",
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
        id: "sc-filter",
        title: "Filter- en zoekbalk bovenaan",
        body:
          "Filter op actie (STRONG_BUY / BUY / WATCH / HOLD / AVOID), sector (Biotech / Mining / Overig), en zoek op ticker of bedrijfsnaam. Combinaties zijn mogelijk: alleen STRONG_BUY in Biotech, enz. Het getal achter elke pill laat zien hoeveel aandelen in die categorie vallen.",
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
        title: "Sector — biotech / mining / ai / other",
        body:
          "Bepaalt welke scoring-gewichten en welke nieuws-bronnen gebruikt worden. Wordt bij het toevoegen automatisch geraden op basis van de bedrijfsnaam (woorden als 'Therapeutics', 'Mining', 'Lithium', 'Semiconductor'…), maar je kunt 'm aanpassen. 'AI' is de groep AI-/chip-aandelen: die krijgen geen katalysator-scoring en geen biotech-briefing, maar wel koersen, limieten, medailles en meldingen. 'Other' = valt buiten alle drie.",
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
          "Handmatig in te vullen via het detail-venster (klik op een rij of op het ✏️-icoon). Hoe meer je invult, hoe minder de score hoeft te gokken (zie 'Data completeness' op Scores). Een paar in begrijpelijke taal: cash runway = hoeveel maanden geld het bedrijf nog heeft voordat het moet bijfinancieren; jurisdiction tier-1 = Canada/Australië/VS (laag landrisico), tier-3 = bv. DRC/Mali (hoog risico); phase = welke klinische fase de hoofdstudie is.",
      },
      {
        id: "wl-rowactions",
        title: "Acties per rij — ✏️ bewerken · 🗑 verwijderen · bank",
        body:
          "✏️ (of klik op een rij) = opent het detail-venster waar je alle velden kunt invullen. 🗑 = verwijdert het aandeel volledig uit de watchlist, inclusief alle signalen en koersdata. 'Op de bank' zetten (zie ook het bank-blok hieronder) doe je door het bench-vlag in het detail-venster aan te zetten.",
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
        id: "wl-cleanup",
        title: "Opruimen — dedup · valideer · bankfilter",
        body:
          "Dedup = verwijdert dubbele tickers (zelfde Yahoo-symbool). Valideer = controleert alle tickers opnieuw via Yahoo; ongeldige symbolen worden gemarkeerd. Bankfilter = toont alleen 'gebenched' aandelen zodat je ze kunt herstellen (goed symbool invullen) of definitief verwijderen.",
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
          "Sorteert net als de Olympische medaillespiegel: eerst meeste 🏆, bij gelijk meeste 🥈, dan 🥉. De medailles komen uit de 5-jaars koersgeschiedenis — hoe vaak het aandeel een flinke koers-run maakte (🏆 = grootste klasse). Handig om te zien welke aandelen op je radar historisch het beweeglijkst waren.",
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
        id: "lim-view",
        title: "Weergave — lijst vs tegel · sorteer-opties",
        body:
          "Rechts bovenaan kun je schakelen tussen lijstweergave (tabel) en tegelweergave (kaartjes). Sorteeropties: dichtstbij limiet, medailleklassement, koers omhoog/omlaag, dividend hoog-laag, ticker A–Z. De geselecteerde weergave en sortering worden onthouden per browser-sessie.",
      },
      {
        id: "lim-import",
        title: "Bulk-import van limieten (onderaan de pagina)",
        body:
          "Plak `ticker prijs` per regel, óf een CSV met een 'Buy Limit'-kolom (Ticker, Name, Currency, Buy Limit). Bestaande aandelen krijgen hun limiet bijgewerkt; aandelen die nog niet in je watchlist staan worden toegevoegd (na een Yahoo-check). Lege of 0-limieten worden stil overgeslagen.",
      },
      {
        id: "lim-remove",
        title: "Limiet verwijderen (het ✕ achter een rij)",
        body: "Wist alleen de aankooplimiet — het aandeel blijft gewoon in je watchlist. Je koers-alerts voor dit aandeel worden ook uitgeschakeld tot je een nieuwe limiet instelt.",
      },
    ],
  },

  backtest: {
    intro:
      "Een terugtest van de scoring-logica op een vaste set bekende historische gevallen, zodat je kunt zien of het algoritme winnaars consequent hoger zet dan verliezers. LET OP: dit tabblad vult zich NIET vanzelf — je moet de backtest handmatig starten (zie onderstaand).",
    blocks: [
      {
        id: "bt-handmatig",
        title: "Waarom is dit tabblad vaak (bijna) leeg?",
        body:
          "Backtest is een handmatige terugtest, geen continue achtergrondjob. Hij draait alleen wanneer jij op de 'Backtest draaien'-knop drukt (met admin-token gezet). Resultaten blijven daarna staan tot je opnieuw draait. Standaard is er dus geen recente data — het is een eenmalige sanity-check.",
      },
      {
        id: "bt-pairs",
        title: "Test pairs",
        body:
          "Paren uit de briefing waarvan we wéten hoe het afliep: een historische winnaar tegenover een verliezer met een vergelijkbare uitgangssituatie (bv. twee biotechs met een P3-readout, waarvan er één werkte en één niet). De backtest controleert of de score de winnaar hoger zet.",
      },
      {
        id: "bt-run",
        title: "Backtest draaien (de knop)",
        body:
          "De knop start de test — Yahoo wordt langzaam doorlopen voor de historische koersen, dat duurt ~1 minuut. Vereist het admin-token (in te vullen via de 'token'-knop bovenaan). Na voltooiing: vernieuw de pagina voor de resultaten.",
      },
      {
        id: "bt-read",
        title: "De uitkomst lezen — ✓ correct / ✗ fout / gelijk",
        body:
          "Per paar zie je of het systeem de winnaar correct hoger scoorde (✓ groen), de verliezer hoger scoorde (✗ rood), of gelijk eindigde. Het totaal-percentage bovenaan = hoe goed het algoritme de historische uitkomsten sorteert.\nDit is een sanity-check op de logica, geen garantie voor de toekomst — de echte validatie gebeurt op het Track record-tabblad zodra er genoeg live signalen zijn.",
      },
      {
        id: "bt-detail",
        title: "Detail per testgeval",
        body:
          "Klik op een rij voor de uitgebreide scorebreakdown: welke deelscores (Structureel / Catalyst / Timing) hoe gewogen zijn, en welke rode vlaggen of bonussen er zijn meegeteld. Handig om te zien waar de logica sterk of zwak is.",
      },
    ],
  },

  trackrecord: {
    intro:
      "De werkelijke uitkomsten van eerder uitgegeven signalen, naast de baselines die het systeem vooraf voorspelde. Zo zie je of de scoring in de praktijk klopt. LET OP: vult zich pas naarmate er BUY/STRONG_BUY-signalen sluiten — momenteel zijn er weinig actionable scores, dus weinig data.",
    blocks: [
      {
        id: "tr-waaromleeg",
        title: "Waarom zie ik (bijna) niks?",
        body:
          "Track record meet de werkelijke return na een BUY of STRONG_BUY-signaal. Dat vereist twee dingen:\n1. Het scoringsalgoritme moet überhaupt BUY/STRONG_BUY uitdelen — momenteel staan vrijwel alle ~3600 scores op AVOID (te strenge drempels).\n2. Het signaal moet 7/14/30/90 dagen oud zijn voor die forward-return-buckets.\nForward-returns-job draait dagelijks om 07:30 UTC. Zodra er BUY-signalen verschijnen en oud genoeg worden, vult deze tab vanzelf.",
      },
      {
        id: "tr-forward",
        title: "Forward returns (7d / 14d / 30d / 90d)",
        body:
          "Wat het aandeel daadwerkelijk deed 7, 14, 30 en 90 dagen ná het signaal. Worden automatisch achteraf gemeten zodra die termijnen verstrijken.",
        example: "Signaal op dag 0, koers $1,00 → 30 dagen later $1,40 → 30d-forward-return = +40%.",
      },
      {
        id: "tr-vs-baseline",
        title: "Baseline vs werkelijk",
        body:
          "De verwachte uitkomst (de historische mediaan voor dat catalyst-type) naast de gerealiseerde return. Het verschil = of het systeem het deze keer goed had. Eén case zegt weinig — het gaat om het patroon over veel signalen.",
      },
      {
        id: "tr-columns",
        title: "Tabelkolommen — Gemiddeld · Mediaan · P25/P75 · Hit rate · N",
        body:
          "Gemiddeld = rekenkundig gemiddelde (gevoelig voor uitschieters). Mediaan = middelste waarde (robuuster). P25/P75 = onderste en bovenste kwartiel — hoe breed de spreiding is. Hit rate 50% = % signalen dat op enig moment +50% bereikte. N = aantal signalen waarop de statistiek is gebaseerd.",
      },
      {
        id: "tr-confidence",
        title: "Wanneer is dit betrouwbaar?",
        body:
          "Pas na grofweg 90 STRONG_BUY-signalen over 6+ maanden bevatten deze cijfers signaal boven ruis. Daarvoor is de steekproef te klein om er conclusies aan te verbinden.",
      },
      {
        id: "tr-filter",
        title: "Filter op data completeness (de schuifbalk)",
        body:
          "Met de minimum-completeness-filter gooi je signalen weg die op veel ontbrekende invulvelden gebaseerd waren — die voegen vooral ruis toe. Schuif naar rechts (bv. min 60%) om alleen signalen te zien met goed gevulde data. Linksonder staat hoeveel signalen er overblijven.",
      },
    ],
  },

  signaallog: {
    intro:
      "Alle BUY/STRONG_BUY-episodes uit de gekozen periode, met instapkoers, huidige koers en de gerealiseerde return. Handig om te zien hoe eerder uitgegeven koop-signalen er achteraf uitzien. LET OP: dit is iets ANDERS dan de signaal-events op de Dashboard-tab — hier gaat het puur om de hoogste actie-scores (BUY/STRONG_BUY).",
    blocks: [
      {
        id: "sl-waaromleeg",
        title: "Waarom is dit zo leeg, terwijl er wel signalen zijn?",
        body:
          "Dit tabblad toont alleen 'koopwaardige' episodes (BUY of STRONG_BUY). Op het Dashboard zie je daarentegen ALLE soorten signaal-events (FDA-meldingen, koers-spikes, near-low alarmen, etc.) — die zijn er volop (16k+ in 7 dagen).\nBij weinig BUY-scores blijft Signaallog dus leeg. Verifieer op de Scores-tab: hoeveel STRONG_BUY/BUY zijn er nu? Als nul → dit tabblad blijft leeg tot scores actionable worden.",
      },
      {
        id: "sl-episode",
        title: "Wat is een episode?",
        body:
          "Een episode = een aaneengesloten reeks dagen waarop het algoritme BUY of STRONG_BUY gaf voor dezelfde ticker. Als er meer dan 5 dagen zonder signaal tussen zitten, telt het als een nieuw signaal. Return = (huidige koers − koers op de eerste signaaldag) ÷ instapkoers.\nBij lopende episodes is de 'huidige koers' de meest recente slotkoers; bij afgesloten episodes is het de koers op de dag dat het signaal wegviel.",
        example:
          "Algoritme geeft STRONG_BUY op 1 jan, 2 jan, 5 jan → één episode van 3 signaal-dagen. Op 15 jan gaat het signaal weg → episode afgesloten.",
      },
      {
        id: "sl-kpis",
        title: "Samenvatting-KPI's — Episodes · Lopend · Gem. return · Positief",
        body:
          "Episodes = totaal aantal episodes in de huidige filter. Lopend = hoeveel daarvan het algoritme nóg steeds BUY/STRONG_BUY geeft. Gem. return = gemiddeld rendement over alle episodes met een bekende koers. Positief = % episodes dat momenteel in de plus staat.",
      },
      {
        id: "sl-filters",
        title: "Filters — Signaal · Status · Sector · Periode · Zoek",
        body:
          "Signaal: filter op STRONG_BUY of BUY. Status: Lopend = signaal nog actief, Afgesloten = al gestopt. Sector: Biotech / Mining / Other. Periode: hoever terug je kijkt (30d / 60d / 90d / 180d / 365d). Zoek: typ een ticker om direct te filteren. Combinaties werken: bv. alle lopende STRONG_BUY-signalen in Biotech.",
      },
      {
        id: "sl-columns",
        title: "Tabelkolommen — Ticker · Signaal · Gestart · Dagen · Gestopt · Instap · Nu · Return · Score",
        body:
          "Ticker = het aandeel; klik voor Google Finance. Signaal = hoogste actie-label in die episode (STRONG BUY of BUY), met een groen bolletje als 'ie nog actief is. Gestart = eerste dag van het signaal. Dagen = hoe lang het signaal liep/loopt. Gestopt = datum waarop het signaal wegviel (of 'actief'). Instap = koers op de startdag. Nu = meest recente koers. Return = rendement vanaf instap. Score = hoogste algorithme-score in de episode.",
      },
      {
        id: "sl-return",
        title: "Return-visualisatie (balk + %)",
        body:
          "De minibalkie naast het %-getal loopt links van het midden voor verlies, rechts voor winst. De schaal is logaritmisch: tot ±50% lineair, daarboven afnemend (zodat een +500%-run niet alles overschaduwt). Kleur: groen = winst, rood = verlies.",
      },
      {
        id: "sl-sort",
        title: "Sorteerbare kolommen (klik op een kolomkop)",
        body:
          "Klik op Ticker, Gestart, Dagen, Return of Score om op die kolom te sorteren. Klik nog een keer voor omgekeerde volgorde (↑ / ↓). Null-waarden staan altijd onderaan, ongeacht de sort-richting.",
      },
      {
        id: "sl-refresh",
        title: "↻ Vernieuw-knop",
        body:
          "Haalt de nieuwste episodelijst op. Normaal worden koersen elk uur ververst, dus na beurstijd zijn de returns up to date. De knop is ook handig als je net een score hebt herberekend en wil zien of lopende signalen zijn veranderd.",
      },
    ],
  },

  scans: {
    intro:
      "Dagelijkse automatische TradingView-scans zoeken naar aandelen met een medailletrack record die op het punt staan te bewegen: de grootste dalers van de dag én aandelen die vlak bij hun 5-jaars bodem staan. Treffers worden automatisch aan je watchlist toegevoegd.",
    blocks: [
      {
        id: "scan-status",
        title: "Scan-status kaarten — scan-losers · scan-bottoms",
        body:
          "Twee achtergrond-jobs, elk met een eigen statuskaart:\nscan-losers = doorzoekt dagelijks de TradingView 'grootste dalers'-screener. Alleen aandelen met ≥1× goud én ≥1× zilveren medaille worden meegenomen — pure koersspuiers zonder track record worden gefilterd.\nscan-bottoms = doorzoekt de TradingView '5-jaars bodem'-screener. Alleen aandelen met ≥3× gouden medailles worden meegenomen (hogere lat, want een bodem is geen trigger op zich).\nHet groene/rode bolletje = status van de laatste run. Klik op 'Status' in de navigatie voor uitgebreide job-details.",
      },
      {
        id: "scan-metrics",
        title: "Run-statistieken — dalers · nieuw · gecheckt · treffers · toegevoegd",
        body:
          "Dalers = hoeveel aandelen de TradingView-screener die dag opleverde. Gecheckt = hoeveel daarvan al in je watchlist stonden (die worden niet dubbel toegevoegd). Nieuw = hoeveel onbekende tickers zijn gecontroleerd. Treffers = hoeveel voldoen aan het medaillecriterium. Toegevoegd = hoeveel er daadwerkelijk zijn toegevoegd aan de watchlist (groen getal).",
      },
      {
        id: "scan-filters",
        title: "Filter- en zoekbalk — Bron · Sector · Zoek · Sorteer",
        body:
          "Bron: filter op 'Grootste dalers' of '5y-bodem'. Sector: Biotech / Mining / Overig. Zoek: ticker of bedrijfsnaam. Sorteer: datum (nieuw eerst of oud eerst), medailleklassement (Olympisch), aantal gouden medailles, of ticker A–Z.",
      },
      {
        id: "scan-columns",
        title: "Tabelkolommen — Ticker · Bedrijf · Sector · Bron · Medailles · Koers · Slim limit · Toegevoegd · Reden",
        body:
          "Ticker = klikbaar (opent Google Finance). Bron = welke scan dit aandeel heeft gevonden (badge 'Grootste dalers' of '5y-bodem'). Medailles = 🏆🥈🥉 uit de 5-jaarsgeschiedenis. Koers = laatste slotkoers. Slim limit = automatisch berekend aankooplimiet (als beschikbaar). Toegevoegd = datum/tijd van automatisch toevoegen. Reden = toelichting van de scan (bv. 'goud×2, zilver×1, daler −12%').",
      },
      {
        id: "scan-slimlimit",
        title: "Slim limit (de auto-berekende aankooplimiet)",
        body:
          "Als het systeem een buy limit kan afleiden uit de technische data (bv. een recent support-niveau of de 52-weeks bodem) zet het die in de 'Slim limit'-kolom. Groen en vet = de koers staat al op of onder die limiet. Je kunt de limiet altijd handmatig overschrijven via de Limieten-tab.",
      },
    ],
  },

  xinix: {
    intro:
      "De lerende gesimuleerde belegger Xinix. Dit tabblad toont twee dingen: de 'Basisportefeuille' (één papieren portefeuille van $10.000 met vaste parameters) en 'Potje' (een serie parallelle papieren portefeuilles die allemaal andere parameters testen).",
    blocks: [
      {
        id: "xi-tabs",
        title: "Tab-switcher — 📈 Basisportefeuille · 🔬 Potje",
        body:
          "Basisportefeuille = de gecureerde enkelvoudige portefeuille: max 8 posities, ~$1200 per positie, 60 dagen holdperiode, trailing stop -15%, deelwinst bij +25%. Doel: één duidelijk referentiepunt.\nPotje = parallelle papieren portefeuilles die elk een andere parameter-combinatie testen (groepen A t/m W). Doel: ontdekken welke instelling-mix het beste werkt. Na verloop van tijd 'evolueren' de zwakste strategieën weg.",
      },
      {
        id: "xi-kpis",
        title: "KPI's — Totaal vermogen · Rendement · Open posities · Gesloten trades",
        body:
          "Totaal vermogen = cash + waarde open posities. Rendement = (totaal vermogen − startkapitaal) ÷ startkapitaal. Open posities = hoe veel slots er nu bezet zijn (max 8). Gesloten trades = hoeveel keer er al verkocht is. 'Gerealiseerd' = al in cash omgezet, 'open' = nog op papier.",
      },
      {
        id: "xi-equitycurve",
        title: "Equity-curve (de lijngraaf)",
        body:
          "Dagelijkse snapshots van het totale vermogen. Een stijgende lijn = gemiddeld positieve koersen of goede exits. Een platte lijn = weinig open posities of weinig beweging. De curve begint pas zodra er ≥2 dagelijkse snapshots zijn (dus na dag 2).",
      },
      {
        id: "xi-openpos",
        title: "Open posities — Ticker · Qty · Entry · Koers · P/L · Stop · Dagen · Reden",
        body:
          "Qty = aantal aandelen. Entry = gemiddelde aankoopkoers + datum. Koers = huidige slotkoers. P/L = ongerealiseerd rendement (% én dollar). Stop = huidige trailing-stop-prijs (ratchets mee omhoog als de koers stijgt). Dagen = nog hoeveel dagen tot het maximale hold-venster verstrijkt (rood/oranje bij ≤7 dagen). Reden = welke signaaltypen de aankoop triggerde.",
      },
      {
        id: "xi-exits",
        title: "Exit-types (hoe Xinix verkoopt)",
        body:
          "Er zijn vier manieren waarop een positie gesloten wordt:\n1. Trailing stop geraakt: koers zakt onder de ratchet-stop → directe verkoop.\n2. Deelwinst (+25%): zodra de koers +25% is, verkoopt Xinix de helft — de rest blijft open.\n3. Signaalverval: het koop-signaal is verlopen, er is verlies, en de positie is lang genoeg aangehouden → vroegtijdige exit.\n4. Holdperiode verstreken: na 60 dagen wordt de volledige positie gesloten.\nIn de 'Reden exit'-kolom staat welke van deze vier van toepassing was.",
      },
      {
        id: "xi-closedpos",
        title: "Gesloten posities — filter Winnaars / Verliezers",
        body:
          "Elke afgesloten trade met entry-koers, exit-koers, held dagen, P/L en de reden van entry én exit. Filter op Winnaars (P/L > 0) of Verliezers (P/L < 0) om patronen te zoeken — werkt een bepaald signaaltype consistent goed of slecht?",
      },
      {
        id: "xi-insights",
        title: "Inzichten & aanbevelingen (het lerende deel)",
        body:
          "Zodra er ≥3 gesloten trades per signaaltype zijn, genereert Xinix automatisch aanbevelingen: welke signaaltypen het best presteren, welke sectoren over- of onderpresteren, en suggesties om de scoring aan te passen. Dit is het doel van de simulatie: data verzamelen om slimmer te worden.",
      },
      {
        id: "xi-sim",
        title: "Potje — ranglijst, groepen, parameters",
        body:
          "De strategieën zijn verdeeld in groepen (A t/m W): elke groep test één dimensie — score-drempel, holdperiode, stop-loss %, take-profit, sector-focus, positiegrootte, signaaltype, medaille-filter, limiet-buffer, enz. De ranglijst sorteert op samengestelde fitness (rendement + Sharpe-ratio − drawdown-straf). Klik op een rij om uit te klappen: je ziet dan de parameters, wat de strategie uniek maakt t.o.v. de andere, en welke aandelen er nu in zitten met de koopredenen.",
      },
      {
        id: "xi-evolve",
        title: "Evolutie-knop (wekelijkse pensionering + mutatie)",
        body:
          "Elke week worden de onderste 5% strategieën 'gepensioneerd' (gestopt, hun gesloten posities blijven zichtbaar). De top 5% wordt licht gemuteerd en opnieuw gestart — kleine aanpassingen aan hun parameters. Zo convergeert het systeem over maanden naar de best werkende combinaties. De 'Evolutie starten'-knop triggert dit handmatig (vereist admin-token).",
      },
      {
        id: "xi-export",
        title: "Kennis-export (maandelijkse snapshot)",
        body:
          "Op de 1e van elke maand maakt Xinix een volledige snapshot: welke strategieën het beste werkten, welke signaaltypen het meest rendabel waren, aanbevelingen voor de scoring. Terug te vinden in de 'Evolutie'-sectie onder 'Kennis-export'. Via de knop 'Export nu' kun je ook handmatig exporteren (vereist admin-token).",
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
        id: "st-detail",
        title: "Run-detail modal (klik op een balkje)",
        body:
          "Klik op een gekleurd balkje in de run-histoire om het volledige detail van die run te zien: exacte starttijd, looptijd, foutmelding of uitvoer-JSON (bij succesvolle runs: metrics zoals aantal verwerkte tickers, gevonden signalen, enz.).",
      },
      {
        id: "st-trigger",
        title: "Handmatig triggeren van een job",
        body:
          "Sommige jobs hebben een '▶ Nu starten'-knop. Vereist het admin-token. Handig voor de markt-regime-check, de kennis-export of het herberekenen van scores zonder te wachten op de automatische cron. De run-status verschijnt daarna in de balkjes-rij.",
      },
      {
        id: "st-falsealarm",
        title: "Bekend 'vals alarm'",
        body:
          "`dispatch-alerts` kan op 🔴 staan met een Resend-403-foutmelding — dat is alleen de e-mail die niet verstuurd kan worden (Resend test-mode); de ntfy-pushmeldingen werken wél. En `poll-metals` draait alleen op beursdagen, dus in het weekend kan 'ie even op 🟡 staan — dat is normaal.",
      },
    ],
  },

  zwitserleven: {
    intro:
      "🌴 Zwitserleven = 'fallen angels met dividendzekerheid' uit de grote indices. De scan zoekt aandelen uit NASDAQ-100, Dow Jones (DJIA), AEX, FTSE 100, CAC 40 en SMI (Zwitserland) die fors gezakt zijn van hun 5-jaars-top, maar wél een gezond dividend uitkeren én historisch bewezen herstelvermogen hebben. Doel: een rustige inkomstenstroom uit aandelen waar 'het lijf nog wel zit, maar de koers tijdelijk uit de gratie is'.",
    blocks: [
      {
        id: "zw-universum",
        title: "Universum — waar wordt naar gezocht?",
        body:
          "Bewust GEEN biotech/mining watchlist. De scan loopt over de bluechip- én midcap-indices van zes grote markten:\n\nLarge-caps:\n● 🇺🇸 NASDAQ-100 — top 100 niet-financiële NASDAQ noteringen (AAPL, MSFT, ASML, etc.)\n● 🇺🇸 Dow Jones Industrial Average — 30 grote US bedrijven (KO, JNJ, MMM, etc.)\n● 🇳🇱 AEX — 25 hoofdfondsen Amsterdam (ASML, Shell, ING, etc.)\n● 🇬🇧 FTSE 100 — top 100 Londen (HSBC, Shell, AstraZeneca, etc.)\n● 🇫🇷 CAC 40 — 40 hoofdfondsen Parijs (LVMH, TotalEnergies, Sanofi, etc.)\n● 🇨🇭 SMI — 20 hoofdfondsen Zwitserland (Nestlé, Roche, Novartis, etc.)\n\nMidcaps (vaak rijker aan hoge yields):\n● 🇺🇸 S&P MidCap 400 — gekozen subset van dividend-rijke US midcaps\n● 🇳🇱 AMX (Amsterdam Midkap) — 24 fondsen incl. Wereldhave, PostNL, SBM Offshore\n● 🇬🇧 FTSE 250 — subset van UK midcaps\n● 🇫🇷 CAC Mid 60 — Parijse midcaps\n● 🇨🇭 SMIM 30 — Zwitserse midcaps (Julius Bär, Lindt, Sonova, etc.)\n\nDit is bewust een ander universum dan de Xinix-watchlist (die focust op catalyst-driven biotech/mining).\nHandmatige toevoegingen mogen elke beurs zijn (bv. WHA.AS voor Wereldhave).",
      },
      {
        id: "zw-criteria",
        title: "De vier criteria — wat is een 'Zwitserleven'?",
        body:
          "Een aandeel voldoet aan ALLE vier de criteria:\n● Div % bruto (TTM) ≥ 6,5% — over de afgelopen 12 maanden moet het totale dividend minstens 6,5% van de huidige koers zijn.\n● Val v 5j% ≥ 50% — de huidige koers staat ten minste 50% onder de hoogste slotkoers van de laatste 5 jaar.\n● Max jaar + ≥ 25% — minstens één keer in de laatste 5 jaar heeft het aandeel binnen één kalenderjaar ≥25% gestegen (bewijs dat herstel mogelijk is).\n● Groeijaren ≥ 2 — in minstens 2 van de laatste 5 jaar heeft de koers ≥5% gestegen (geen pure dalende lijn).",
        example:
          "BMY met TTM-dividend van 7%, koers 55% onder 5j-hoog, één gelukkig jaar +30% in 2021, en 3 positieve jaren totaal = ✓ Zwitserleven.",
      },
      {
        id: "zw-tabel-kolommen",
        title: "Kolommen in de tabel — wat betekent elke?",
        body:
          "● Ticker / Naam — het beurssymbool en de bedrijfsnaam. Klik = Google Finance.\n● Beurs / Land — waar het aandeel genoteerd staat. Belangrijk voor bronbelasting.\n● Sector — Biotech / Mining / Overig.\n● Koers — laatste slotkoers van Yahoo Finance.\n● Div % bruto — TTM dividend ÷ huidige koers, vóór belasting.\n● Bronbel % — geschatte dividendbelasting (zie eigen blok hieronder).\n● Div % netto — wat je daadwerkelijk overhoudt na bronbelasting (bruto × (1 − bronbel)).\n● Val v 5j% — hoeveel procent de koers onder zijn 5-jaars-top staat.\n● Max jaar + — beste kalenderjaar-rendement in de afgelopen 5 jaar (bewijs van herstelvermogen).\n● Groeijr — aantal van de laatste 5 jaar met ≥5% koersstijging.\n● Div Y-1 t/m Y-5 — dividendrendement per kalenderjaar (zie eigen blok).\n● Payout — payout ratio (dividend ÷ winst). >85% = risico, >100% = duurzaamheid twijfelachtig.\n● Cuts — hoeveel keer in de afgelopen 5 jaar is het jaardividend met >10% verlaagd. 0 = stabiel.\n● Risico — Laag / Matig / Hoog / Zeer hoog samengevat uit cuts + payout + groeijaren.\n● ✓ — voldoet aan alle vier criteria.",
      },
      {
        id: "zw-bronbelasting",
        title: "Bronbelasting (Bronbel %) en netto dividend",
        body:
          "Het 'bruto' dividendrendement is wat het bedrijf uitkeert. Voor jou als NL-particulier wordt er vooraf bronbelasting ingehouden — dat percentage verschilt per land en per belastingverdrag.\nVoorbeelden (indicatief, NL-particulier):\n● VS (United States): 15% (W-8BEN/W-9 ingevuld via je broker).\n● Verenigd Koninkrijk: 0% (geen bronheffing).\n● Nederland: 15%, verrekenbaar in box 3.\n● Zwitserland: 35% nominaal — 20% terugvorderbaar via verdrag, eindheffing 15%.\n● Duitsland: 26,375% — verdrag cap 15%, deels terug te vragen (papierwerk vereist).\n'Div % netto' is een snelle schatting: bruto × (1 − bronbel). Dit is GEEN belastingadvies — het is een ruwe vergelijkingshulp. Het werkelijke nettorendement hangt af van je broker, verrekening in box 3, en of je terugvorderingsprocedures gebruikt.\nDe kolom toont '—' als het land onbekend is of niet in onze schatting-tabel staat.",
      },
      {
        id: "zw-jaarkolommen",
        title: "Div Y-1 t/m Y-5 — waarom soms leeg?",
        body:
          "Deze kolommen tonen het dividendrendement per kalenderjaar in de afgelopen 5 jaar. De berekening: alle dividenduitkeringen in dat jaar bij elkaar opgeteld, gedeeld door de slotkoers van het einde van dat jaar.\nLeeg ('—') betekent: in dat kalenderjaar zijn er GÉÉN dividenden uitgekeerd door dit bedrijf.\nWaarom staat het aandeel dan toch in de tabel? Omdat het TTM-dividend (laatste 12 maanden, gerold) wél hoog genoeg is. Een aandeel dat pas dit jaar dividend is gaan uitkeren (of na een schorsing weer is begonnen) kan ineens een hoog TTM laten zien terwijl de jaarkolommen leeg blijven.\nLet hier extra op: weinig dividendhistorie = minder voorspelbaar. Combineer altijd met de 'Cuts' en 'Payout' kolommen.",
        example:
          "CURI met 16,7% TTM-dividend maar Div Y-1 t/m Y-5 allemaal '—' = CURI is recent met een grote dividenduitkering begonnen. Hoge yield kan een eenmalige speciale uitkering zijn — onderzoek dit voor je koopt.",
      },
      {
        id: "zw-risico-label",
        title: "Risico — hoe wordt 'Laag' / 'Matig' / 'Hoog' bepaald?",
        body:
          "Het risico-label is een snelle samenvatting van dividendzekerheid:\n● Zeer hoog: meer dan 2 dividendkortingen in 5 jaar, of payout >100% (keert meer uit dan winst — onhoudbaar).\n● Hoog: 2 cuts, of payout >85%.\n● Matig: 1 cut, of payout >70%, of minder dan 2 groeijaren.\n● Laag: 0 cuts, payout ≤70% (of onbekend), én ≥2 groeijaren.\nHET label gaat alleen over dividend-duurzaamheid, NIET over koersrisico. Een 'Laag risico'-aandeel kan nog steeds 30% verder dalen.",
      },
      {
        id: "zw-filters",
        title: "Filterknoppen bovenaan",
        body:
          "● Voldoet aan criteria + handmatig — alleen aandelen die aan alle 4 criteria voldoen, plus alles wat je handmatig hebt toegevoegd.\n● Bijna (yield ≥4% + val ≥30%) — aandelen die er nét niet bij horen maar interessant kunnen zijn om in de gaten te houden.\n● Alle gescand (met dividend) — elk gescand aandeel dat überhaupt dividend uitkeert.",
      },
      {
        id: "zw-scan-knoppen",
        title: "Scan-knoppen — wat doet 'Scan 1×' en 'Auto-scan 20×'?",
        body:
          "● Scan 1× — start één batch van 40 tickers uit het INDEX_UNIVERSE die het langst geleden gescand zijn (of nog nooit). Wacht ~2 min en ververs.\n● Auto-scan 20× — start automatisch 20 batches achter elkaar (≈800 ticker-scans). Aangezien het universum ~300 large-caps is, kun je dus de volledige set in ≤8 batches doorlopen. Tussendoor zie je 'X/20 · +N gevonden'. Klik 'Stop' om vroegtijdig af te breken.\nTickers die in de laatste 90 dagen al gescand zijn worden overgeslagen (anders herhaal je werk). De 'Nog te scannen'-teller geeft aan hoeveel index-leden er nog niet gescand zijn.\nVereist admin-token in de topbalk.",
      },
      {
        id: "zw-sanity",
        title: "Sanity-checks — waarom waarschijnlijk-fout-data wordt uitgesloten",
        body:
          "Yahoo Finance markeert soms eenmalige uitkeringen (special distributions, return of capital, delisting-paybacks) als gewone dividenden. Daardoor kan TTM ineens 100%+ aangeven terwijl het bedrijf in werkelijkheid 2% dividend uitkeert. Voorbeeld: CRH.L gaf 128% door een return of value bij de NYSE-verhuizing.\nTwee extra filters voorkomen dat zulke ruis als 'voldoet' wordt gemarkeerd:\n● TTM-yield ≤ 30%. Boven 30% is bijna altijd een special distribution of currency-fout in Yahoo's data. Reguliere large-cap dividenden zitten zelden boven 15%.\n● Minstens 1 van de laatste 3 kalenderjaren moet een echte dividenduitkering hebben gehad. Een aandeel met een hoog TTM maar 0 historie (zoals CURI: 16,7% TTM, niks in Y-1..Y-5) is een eenmalige flits, geen 'Zwitserleven'. Dividend-zekerheid kan alleen bestaan als er historie is.\nDeze entries verschijnen wel onder filter 'Alle gescand' maar krijgen géén ✓ en zitten niet in 'Voldoet aan criteria'.",
      },
      {
        id: "zw-vindtniks",
        title: "Auto-scan vindt niks — wat nu?",
        body:
          "Goed mogelijk. De criteria zijn streng en bedoeld voor échte fallen angels:\n● Yield ≥ 6,5% TTM — dit is een hoge drempel. Index-large-caps hebben meestal 2–5% yield.\n● 50% onder 5j-hoog — die combinatie met hoge yield is zeldzaam.\nVerwachting: van ~300 large-caps voldoen er typisch 0–5 aan alle 4 criteria. Het is geen lijst met 50 winnaars.\nWat te doen:\n● Kijk onder filter 'Bijna (yield ≥4% + val ≥30%)' voor kandidaten die nét niet voldoen.\n● Of voeg handmatig specifieke aandelen toe die je vertrouwt (bv. JEPI, KO, WHA.AS).\n● Of pas de criteria aan via een toekomstige update als je een soepeler net wil.",
      },
      {
        id: "zw-handmatig",
        title: "Handmatig toevoegen — wat doet dat precies?",
        body:
          "Vul een ticker in (bv. 'KO' voor Coca-Cola, of 'WHA.AS' voor Wereldhave) en druk op '+ Toevoegen & scannen'. Het systeem:\n1. Doet direct een force-scan op die ene ticker via Yahoo Finance (bypass de 90-dagen herscan-regel).\n2. Markeert hem als 'handmatig' (badge 'handm.' bij de ticker).\nHandmatig-toegevoegde aandelen blijven zichtbaar onder het filter 'Voldoet aan criteria + handmatig', ook als ze niet aan de Zwitserleven-criteria voldoen. Zo kun je een eigen lijstje bouwen om te tracken.\nFormat: gebruik altijd de Yahoo Finance ticker (US zonder suffix; .AS Amsterdam, .L Londen, .PA Parijs, .SW Zwitserland, .DE Duitsland, etc.).\nVereist admin-token.",
      },
      {
        id: "zw-verwijderen",
        title: "Verwijderen — fout toegevoegd of niet meer interessant?",
        body:
          "In de laatste tabelkolom (Acties) staat per rij een 🗑-knop. Klik om die ticker uit de Zwitserleven-tabel te halen. Je krijgt een bevestigingspopup met de naam erbij om typo's te voorkomen.\nLet op: een index-ticker (uit NASDAQ-100, AEX, etc.) wordt bij de volgende auto-scan vanzelf weer opnieuw gescand. Voor permanent uitsluiten moet je hem uit de INDEX_UNIVERSE in de backend halen. Voor handmatige toevoegingen is de verwijdering permanent (tot je hem opnieuw handmatig toevoegt).\nVereist admin-token.",
      },
      {
        id: "zw-kolommen-verbergen",
        title: "Kolommen verbergen",
        body:
          "Klik rechtsboven op 'Kolommen (X/Y)' om een lijst met checkboxes te krijgen. Vink kolommen uit om ze te verbergen. Je voorkeur wordt opgeslagen in de browser (per device). Klik 'Reset' voor de standaard-set.",
      },
      {
        id: "zw-notificaties",
        title: "Notificaties — wanneer krijg je een melding?",
        body:
          "Zodra een NIEUW aandeel voor het eerst aan alle criteria voldoet ÉN risico='Laag' krijgt, wordt er één keer een 🌴 ntfy/email-notificatie verstuurd. Bij volgende 90-daagse herscans van hetzelfde aandeel wordt er géén dubbele melding gestuurd, tenzij het van risiconiveau verandert en weer terugkeert naar Laag.",
      },
    ],
  },

  favorieten: {
    intro:
      "Alle aandelen met een hartje, op één rij. Standaard gesorteerd op afstand tot je aankooplimiet, zodat wat het dichtst bij de koop-trigger zit bovenaan staat.",
    blocks: [
      {
        id: "fav-inladen",
        title: "Inladen met voorgestelde limiet",
        body:
          "Met '+ Toevoegen' plak je een lijst tickers (of Google-Finance URL's). Na 'Opzoeken' zie je per aandeel de bedrijfsnaam, beurs, valuta, huidige koers, de 5-jaarsbodem en -top, én een voorgestelde aankooplimiet. Die suggestie is standaard de 5-jaarsbodem plus het percentage uit de Instellingen; je kunt per inlaadsessie omschakelen naar '% onder de huidige koers' en het percentage aanpassen. Alle rijen die je niet zelf hebt aangeraakt rekenen dan meteen mee.\nPer rij pas je aan wat je wilt: de limiet, de sector, sterren, en of het aandeel überhaupt mee moet (vinkje). Pas als je op 'toevoegen' klikt gaat er iets naar de database — je ziet dus eerst wat er gaat gebeuren.",
      },
      {
        id: "fav-toegevoegd",
        title: "Kolom 'Toegevoegd'",
        body:
          "Wanneer je het aandeel favoriet maakte. Sorteer aflopend om de nieuwste bovenaan te krijgen — handig om te controleren of de limiet van je laatste inlaadronde goed staat. Aandelen van de afgelopen twee weken staan in accentkleur. Bij favorieten van vóór deze functie kan het tijdstip ontbreken; die tonen een streepje.",
      },
      {
        id: "fav-limiet",
        title: "Limiet aanpassen in de lijst",
        body:
          "Klik in de kolom 'Limiet' op het bedrag (of op de '+' als er nog geen limiet is) om 'm direct te wijzigen. Enter bevestigt, Escape annuleert. De kolom 'vs limiet' rekent meteen mee: negatief (groen) = de koers staat ónder je limiet.",
      },
      {
        id: "fav-breedte",
        title: "Breedte van de pagina",
        body:
          "Rechtsboven staat een breedte-schakelaar (▯ ▭ ▬): normaal 1280px, breed 1800px, of de volle schermbreedte. De keuze wordt per tabblad onthouden en server-side bewaard, dus 'ie gaat mee naar je andere apparaten. Breder = meer kolommen tegelijk zichtbaar; welke kolommen dat zijn kies je met de kolom-kiezer.",
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
          "Bewust streng, om ruis te voorkomen: (1) je aankooplimiet die geráákt is — altijd, voor elk aandeel; (2) 'dicht bij je aankooplimiet' — alleen voor aandelen met minimaal 2 gouden medailles; (3) bullish catalyst-nieuws — alleen als de algoritmische score op BUY of STRONG_BUY staat. Al het andere (koersdalingen, near-low, 8-K-ruis, volume-spikes, JV-nieuws…) zie je wél op het dashboard maar krijg je niet als melding.\nDe schakelaar 'Alleen very-hot events' zet dit beleid aan (aanbevolen). Uit = je krijgt ook 'zachte' triggers zoals koerssprongen en JV-deals.",
      },
      {
        id: "set-tile",
        title: "Tegel-instellingen",
        body:
          "Welke velden er op elke dashboard-tegel worden getoond: goud-score, medailles, 1y/5y-range, catalyst-blok, signaalblok, dagverandering. Schakel ze aan/uit naar voorkeur. De instelling wordt opgeslagen in je browser (localStorage) en geldt alleen voor dit apparaat.",
      },
      {
        id: "set-pricescan",
        title: "Prijs-scan regels",
        body:
          "Regels die bepalen wanneer een koersbeweging een signaal oplevert (bv. 'big_drop: daling ≥20% in 5 dagen'). Dit zijn geavanceerde instellingen — de standaardwaarden werken goed voor de meeste situaties. Aanpassen kan zinvol zijn als je meer of minder gevoelig wil zijn voor dagdalingen.",
      },
      {
        id: "set-save",
        title: "Opslaan-knop",
        body:
          "Sla gewijzigde instellingen op in de database. Vereist het admin-token. Na opslaan zie je kort een 'Opgeslagen'-bevestiging. Als je een '401 Unauthorized' foutmelding krijgt, is het admin-token niet (meer) ingevuld — vul 'm in via de 'token'-knop rechtsboven.",
      },
      {
        id: "set-token",
        title: "Admin-token (● token knop rechtsboven)",
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

  function dismissAll() {
    const next = new Set(dismissed);
    for (const b of help.blocks) next.add(b.id);
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

          {/* "Ik snap het" — verbergt alle resterende blokken in één klik */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={dismissAll}
              className="inline-flex items-center gap-2 rounded-full bg-fog-lime/10 border border-fog-lime/30 px-4 py-1.5 text-sm font-semibold text-fog-lime hover:bg-fog-lime/20 hover:border-fog-lime/60 transition"
              title="Verberg alle uitleg op deze pagina"
            >
              ✓ Ik snap het — verberg alle uitleg
            </button>
            {hiddenCount > 0 && (
              <button
                onClick={resetPage}
                className="text-xs text-neutral-500 hover:text-fog-pink hover:underline"
              >
                {hiddenCount} verborgen blokje{hiddenCount > 1 ? "s" : ""} weer tonen
              </button>
            )}
          </div>
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
