// useUiSettings: gedeelde store voor de UI-config (tab-aanpassingen +
// per-tab kolominstellingen). Eén GET per pagina-load; alle tabel-views
// delen dezelfde state zodat een kolomkeuze meteen overal doorwerkt.
// Volgt hetzelfde module-level-store-patroon als useMarks.
//
// Bij module-init lezen we eerst een localStorage-cache uit zodat het
// initiële render meteen de juiste tab-volgorde + kolommen heeft (geen
// flikker van de default-config naar de custom-config). Daarna wordt
// een verse versie van de server gehaald en de cache bijgewerkt.

import { useEffect, useState } from "react";
import { fetchUiSettings, saveUiSettings, type TabWidth, type TableColumnPref, type UiSettings } from "../api";

const CACHE_KEY = "xinix_ui_settings_cache_v1";

type Listener = () => void;

function readCache(): UiSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UiSettings;
  } catch {
    return null;
  }
}

function writeCache(s: UiSettings | null): void {
  if (typeof window === "undefined" || !s) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(s));
  } catch {
    // localStorage vol of geblokkeerd — laat stil falen.
  }
}

const cached = readCache();

const state = {
  loaded: cached != null,
  loading: false,
  settings: cached,
};
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

async function load(): Promise<void> {
  state.loading = true;
  try {
    state.settings = await fetchUiSettings();
    state.loaded = true;
    writeCache(state.settings);
  } catch {
    // Laat settings staan (uit cache of null) — consumers vallen terug
    // op hun defaults.
  } finally {
    state.loading = false;
    emit();
  }
}

function ensureLoaded(): void {
  // Ook al hebben we een cache, halen we één keer een verse versie op om
  // bij te blijven met wijzigingen die elders gemaakt zijn.
  if (state.loading) return;
  void load();
}

// Herlaad wanneer de UI-config elders wordt opgeslagen (bv. "Tabs aanpassen").
if (typeof window !== "undefined") {
  window.addEventListener("xinix-ui-settings-updated", () => { void load(); });
}

export function useUiSettings(): { settings: UiSettings | null; loaded: boolean } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    ensureLoaded();
    return () => { listeners.delete(l); };
  }, []);
  return { settings: state.settings, loaded: state.loaded };
}

// Zichtbare kolommen + hun gekozen fontkleur, in de gekozen volgorde.
export function useColumnColors(tabKey: string): Record<string, string> {
  const { settings } = useUiSettings();
  return settings?.table_columns?.[tabKey]?.colors ?? {};
}

// Bewaar de kolominstelling voor één tab. Overige tabs blijven ongemoeid.
// Vereist een admin-token (saveUiSettings geeft anders een 401).
export async function saveTableColumns(tabKey: string, pref: TableColumnPref): Promise<void> {
  const current = state.settings?.table_columns ?? {};
  const next: Record<string, TableColumnPref> = { ...current, [tabKey]: pref };
  const saved = await saveUiSettings({ table_columns: next });
  state.settings = saved;
  state.loaded = true;
  writeCache(state.settings);
  emit();
}

// Paginabreedte per tab. Default 'breed': ruimer dan de oude 1280px zodat er
// meer kolommen passen, maar niet zo breed dat lange tekstblokken onleesbaar
// worden. Per tab te overrulen via de breedte-schakelaar.
export const DEFAULT_TAB_WIDTH: TabWidth = "breed";

export const TAB_WIDTH_CLASS: Record<TabWidth, string> = {
  normaal: "max-w-7xl",
  breed: "max-w-[1800px]",
  vol: "max-w-none",
};

export function useTabWidth(tabKey: string): TabWidth {
  const { settings } = useUiSettings();
  const w = settings?.tab_width?.[tabKey];
  return w === "normaal" || w === "breed" || w === "vol" ? w : DEFAULT_TAB_WIDTH;
}

// Bewaar de breedte voor één tab; andere tabs blijven ongemoeid.
// Vereist een admin-token (saveUiSettings geeft anders een 401).
export async function saveTabWidth(tabKey: string, width: TabWidth): Promise<void> {
  const current = state.settings?.tab_width ?? {};
  const next: Record<string, TabWidth> = { ...current, [tabKey]: width };
  const saved = await saveUiSettings({ tab_width: next });
  state.settings = saved;
  state.loaded = true;
  writeCache(state.settings);
  emit();
}
