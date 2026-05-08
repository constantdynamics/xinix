// Tegel-customisatie — opgeslagen in localStorage zodat het per
// browser/device persisteert zonder extra backend calls.

const KEY = "xinix_tile_prefs_v1";

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
}

export const DEFAULT_TILE_PREFS: TilePrefs = {
  showSector: true,
  showPhase: true,
  showScore: true,
  showDetailMeta: true,
  showPriceDelta: true,
  showRange90d: false,
  showRange1y: true,
  showRange5y: true,
  showCatalyst: true,
  showTopSignal: true,
  showGoudType: false,
  showTriggerEvent: false,
  showActiveSignalCount: true,
};

export const TILE_PREF_LABELS: Record<keyof TilePrefs, string> = {
  showSector: "Sector badge (BIO/MIN)",
  showPhase: "Phase badge (Hot/Warm/Pre/Rust)",
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
