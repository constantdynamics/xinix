import { useEffect, useMemo, useState } from "react";
import { DashboardView } from "./views/Dashboard";
import { SettingsView } from "./views/Settings";
import { TickersView } from "./views/Tickers";
import { LimitsView } from "./views/Limits";
import { BacktestView } from "./views/Backtest";
import { ScoresView } from "./views/Scores";
import { TrackRecordView } from "./views/TrackRecord";
import { LegendaView } from "./views/Legenda";
import { fetchDashboard, getToken, setToken } from "./api";
import type { Dashboard } from "./types";
import { Button, Pill, Input } from "./components/ui";

type Tab =
  | "dashboard"
  | "scores"
  | "tickers"
  | "limits"
  | "backtest"
  | "track-record"
  | "legenda"
  | "settings";

interface TabDef {
  key: Tab;
  label: string;
  tone: "pink" | "lime" | "orange" | "cyan" | "neutral" | "watch" | "loss";
}

const TABS: TabDef[] = [
  { key: "dashboard", label: "Dashboard", tone: "pink" },
  { key: "scores", label: "Scores", tone: "lime" },
  { key: "tickers", label: "Watchlist", tone: "cyan" },
  { key: "limits", label: "Limieten", tone: "lime" },
  { key: "backtest", label: "Backtest", tone: "watch" },
  { key: "track-record", label: "Track record", tone: "orange" },
  { key: "legenda", label: "Legenda", tone: "neutral" },
  { key: "settings", label: "Instellingen", tone: "neutral" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenInput, setTokenInput] = useState(getToken() ?? "");
  const [showTokenBar, setShowTokenBar] = useState(false);

  async function refresh() {
    try {
      setLoading(true);
      const d = await fetchDashboard();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, []);

  // Counts per tab — kleine cijfers naast pill-label
  const counts = useMemo<Partial<Record<Tab, number>>>(() => {
    if (!data) return {};
    return {
      dashboard: data.cards?.length ?? 0,
      tickers: data.cards?.length ?? 0,
      scores: data.recent_signals?.length ?? 0,
    };
  }, [data]);

  return (
    <div className="min-h-screen bg-ink-1 text-neutral-100">
      {/* Top bar — minimaal, dichter bij defog */}
      <header className="sticky top-0 z-30 border-b border-ink-5 bg-ink-1/95 backdrop-blur supports-[backdrop-filter]:bg-ink-1/70">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-4">
          <a
            href="#dashboard"
            onClick={(e) => {
              e.preventDefault();
              setTab("dashboard");
            }}
            className="wordmark text-2xl leading-none select-none cursor-pointer hover:scale-[1.02] transition-transform"
            title="Naar dashboard"
          >
            Xinix
          </a>
          <div className="hidden sm:block text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">
            Biotech & Mining Signal Detector
          </div>
          <div className="ml-auto flex items-center gap-2">
            {data && (
              <span className="hidden md:inline text-[11px] text-neutral-500 tabular">
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
              variant="ghost"
              onClick={() => setShowTokenBar((s) => !s)}
              title="Admin token"
            >
              <span className="text-fog-pink">●</span>
              <span className="hidden sm:inline">token</span>
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

        {/* Pill nav — Defog-stijl filter-row */}
        <div className="mx-auto max-w-7xl px-4 pb-3 flex gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <Pill
              key={t.key}
              tone={t.tone}
              active={tab === t.key}
              count={counts[t.key]}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </Pill>
          ))}
        </div>

        {showTokenBar && (
          <div className="border-t border-ink-5 bg-ink-2/60">
            <div className="mx-auto max-w-7xl px-4 py-2 flex items-center gap-2 animate-fade-up">
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
                  refresh();
                  setShowTokenBar(false);
                }}
              >
                Opslaan
              </Button>
              <span className="text-[11px] text-neutral-500">
                Wordt lokaal in de browser bewaard.
              </span>
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
        {tab === "dashboard" && data && (
          <DashboardView data={data} onRefresh={refresh} />
        )}
        {tab === "settings" && <SettingsView data={data ?? undefined} />}
        {tab === "tickers" && data && (
          <TickersView data={data} onRefresh={refresh} />
        )}
        {tab === "limits" && data && (
          <LimitsView data={data} onRefresh={refresh} />
        )}
        {tab === "backtest" && <BacktestView />}
        {tab === "scores" && <ScoresView />}
        {tab === "track-record" && <TrackRecordView />}
        {tab === "legenda" && <LegendaView />}
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
