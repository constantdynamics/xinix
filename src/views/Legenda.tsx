// Legenda met uitleg van de jargon die in notificaties + UI staat.
// Owner kan hier altijd terugvallen als een term cryptisch overkomt.

interface Term {
  term: string;
  short: string;
  long: string;
  example?: string;
}

const TERMS: Term[] = [
  {
    term: "R:R (Reward-to-Risk)",
    short: "Hoeveel je kunt winnen gedeeld door hoeveel je kunt verliezen.",
    long:
      "Verschil tussen target en entry, gedeeld door verschil tussen entry en stop. Onder de 3 doe je de trade in principe niet — je verliezers wegen dan te zwaar tegen je winners op. Hoe hoger, hoe beter de risico/reward verhouding van de setup.",
    example:
      "Entry $12.50, target $31.25, stop $10.20 → winst $18.75 vs verlies $2.30 → R:R = 8.2. Voor elke €1 risico kun je €8 winnen áls het werkt.",
  },
  {
    term: "Kans op hit",
    short:
      "Historisch % vergelijkbare catalysts waar de koers ≥+50% piekte binnen 90 dagen.",
    long:
      "Berekend per catalyst type (P3 readout, FDA PDUFA, drilling result, etc.) en per sector, op basis van events 2018-2024. Een 'hit' = de koers piekte minimaal 50% boven entry binnen 90 dagen. Zegt niets over of het deze keer wérkt — het is de a-priori kans op basis van vergelijkbare cases.",
    example:
      "Kans op hit 30% bij een P3 readout = van elke 10 vergelijkbare P3 trials gingen er ongeveer 3 met +50% of meer omhoog. De andere 7 deden niks of zakten.",
  },
  {
    term: "N (sample size)",
    short: "Aantal historische events waarop het % gebaseerd is.",
    long:
      "N≈20-50 betekent dat de hit-rate berekend is op grofweg 20 tot 50 vergelijkbare cases. Voor sommige catalyst types zijn er sinds 2018 maar ~20 events, voor andere ~50. Hoe lager de N, hoe minder betrouwbaar het percentage.",
  },
  {
    term: "Wide CI (confidence interval)",
    short: "Het percentage is een schatting, geen exacte waarheid.",
    long:
      "Met een kleine N is '30%' geen harde waarde — de echte hit-rate ligt waarschijnlijk ergens in een brede band (bv. 18-45%). Klein sample = grote onzekerheid. Behandel het cijfer als richting / prior, niet als belofte.",
    example:
      "Een baseline van 30% bij N=25 heeft een 95%-CI van ongeveer 14-50%. De 'echte' kans kan dus best 20% of 40% zijn — gebruik het cijfer om setups te ranken, niet om absolute uitkomsten te voorspellen.",
  },
  {
    term: "Piek bij hit",
    short: "Verwachte piek als de catalyst slaagt (mediaan vergelijkbare cases).",
    long:
      "Mediane peak return van historische winners voor dit catalyst type. Niet het gemiddelde — het is de middelste waarneming. Helft van de winners deed minder, helft meer. Zegt niets over de kans dat dit gebeurt — die zit in 'kans op hit'.",
    example:
      "Piek +150% bij een P3 readout: van P3 trials die +50% of meer pieken (de hits) was de typische piek 150% boven de pre-readout koers.",
  },
  {
    term: "T+90 mediaan",
    short: "Verwachte koers 90 dagen na catalyst, niet op de piek.",
    long:
      "Biotech doet vaak sell-the-news: piek +150% maar T+90 zakt terug naar +50%. Mining houdt waarde beter vast. Het verschil tussen Piek en T+90 is hoeveel winst je teruggeeft als je niet exit op de piek. Vooral bij biotech essentieel om verkoop-discipline te hebben.",
    example:
      "Peak +150% / T+90 +50% (biotech) = als je vasthoudt na de readout geef je gemiddeld 65% van de piek-winst terug door mean reversion.",
  },
  {
    term: "Exit window",
    short: "Tot welke dag je uiterlijk uit de positie wilt zijn.",
    long:
      "Catalyst datum + 30 dagen cushion. Daarna gaan andere factoren overheersen (kwartaalcijfers, sector tides, nieuwe nieuws cycli) en is het signaal 'verbruikt'. Ook al staat de positie nog groen — de edge die de score gaf is weg.",
  },
  {
    term: "Score (final_score)",
    short: "Samengestelde 0-1 score per ticker, hoger = meer conviction.",
    long:
      "Combinatie van structurele factoren (1/3), catalyst factoren (1/3) en timing factoren (1/3), met confluence bonus, risk penalty en cycle multiplier. Drempels: ≥0.75 = STRONG_BUY, ≥0.60 = BUY, ≥0.45 = WATCH, lager = HOLD/AVOID.",
  },
  {
    term: "Action (STRONG_BUY / BUY / WATCH / HOLD / AVOID)",
    short: "Aanbevolen actie afgeleid van de score + warnings.",
    long:
      "STRONG_BUY = score ≥0.75 én geen blokkerende warnings. BUY = score ≥0.60. WATCH = score ≥0.45 of geblokkeerd door risk warnings. HOLD = neutraal. AVOID = expliciete red flag (bv. ATM dilutie + cash runway <6m).",
  },
  {
    term: "Severity (rood / oranje / geel)",
    short: "Hoe hard een individueel signaal binnenkomt.",
    long:
      "Rood = kalibreert historisch op ≥+100% in 1d of ≥+250% in 1w (bv. bonanza grades, FDA approval, topline positive, definitive buyout). Oranje = belangrijk maar minder hard (lower bonanza tiers, financing, resource update). Geel = informatief / context.",
  },
  {
    term: "Data completeness",
    short: "Hoeveel van de pre-event velden voor deze ticker ingevuld zijn.",
    long:
      "Per ticker zijn er ~15-25 velden (cash runway, catalyst datum, modality, jurisdiction, etc.). Completeness = ingevuld / totaal. Lage completeness → score is gokken op missing data. In Track Record kun je filteren op min completeness om noise eruit te halen.",
  },
  {
    term: "Forward returns",
    short: "Werkelijke 7d/14d/30d/90d returns na het signaal.",
    long:
      "Worden achteraf gemeten en in Track Record vergeleken met de baselines. Pas na ~90 STRONG_BUY signalen over 6+ maanden bevatten deze cijfers signaal boven ruis (briefing §10) — daarvoor is sample size te klein.",
  },
];

import { Card, SectionHeader } from "../components/ui";

export function LegendaView() {
  return (
    <div className="space-y-6 max-w-3xl">
      <SectionHeader
        eyebrow="Naslag"
        title="Legenda"
        subtitle="Uitleg van termen in notificaties, scores en track record. Bedoeld als naslagwerk, niet als trading advies."
      />

      <div className="space-y-2">
        {TERMS.map((t) => (
          <Card key={t.term} className="overflow-hidden">
            <details className="group">
              <summary className="cursor-pointer p-4 hover:bg-ink-3/40 transition list-none flex items-start gap-3">
                <span className="text-fog-pink text-sm mt-0.5 group-open:rotate-90 transition-transform">
                  ▸
                </span>
                <div className="flex-1">
                  <div className="font-bold text-neutral-50">{t.term}</div>
                  <div className="text-xs text-neutral-400 mt-1">{t.short}</div>
                </div>
              </summary>
              <div className="px-4 pb-4 pl-11 space-y-3 text-sm text-neutral-300 border-t border-ink-5 bg-ink-1/40 pt-3">
                <p className="leading-relaxed">{t.long}</p>
                {t.example && (
                  <div className="text-xs rounded-lg bg-fog-pink/[0.06] border-l-2 border-fog-pink pl-3 py-2 pr-3 text-neutral-300">
                    <span className="text-fog-pink uppercase tracking-wider text-[10px] font-bold mr-2">
                      voorbeeld
                    </span>
                    {t.example}
                  </div>
                )}
              </div>
            </details>
          </Card>
        ))}
      </div>

      <p className="text-xs text-neutral-600 italic pt-4 border-t border-ink-5">
        Briefing §6 (scoring), §9 (caveats), §10 (validatie). Cijfers zijn
        historische medianen 2018‑2024 — gebruik als prior, niet als belofte.
      </p>
    </div>
  );
}
