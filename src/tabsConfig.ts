// Centrale definitie van alle tabbladen. Gebruikt door App.tsx (render) én
// Settings.tsx (TabsCustomizerCard) zodat we één bron van waarheid hebben.

export type Tab =
  | "dashboard"
  | "scores"
  | "tickers"
  | "limits"
  | "backtest"
  | "track-record"
  | "signal-log"
  | "scans"
  | "xinix"
  | "feniks"
  | "hikkertjes"
  | "zwitserleven"
  | "status"
  | "settings";

export interface TabDef {
  key: Tab;
  label: string;
}

export const DEFAULT_TABS: TabDef[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "scores", label: "Scores" },
  { key: "tickers", label: "Watchlist" },
  { key: "limits", label: "Limieten" },
  { key: "backtest", label: "Backtest" },
  { key: "track-record", label: "Track record" },
  { key: "signal-log", label: "Signaallog" },
  { key: "scans", label: "Scans" },
  { key: "xinix", label: "Xinix" },
  { key: "feniks", label: "🦅 Feniks" },
  { key: "hikkertjes", label: "⚡ Hikkertjes" },
  { key: "zwitserleven", label: "🌴 Zwitserleven" },
  { key: "status", label: "Status" },
  { key: "settings", label: "Instellingen" },
];
