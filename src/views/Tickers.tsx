import { useMemo, useState } from "react";
import type { Dashboard, Sector } from "../types";
import { addTicker, batchAddTickers, removeTicker, type TickerInput } from "../api";

interface Form {
  ticker: string;
  company: string;
  sector: Sector;
  goud_score: string;
  goud_type: string;
  trigger_event: string;
  trigger_date: string;
  modality: string;
  disease_area: string;
  phase: string;
  commodity: string;
  jurisdiction: string;
  deposit_type: string;
}

const EMPTY: Form = {
  ticker: "",
  company: "",
  sector: "biotech",
  goud_score: "",
  goud_type: "",
  trigger_event: "",
  trigger_date: "",
  modality: "",
  disease_area: "",
  phase: "",
  commodity: "",
  jurisdiction: "",
  deposit_type: "",
};

function parseBatch(
  text: string,
  defaultSector: Sector
): { rows: TickerInput[]; errors: string[] } {
  const errors: string[] = [];
  const rows: TickerInput[] = [];
  const lines = text.split(/\r?\n/);
  // Optional header detection
  let headerCols: string[] | null = null;
  let startIdx = 0;
  if (lines.length > 0) {
    const first = lines[0].toLowerCase();
    if (first.includes("ticker") && (first.includes(",") || first.includes("\t"))) {
      headerCols = first.split(/[,\t]/).map((s) => s.trim());
      startIdx = 1;
    }
  }
  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith("#")) continue;
    const parts = raw.split(/[,\t]/).map((s) => s.trim());
    let row: TickerInput;
    if (headerCols) {
      const obj: Record<string, string> = {};
      headerCols.forEach((h, j) => {
        if (parts[j]) obj[h] = parts[j];
      });
      if (!obj.ticker) {
        errors.push(`regel ${i + 1}: ticker ontbreekt`);
        continue;
      }
      row = {
        ticker: obj.ticker.toUpperCase(),
        company: obj.company || obj.name || obj.ticker,
        sector: (obj.sector as Sector) || defaultSector,
        goud_score: obj.goud_score ? Number(obj.goud_score) : undefined,
        goud_type: obj.goud_type || undefined,
        commodity: obj.commodity || undefined,
        jurisdiction: obj.jurisdiction || undefined,
        deposit_type: obj.deposit_type || undefined,
        modality: obj.modality || undefined,
        disease_area: obj.disease_area || undefined,
        phase: obj.phase || undefined,
        trigger_event: obj.trigger_event || undefined,
        trigger_date: obj.trigger_date || undefined,
      };
    } else {
      // Positional: TICKER[,COMPANY[,SECTOR[,EXTRA1[,EXTRA2]]]]
      const [ticker, company, sector, extra1, extra2] = parts;
      if (!ticker) {
        errors.push(`regel ${i + 1}: leeg`);
        continue;
      }
      const sec: Sector = sector === "mining" ? "mining" : sector === "biotech" ? "biotech" : defaultSector;
      row = {
        ticker: ticker.toUpperCase(),
        company: company || ticker.toUpperCase(),
        sector: sec,
      };
      if (sec === "mining") {
        row.commodity = extra1 || undefined;
        row.jurisdiction = extra2 || undefined;
      } else {
        row.disease_area = extra1 || undefined;
        row.phase = extra2 || undefined;
      }
    }
    rows.push(row);
  }
  return { rows, errors };
}

export function TickersView({
  data,
  onRefresh,
}: {
  data: Dashboard;
  onRefresh: () => void;
}) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchText, setBatchText] = useState("");
  const [batchSector, setBatchSector] = useState<Sector>("biotech");
  const [batchBusy, setBatchBusy] = useState(false);

  const preview = useMemo(
    () => parseBatch(batchText, batchSector),
    [batchText, batchSector]
  );

  async function add() {
    setError(null);
    setMsg(null);
    try {
      const payload: TickerInput = {
        ticker: form.ticker.toUpperCase(),
        company: form.company,
        sector: form.sector,
        goud_score: form.goud_score ? Number(form.goud_score) : undefined,
        goud_type: form.goud_type || undefined,
        trigger_event: form.trigger_event || undefined,
        trigger_date: form.trigger_date || undefined,
      };
      if (form.sector === "biotech") {
        payload.modality = form.modality || undefined;
        payload.disease_area = form.disease_area || undefined;
        payload.phase = form.phase || undefined;
      } else {
        payload.commodity = form.commodity || undefined;
        payload.jurisdiction = form.jurisdiction || undefined;
        payload.deposit_type = form.deposit_type || undefined;
      }
      await addTicker(payload);
      setMsg(`${payload.ticker} toegevoegd`);
      setForm({ ...EMPTY, sector: form.sector });
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function importBatch() {
    setError(null);
    setMsg(null);
    if (preview.rows.length === 0) {
      setError("Geen geldige rijen gevonden");
      return;
    }
    setBatchBusy(true);
    try {
      const res = await batchAddTickers(preview.rows);
      setMsg(`${res.inserted} ticker(s) toegevoegd / bijgewerkt`);
      setBatchText("");
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchBusy(false);
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

  const isMining = form.sector === "mining";

  return (
    <div className="space-y-6">
      {error && <div className="text-red-400 text-sm">{error}</div>}
      {msg && <div className="text-emerald-400 text-sm">{msg}</div>}

      {/* Batch import */}
      <div className="bg-slate-900 border border-slate-800 rounded p-4">
        <h2 className="text-lg font-semibold mb-2">Batch‑import</h2>
        <p className="text-xs text-slate-400 mb-2">
          Plak één ticker per regel. Eenvoudig: <code>TICKER,Bedrijfsnaam</code>{" "}
          of met defaults via sectorkeuze. Voor meer kolommen begin met header,
          bijv.: <code>ticker,company,sector,commodity,jurisdiction</code>.
        </p>
        <div className="flex gap-2 mb-2 items-center">
          <label className="text-xs text-slate-400">Default sector</label>
          <select
            value={batchSector}
            onChange={(e) => setBatchSector(e.target.value as Sector)}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          >
            <option value="biotech">biotech</option>
            <option value="mining">mining</option>
          </select>
          <span className="text-xs text-slate-500">
            {preview.rows.length} rij(en) klaar
            {preview.errors.length > 0 &&
              `, ${preview.errors.length} fout(en)`}
          </span>
        </div>
        <textarea
          value={batchText}
          onChange={(e) => setBatchText(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={
            batchSector === "mining"
              ? "FILO,Filo Mining,mining,Cu,Argentina\nNFG,New Found Gold,mining,Au,Canada\n…"
              : "VKTX,Viking Therapeutics\nSAVA,Cassava Sciences\n…"
          }
          className="w-full font-mono text-xs bg-slate-950 border border-slate-700 rounded p-2"
        />
        {preview.errors.length > 0 && (
          <ul className="mt-1 text-xs text-amber-400 list-disc list-inside">
            {preview.errors.slice(0, 5).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {preview.errors.length > 5 && <li>… en meer</li>}
          </ul>
        )}
        {preview.rows.length > 0 && (
          <div className="mt-2 max-h-40 overflow-auto bg-slate-950 border border-slate-800 rounded">
            <table className="w-full text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="text-left p-1">Ticker</th>
                  <th className="text-left p-1">Bedrijf</th>
                  <th className="text-left p-1">Sector</th>
                  <th className="text-left p-1">Extra</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 50).map((r) => (
                  <tr key={r.ticker} className="border-t border-slate-800">
                    <td className="p-1 font-mono">{r.ticker}</td>
                    <td className="p-1 text-slate-300">{r.company}</td>
                    <td className="p-1 text-slate-400">{r.sector}</td>
                    <td className="p-1 text-slate-500">
                      {r.sector === "mining"
                        ? [r.commodity, r.jurisdiction].filter(Boolean).join(" / ")
                        : [r.disease_area, r.phase].filter(Boolean).join(" / ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button
          onClick={importBatch}
          disabled={batchBusy || preview.rows.length === 0}
          className="mt-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded text-white text-sm"
        >
          {batchBusy ? "Bezig..." : `Importeer ${preview.rows.length} rij(en)`}
        </button>
      </div>

      {/* Single add */}
      <div className="bg-slate-900 border border-slate-800 rounded p-4">
        <h2 className="text-lg font-semibold mb-3">Eén ticker toevoegen</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <select
            value={form.sector}
            onChange={(e) => setForm({ ...form, sector: e.target.value as Sector })}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          >
            <option value="biotech">biotech</option>
            <option value="mining">mining</option>
          </select>
          <input
            placeholder="Ticker"
            value={form.ticker}
            onChange={(e) => setForm({ ...form, ticker: e.target.value })}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          />
          <input
            placeholder="Bedrijfsnaam"
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
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
          {!isMining && (
            <>
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
            </>
          )}
          {isMining && (
            <>
              <input
                placeholder="Commodity (Au/Ag/Cu/Li/U/...)"
                value={form.commodity}
                onChange={(e) => setForm({ ...form, commodity: e.target.value })}
                className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
              />
              <input
                placeholder="Jurisdictie (Canada/Argentina/...)"
                value={form.jurisdiction}
                onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })}
                className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
              />
              <input
                placeholder="Deposit type (epithermal/...)"
                value={form.deposit_type}
                onChange={(e) =>
                  setForm({ ...form, deposit_type: e.target.value })
                }
                className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
              />
            </>
          )}
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
                <th className="text-left p-2">Sector</th>
                <th className="text-left p-2">Ticker</th>
                <th className="text-left p-2">Bedrijf</th>
                <th className="text-left p-2">Score</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Detail</th>
                <th className="text-left p-2">Trigger</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.cards.map((c) => (
                <tr key={c.ticker} className="border-t border-slate-800">
                  <td className="p-2 text-slate-400 text-xs uppercase">
                    {c.sector}
                  </td>
                  <td className="p-2 font-bold">{c.ticker}</td>
                  <td className="p-2 text-slate-300">{c.company}</td>
                  <td className="p-2">{c.goud_score}</td>
                  <td className="p-2 text-slate-400">{c.goud_type}</td>
                  <td className="p-2 text-slate-400">
                    {c.sector === "mining"
                      ? [c.commodity, c.jurisdiction, c.deposit_type]
                          .filter(Boolean)
                          .join(" / ")
                      : [c.phase, c.modality, c.disease_area]
                          .filter(Boolean)
                          .join(" / ")}
                  </td>
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
