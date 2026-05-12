// Tegel-customisatie — opgeslagen in localStorage zodat het per
// browser/device persisteert zonder extra backend calls.

// v4: defaults verschoven naar 1y + 5y meters (90d uit), heat is bg
// v3: showPhase default uit (heat zit in tegel achtergrond)
// v2: showRange90d default aan voor zichtbaarheid
const KEY = "xinix_tile_prefs_v4";

export interface TilePrefs {
  showSector: boolean;
  showPhase: boolean; // 'Hot/Warm/Pre/Rust' badge
  showScore: boolean;
  showDetailMeta: boolean; // commodity/jurisdiction of modality/disease/phase
  showPriceDelta: boolean; // 1d delta + last close
  showRange90d: boolean;
  showRange1y: boolean;
  showRange5y: boolean;
  showCatalyst: boolean;
  showTopSignal: boolean;
  showGoudType: boolean;
  showTriggerEvent: boolean;
  showActiveSignalCount: boolean;
  showMedals: boolean; // 🥇🥈🥉 medailleklassement (5y koers-runs)
}

export const DEFAULT_TILE_PREFS: TilePrefs = {
  showSector: true,
  showPhase: false, // heat zit in tegel-achtergrond
  showScore: true,
  showDetailMeta: true,
  showPriceDelta: true,
  showRange90d: false, // 90d hebben we voor signal_price_summary maar
  showRange1y: true, //   tonen we niet meer; 1y + 5y geeft beter beeld
  showRange5y: true,
  showCatalyst: true,
  showTopSignal: true,
  showGoudType: false,
  showTriggerEvent: false,
  showActiveSignalCount: true,
  showMedals: true,
};

export const TILE_PREF_LABELS: Record<keyof TilePrefs, string> = {
  showSector: "Sector badge (BIO/MIN)",
  showPhase: "Heat-label (Hot/Warm/Pre/Rust) — naast tegel-achtergrond",
  showScore: "Goud-score (rechtsboven)",
  showDetailMeta: "Detail meta (commodity/modaliteit)",
  showPriceDelta: "Prijs + 1d delta",
  showRange90d: "90d range bar",
  showRange1y: "1y range bar",
  showRange5y: "5y range bar",
  showCatalyst: "Komende catalyst block",
  showTopSignal: "Top signal block",
  showGoudType: "Goud-type label",
  showTriggerEvent: "Trigger event tekst",
  showActiveSignalCount: "Aantal actieve signalen",
  showMedals: "Medailles (🥇🥈🥉, 5y koers-runs)",
};

export function loadTilePrefs(): TilePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_TILE_PREFS;
    const parsed = JSON.parse(raw) as Partial<TilePrefs>;
    return { ...DEFAULT_TILE_PREFS, ...parsed };
  } catch {
    return DEFAULT_TILE_PREFS;
  }
}

export function saveTilePrefs(prefs: TilePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // localStorage vol of disabled — silently ignore
  }
}
