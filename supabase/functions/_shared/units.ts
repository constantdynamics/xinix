// Koerseenheden en splits in Yahoo-reeksen.
//
// Londen, Johannesburg en Tel Aviv noteren in een subeenheid (pence, cent,
// agorot). Yahoo levert dezelfde reeks de ene keer in die subeenheid en de
// andere keer in de hoofdmunt (pond, rand, sjekel), soms zelfs binnen één
// reeks. In de sim zag dat eruit als +9.900% of −99%. Wij bewaren deze koersen
// altijd in de subeenheid, zoals de beurs zelf en brokers als DEGIRO ze tonen.

const SUB_VAN_HOOFD: Record<string, string> = { GBP: "GBp", ZAR: "ZAc", ILS: "ILA" };
const SUBEENHEDEN = new Set(["GBp", "GBX", "ZAc", "ZAC", "ILA"]);
const SUFFIX_MET_SUBEENHEID = /\.(L|IL|JO|TA)$/i;

export interface KoersBar { date: string; close: number | null }

// Een sprong van ~100× (met marge voor een echte koersbeweging die dag) is een
// eenheidswissel, geen koers. Geeft de factor terug die hem ongedaan maakt.
function eenheidsSprong(r: number): number {
  if (r >= 40 && r <= 250) return 1 / 100;
  if (r <= 1 / 40 && r >= 1 / 250) return 100;
  return 1;
}

// Zet de reeks in-place in de subeenheid. `currency` komt uit Yahoo's meta,
// `ref` is de opgeslagen koers (null bij een nieuw aandeel). Geeft de munt
// terug waarin de reeks nu staat, of null als het aandeel geen subeenheid kent.
export function normaliseerEenheid(ticker: string, bars: KoersBar[], currency: string | null | undefined, ref: number | null): string | null {
  const heeftSub = currency ? (SUBEENHEDEN.has(currency) || currency in SUB_VAN_HOOFD) : SUFFIX_MET_SUBEENHEID.test(ticker);
  if (!heeftSub) return currency ?? null;

  // 1. Binnen de reeks: van achter naar voren, elke koers in de eenheid van de volgende.
  let volgende: number | null = null;
  for (let i = bars.length - 1; i >= 0; i--) {
    const c = bars[i].close;
    if (c == null || !(c > 0)) continue;
    if (volgende != null) {
      const f = eenheidsSprong(c / volgende);
      if (f !== 1) bars[i].close = c * f;
    }
    volgende = bars[i].close;
  }
  if (volgende == null) return currency ?? null;

  // 2. Hoofdmunt → subeenheid (pond → pence).
  const naarSub = currency && currency in SUB_VAN_HOOFD ? 100 : 1;
  const sub = currency ? (SUB_VAN_HOOFD[currency] ?? currency) : null;
  let schaal = naarSub;

  // 3. Vangnet: wijkt de hele reeks 100× af van wat we al hadden, dan liegt de
  // munt in de meta en houden we de opgeslagen eenheid aan.
  const laatste = [...bars].reverse().find((b) => b.close != null && b.close > 0)!.close! * schaal;
  if (ref != null && ref > 0) schaal *= eenheidsSprong(laatste / ref);

  if (schaal !== 1) for (const b of bars) if (b.close != null) b.close *= schaal;
  return sub;
}

export interface Split { date: string; numerator: number; denominator: number }

// Yahoo meldt een split soms al terwijl de oudere koersen nog niet zijn
// aangepast: dan staat er een sprong van precies de splitfactor in de reeks.
// Die koersen zetten we zelf om, anders weert de glitch-guard de nieuwe koers
// wekenlang (zo bleef BMGL na zijn 1:12 van 22 juni op een oude koers staan).
export function pasSplitsToe(bars: KoersBar[], splits: Split[]): void {
  for (const s of [...splits].sort((a, b) => a.date.localeCompare(b.date))) {
    const f = s.denominator / s.numerator;
    if (!(f > 0) || f === 1) continue;
    const i = bars.findIndex((b) => b.date >= s.date && b.close != null && b.close > 0);
    if (i <= 0) continue;
    let j = i - 1;
    while (j >= 0 && !(bars[j].close != null && bars[j].close! > 0)) j--;
    if (j < 0) continue;
    const sprong = bars[i].close! / bars[j].close!;
    if (Math.abs(Math.log(sprong / f)) < Math.abs(Math.log(sprong))) {
      for (let k = 0; k < i; k++) if (bars[k].close != null) bars[k].close! *= f;
    }
  }
}
