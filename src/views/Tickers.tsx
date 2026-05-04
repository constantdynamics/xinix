import { useState } from "react";
import type { Dashboard } from "../types";
import { addTicker, removeTicker } from "../api";

export function TickersView({
  data,
  onRefresh,
}: {
  data: Dashboard;
  onRefresh: () => void;
}) {
  const [form, setForm] = useState({
    ticker: "",
    company: "",
    goud_score: "",
    goud_type: "",
    trigger_event: "",
    trigger_date: "",
    modality: "",
    disease_area: "",
    phase: "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    try {
      await addTicker({
        ticker: form.ticker.toUpperCase(),
        company: form.company,
        goud_score: form.goud_score ? Number(form.goud_score) : undefined,
        goud_type: form.goud_type || undefined,
        trigger_event: form.trigger_event || undefined,
        trigger_date: form.trigger_date || undefined,
        modality: form.modality || undefined,
        disease_area: form.disease_area || undefined,
        phase: form.phase || undefined,
      });
      setMsg(`${form.ticker.toUpperCase()} toegevoegd`);
      setForm({
        ticker: "",
        company: "",
        goud_score: "",
        goud_type: "",
        trigger_event: "",
        trigger_date: "",
        modality: "",
        disease_area: "",
        phase: "",
      });
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(ticker: string) {
    if (!confirm(`${ticker} verwijderen uit watchlist?`)) return;
    try {
      await removeTicker(ticker);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded p-4">
        <h2 className="text-lg font-semibold mb-3">Ticker toevoegen</h2>
        {error && <div className="mb-2 text-red-400 text-sm">{error}</div>}
        {msg && <div className="mb-2 text-emerald-400 text-sm">{msg}</div>}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <input
            placeholder="Ticker (bv VKTX)"
            value={form.ticker}
            onChange={(e) => setForm({ ...form, ticker: e.target.value })}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          />
          <input
            placeholder="Bedrijfsnaam (volledig)"
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm col-span-2"
          />
          <input
            placeholder="Goud-score (0-100)"
            type="number"
            value={form.goud_score}
            onChange={(e) => setForm({ ...form, goud_score: e.target.value })}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          />
          <select
            value={form.goud_type}
            onChange={(e) => setForm({ ...form, goud_type: e.target.value })}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          >
            <option value="">Goud-type...</option>
            <option value="single-event">single-event</option>
            <option value="multi-bagger">multi-bagger</option>
            <option value="phoenix">phoenix</option>
            <option value="mixed">mixed</option>
          </select>
          <select
            value={form.phase}
            onChange={(e) => setForm({ ...form, phase: e.target.value })}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          >
            <option value="">Fase...</option>
            <option>Pre</option>
            <option>Ph1</option>
            <option>Ph2</option>
            <option>Ph3</option>
            <option>Filed</option>
            <option>Comm</option>
          </select>
          <input
            placeholder="Modaliteit"
            value={form.modality}
            onChange={(e) => setForm({ ...form, modality: e.target.value })}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          />
          <input
            placeholder="Ziektegebied"
            value={form.disease_area}
            onChange={(e) => setForm({ ...form, disease_area: e.target.value })}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          />
          <input
            placeholder="Trigger event omschrijving"
            value={form.trigger_event}
            onChange={(e) => setForm({ ...form, trigger_event: e.target.value })}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm col-span-2"
          />
          <input
            placeholder="Trigger datum (YYYY-MM-DD)"
            value={form.trigger_date}
            onChange={(e) => setForm({ ...form, trigger_date: e.target.value })}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          />
        </div>
        <button
          onClick={add}
          className="mt-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-sm"
        >
          Toevoegen
        </button>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Huidige watchlist</h2>
        <div className="bg-slate-900 border border-slate-800 rounded">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="text-left p-2">Ticker</th>
                <th className="text-left p-2">Bedrijf</th>
                <th className="text-left p-2">Score</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Fase</th>
                <th className="text-left p-2">Modaliteit</th>
                <th className="text-left p-2">Trigger</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.cards.map((c) => (
                <tr key={c.ticker} className="border-t border-slate-800">
                  <td className="p-2 font-bold">{c.ticker}</td>
                  <td className="p-2 text-slate-300">{c.company}</td>
                  <td className="p-2">{c.goud_score}</td>
                  <td className="p-2 text-slate-400">{c.goud_type}</td>
                  <td className="p-2 text-slate-400">{c.phase}</td>
                  <td className="p-2 text-slate-400">{c.modality}</td>
                  <td className="p-2 text-slate-400 truncate max-w-xs">
                    {c.trigger_event}
                  </td>
                  <td className="p-2 text-right">
                    <button
                      onClick={() => remove(c.ticker)}
                      className="px-2 py-0.5 text-xs bg-red-700 hover:bg-red-600 rounded"
                    >
                      verwijder
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
