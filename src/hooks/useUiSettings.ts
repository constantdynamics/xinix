// useUiSettings: gedeelde store voor de UI-config (tab-aanpassingen +
// per-tab kolominstellingen). Eén GET per pagina-load; alle tabel-views
// delen dezelfde state zodat een kolomkeuze meteen overal doorwerkt.
// Volgt hetzelfde module-level-store-patroon als useMarks.

import { useEffect, useState } from "react";
import { fetchUiSettings, saveUiSettings, type TableColumnPref, type UiSettings } from "../api";

type Listener = () => void;

const state = {
  loaded: false,
  loading: false,
  settings: null as UiSettings | null,
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
  } catch {
    // Laat settings null — consumers vallen terug op hun defaults.
  } finally {
    state.loading = false;
    emit();
  }
}

function ensureLoaded(): void {
  if (state.loaded || state.loading) return;
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

// Bewaar de kolominstelling voor één tab. Overige tabs blijven ongemoeid.
// Vereist een admin-token (saveUiSettings geeft anders een 401).
export async function saveTableColumns(tabKey: string, pref: TableColumnPref): Promise<void> {
  const current = state.settings?.table_columns ?? {};
  const next: Record<string, TableColumnPref> = { ...current, [tabKey]: pref };
  const saved = await saveUiSettings({ table_columns: next });
  state.settings = saved;
  state.loaded = true;
  emit();
}
