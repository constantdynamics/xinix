import { useEffect, useState } from "react";
import { DashboardView } from "./views/Dashboard";
import { SettingsView } from "./views/Settings";
import { TickersView } from "./views/Tickers";
import { BacktestView } from "./views/Backtest";
import { ScoresView } from "./views/Scores";
import { fetchDashboard, getToken, setToken } from "./api";
import type { Dashboard } from "./types";

type Tab = "dashboard" | "scores" | "settings" | "tickers" | "backtest";

export function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenInput, setTokenInput] = useState(getToken() ?? "");

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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Biotech Signal Detector
            </h1>
            <p className="text-xs text-slate-400">
              Pre- en post-event signalering met kleurcodes en alerts
            </p>
          </div>
          <nav className="flex gap-2">
            {(["dashboard", "scores", "tickers", "backtest", "settings"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-sm rounded-md border ${
                  tab === t
                    ? "bg-slate-100 text-slate-900 border-slate-100"
                    : "border-slate-700 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {t === "dashboard"
                  ? "Dashboard"
                  : t === "scores"
                  ? "Scores"
                  : t === "tickers"
                  ? "Watchlist"
                  : t === "backtest"
                  ? "Backtest"
                  : "Instellingen"}
              </button>
            ))}
          </nav>
        </div>
        <div className="mx-auto max-w-7xl px-4 pb-3 flex items-center gap-2 flex-wrap">
          <input
            type="password"
            placeholder="Admin token"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            className="px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-slate-100 w-48"
          />
          <button
            onClick={() => {
              setToken(tokenInput || null);
              refresh();
            }}
            className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded"
          >
            Token opslaan
          </button>
          <button
            onClick={refresh}
            className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded"
          >
            {loading ? "Laden..." : "Vernieuw"}
          </button>
          {data && (
            <span className="text-xs text-slate-500 ml-auto">
              Laatst bijgewerkt: {new Date(data.generated_at).toLocaleString("nl-NL")}
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {error && (
          <div className="mb-4 p-3 bg-red-900/40 border border-red-800 rounded text-sm">
            Fout: {error}
          </div>
        )}
        {tab === "dashboard" && data && (
          <DashboardView data={data} onRefresh={refresh} />
        )}
        {tab === "settings" && <SettingsView />}
        {tab === "tickers" && data && (
          <TickersView data={data} onRefresh={refresh} />
        )}
        {tab === "backtest" && <BacktestView />}
        {tab === "scores" && <ScoresView />}
      </main>
    </div>
  );
}
