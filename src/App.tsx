import React, { useEffect, useMemo, useState } from "react";
import { DashboardView } from "./views/Dashboard";
import { SettingsView } from "./views/Settings";
import { TickersView } from "./views/Tickers";
import { LimitsView } from "./views/Limits";
import { BacktestView } from "./views/Backtest";
import { ScoresView } from "./views/Scores";
import { TrackRecordView } from "./views/TrackRecord";
import { SignalLogView } from "./views/SignalLog";
import { ScansView } from "./views/Scans";
import { XinixPortfolioView, PhoenixView } from "./views/XinixPortfolio";
import { PoefiesView } from "./views/Poefies";
import { HikkertjesView } from "./views/Hikkertjes";
import { ZwitserlevenView } from "./views/Zwitserleven";
import { FavorietenView } from "./views/Favorieten";
import { HealthView } from "./views/Health";
import { HelpPanel, scrollToPageHelp } from "./views/HelpPanel";
import { fetchDashboard, fetchUiSettings, fetchScanResults, fetchZwitserlevenResults, getToken, setToken, type UiSettings, type ScanResults, type ZwitserlevenResults } from "./api";
import type { Dashboard } from "./types";
import { Button, NavTab, Input, Skeleton, Dot } from "./components/ui";
import { DeviceSync } from "./components/DeviceSync";
import { DEFAULT_TABS as TABS, type Tab, type TabDef } from "./tabsConfig";
import { useMarks } from "./hooks/useMarks";
import { TAB_ICONS } from "./tabIcons";

// Tab -> pageId voor HelpPanel (uitleg onderaan elk tabblad).
const HELP_PAGE: Record<Tab, string> = {
  dashboard: "dashboard",
  scores: "scores",
  tickers: "watchlist",
  limits: "limits",
  backtest: "backtest",
  "track-record": "trackrecord",
  "signal-log": "signaallog",
  scans: "scans",
  xinix: "xinix",
  feniks: "feniks",
  poefies: "poefies",
  hikkertjes: "hikkertjes",
  zwitserleven: "zwitserleven",
  favorieten: "favorieten",
  status: "status",
  settings: "settings",
};

// Positie-gebaseerde tabkleur — gradient neon-cyber variant 12:
// #ff00aa → #cc00ff → #00ccff, gespreid over alle zichtbare tabs.
function tabColor(i: number, n: number): string {
  const t = n <= 1 ? 0 : i / (n - 1);
  if (t <= 0.5) {
    const s = t * 2;
    return `rgb(${Math.round(255 + s * (204 - 255))},0,${Math.round(170 + s * (255 - 170))})`;
  } else {
    const s = (t - 0.5) * 2;
    return `rgb(${Math.round(204 - s * 204)},${Math.round(s * 204)},255)`;
  }
}

// Tab onthouden tussen sessies — bij refresh blijf je op dezelfde tab.
const TAB_KEY = "xinix_active_tab_v1";
function loadInitialTab(): Tab {
  try {
    const saved = sessionStorage.getItem(TAB_KEY);
    // settings/status staan niet meer in de tabbalk maar zijn nog wel geldige
    // routes (bereikbaar via de bovenbalk) — dus expliciet toelaten.
    if (saved && (TABS.some((t) => t.key === saved) || saved === "settings" || saved === "status")) {
      return saved as Tab;
    }
  } catch { /* SSR/restricted */ }
  return "favorieten";
}

export function App() {
  const [tab, setTabRaw] = useState<Tab>(loadInitialTab);
  const setTab = (t: Tab) => {
    setTabRaw(t);
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* ignore */ }
  };
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenInput, setTokenInput] = useState(getToken() ?? "");
  const [showTokenBar, setShowTokenBar] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [uiSettings, setUiSettings] = useState<UiSettings | null>(null);
  const [scans, setScans] = useState<ScanResults | null>(null);
  const [zwit, setZwit] = useState<ZwitserlevenResults | null>(null);
  const marks = useMarks();

  // UI-settings 1× laden + opnieuw na save (via custom event).
  useEffect(() => {
    const load = () => fetchUiSettings().then(setUiSettings).catch(() => { /* fallback naar defaults */ });
    load();
    const onUpdate = () => load();
    window.addEventListener("xinix-ui-settings-updated", onUpdate);
    return () => window.removeEventListener("xinix-ui-settings-updated", onUpdate);
  }, []);

  // Pas UI-overrides toe op TABS: volgorde, hernoemd, verborgen.
  const effectiveTabs = useMemo<TabDef[]>(() => {
    let list = [...TABS];
    if (uiSettings?.tab_order && uiSettings.tab_order.length > 0) {
      const order = uiSettings.tab_order.filter((k) => TABS.some((t) => t.key === k));
      const ordered = order.map((k) => TABS.find((t) => t.key === k)!).filter(Boolean);
      const missing = TABS.filter((t) => !order.includes(t.key));
      list = [...ordered, ...missing];
    }
    const labels = uiSettings?.tab_labels ?? {};
    list = list.map((t) => labels[t.key] ? { ...t, label: labels[t.key] } : t);
    // Verborgen tabs verdwijnen volledig uit de balk — beheren doe je in Instellingen.
    const hidden = new Set(uiSettings?.tab_hidden ?? []);
    if (hidden.size > 0) {
      list = list.filter((t) => !hidden.has(t.key));
    }
    return list;
  }, [uiSettings]);

  async function refresh() {
    try {
      setLoading(true);
      const d = await fetchDashboard();
      setData(d);
      setError(null);
      setLastFetchAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Eenmalig laden bij openen. Geen auto-verversing meer (bespaart egress) —
  // gebruik de "vernieuw"-knop in de kop om handmatig bij te werken.
  useEffect(() => {
    refresh();
  }, []);

  // Scan-resultaten + zwitserleven los laden — alleen voor de tab-tellers
  // (aantal vondsten dat nog niet als 'gezien' is gemarkeerd).
  useEffect(() => {
    fetchScanResults().then(setScans).catch(() => { /* teller blijft leeg */ });
    fetchZwitserlevenResults().then(setZwit).catch(() => { /* teller blijft leeg */ });
  }, []);

  // Counts per tab — kleine cijfers naast tab-label
  const counts = useMemo<Partial<Record<Tab, number>>>(() => {
    const out: Partial<Record<Tab, number>> = {};
    if (data) {
      // Hot or Not-teller: alleen Hot-aandelen (rode tegel) die nog niet in
      // de favorieten staan — een bruikbaar getal in plaats van "999+".
      out.dashboard = (data.cards ?? []).filter(
        (c) => c.color === "red" && !marks.favorites.has(c.ticker.toUpperCase()),
      ).length;
      out.tickers = data.cards?.length ?? 0;
      out.scores = data.recent_signals?.length ?? 0;
    }
    // Scan-tabbladen: aantal vondsten dat nog niet als 'gezien' is gemarkeerd.
    const notSeen = (tickers: string[]) => tickers.filter((t) => !marks.isSeen(t)).length;
    if (scans) {
      out.feniks = notSeen((scans.phoenix_ranking ?? []).map((r) => r.ticker));
      out.poefies = notSeen((scans.poefie_ranking ?? []).map((r) => r.ticker));
      out.hikkertjes = notSeen((scans.hikkertje_ranking ?? []).map((r) => r.ticker));
    }
    if (zwit) {
      out.zwitserleven = notSeen(
        (zwit.stocks ?? []).filter((s) => s.meets_criteria || s.is_manual).map((s) => s.ticker),
      );
    }
    return out;
  }, [data, scans, zwit, marks.favorites, marks.favorites.size, marks.seen, marks.seen.size, marks.loaded]);

  // Urgentie-indicatoren — rode dot per tab waar iets vraagt om aandacht.
  const urgent = useMemo<Partial<Record<Tab, boolean>>>(() => {
    if (!data) return {};
    const failedJobs = new Set(
      (data.run_log ?? []).filter((r) => r.ok === false).slice(0, 30).map((r) => r.job)
    );
    return {
      status: failedJobs.size > 0,
    };
  }, [data]);

  // Verse data: laat een groene dot pulseren ~3s nadat een refresh klaar is.
  const [freshPulse, setFreshPulse] = useState(false);
  useEffect(() => {
    if (lastFetchAt == null) return;
    setFreshPulse(true);
    const id = setTimeout(() => setFreshPulse(false), 3000);
    return () => clearTimeout(id);
  }, [lastFetchAt]);

  return (
    <div className="min-h-screen bg-ink-1 text-neutral-100">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-ink-5 bg-ink-1/95 backdrop-blur supports-[backdrop-filter]:bg-ink-1/70">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-4">
          <a
            href="#favorieten"
            onClick={(e) => {
              e.preventDefault();
              setTab("favorieten");
            }}
            className="wordmark text-2xl leading-none select-none cursor-pointer hover:scale-[1.02] transition-transform"
            title="Naar favorieten"
          >
            Xinix
          </a>
<div className="ml-auto flex items-center gap-2">
            {data && (
              <span
                className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-neutral-500 tabular"
                title="Tijd van laatste backend-snapshot"
              >
                <Dot tone={freshPulse ? "lime" : "neutral"} pulse={freshPulse} />
                {new Date(data.generated_at).toLocaleString("nl-NL", {
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "2-digit",
                  month: "2-digit",
                })}
              </span>
            )}
            <Button
              size="sm"
              variant={tab === "settings" ? "secondary" : "ghost"}
              onClick={() => setTab("settings")}
              title="Instellingen"
            >
              ⚙<span className="hidden sm:inline">instellingen</span>
            </Button>
            <Button
              size="sm"
              variant={tab === "status" ? "secondary" : "ghost"}
              onClick={() => setTab("status")}
              title="Status van de achtergrondjobs"
            >
              <Dot tone={urgent.status ? "loss" : "neutral"} />
              <span className="hidden sm:inline">status</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowTokenBar((s) => !s)}
              title="Admin token"
            >
              <span className="text-fog-pink">●</span>
              <span className="hidden sm:inline">token</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={scrollToPageHelp}
              title="Spring naar de uitleg onderaan deze pagina"
            >
              ↓<span className="hidden sm:inline">uitleg</span>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={refresh}
              disabled={loading}
              title="Vernieuw"
            >
              {loading ? "…" : "↻"}
              <span className="hidden sm:inline">vernieuw</span>
            </Button>
          </div>
        </div>

        {/* Tab nav — onderlijn-stijl, horizontaal scrollbaar op mobiel */}
        <div className="mx-auto max-w-7xl px-4 flex gap-0.5 overflow-x-auto scrollbar-thin items-center">
          {effectiveTabs.map((t, idx) => (
            <NavTab
              key={t.key}
              active={tab === t.key}
              count={counts[t.key]}
              urgent={urgent[t.key]}
              onClick={() => setTab(t.key)}
              color={tabColor(idx, effectiveTabs.length)}
              icon={TAB_ICONS[t.key]}
            >
              {t.label}
            </NavTab>
          ))}
        </div>

        {showTokenBar && (
          <div className="border-t border-ink-5 bg-ink-2/60">
            <div className="mx-auto max-w-7xl px-4 py-2 flex flex-col gap-2 animate-fade-up">
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  type="password"
                  placeholder="Admin token"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="w-56"
                />
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setToken(tokenInput || null);
                    // Volledige reload — anders laadt useMarks de favorieten
                    // niet (ensureLoaded draait alleen bij mount en stopt
                    // vroegtijdig zolang er geen token is).
                    window.location.reload();
                  }}
                >
                  Opslaan
                </Button>
                <span className="text-[11px] text-neutral-500">
                  Wordt lokaal in de browser bewaard.
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap border-t border-ink-5/60 pt-2">
                <DeviceSync />
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {error && (
          <div className="mb-4 rounded-xl border border-fog-loss/40 bg-fog-loss/10 p-3 text-sm text-fog-loss">
            <span className="font-semibold">Fout:</span> {error}
          </div>
        )}
        {/* Initial loading skeleton — alleen tonen als er nog geen data is */}
        {loading && !data && !error && <DashboardSkeleton />}

        {tab === "dashboard" && data && (
          <DashboardView data={data} onRefresh={refresh} onNavigate={setTab} />
        )}
        {tab === "settings" && <SettingsView data={data ?? undefined} />}
        {tab === "tickers" && data && (
          <TickersView data={data} onRefresh={refresh} />
        )}
        {tab === "limits" && data && (
          <LimitsView data={data} onRefresh={refresh} />
        )}
        {tab === "backtest" && <BacktestView />}
        {tab === "scores" && <ScoresView exchangeByTicker={data ? new Map(data.cards.map((c) => [c.ticker, c.exchange ?? null])) : undefined} />}
        {tab === "track-record" && <TrackRecordView />}
        {tab === "signal-log" && <SignalLogView />}
        {tab === "scans" && <ScansView />}
        {tab === "xinix" && <XinixPortfolioView />}
        {tab === "feniks" && <PhoenixView />}
        {tab === "poefies" && <PoefiesView />}
        {tab === "hikkertjes" && <HikkertjesView />}
        {tab === "zwitserleven" && <ZwitserlevenView />}
        {tab === "favorieten" && <FavorietenView />}
        {tab === "status" && <HealthView />}
        <HelpPanel pageId={HELP_PAGE[tab]} />
      </main>

      <footer className="border-t border-ink-5 mt-8">
        <div className="mx-auto max-w-7xl px-4 py-4 text-[11px] text-neutral-400 flex items-center justify-between">
          <span>
            <span className="wordmark">Xinix</span> — pre/post-event detection
          </span>
          <span className="tabular">v2 · {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" rounded="xl" />
        ))}
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20" rounded="full" />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-64" rounded="xl" />
        ))}
      </div>
    </div>
  );
}
