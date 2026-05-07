import { useEffect, useMemo, useRef, useState } from "react";
import type { Card, Dashboard, Sector } from "../types";
import {
  addTicker,
  batchAddTickers,
  lookupTickers,
  removeTicker,
  type TickerInput,
} from "../api";
import { TickerDetailsModal } from "./TickerDetailsModal";
import { googleFinanceUrl } from "../tickerLinks";

// Bekende exchange-suffixen — bij bulk "wijzig suffix" worden deze als
// vervangbaar herkend, anderen (bv. BRK.B share class) blijven staan.
const EXCHANGE_SUFFIXES = [
  { value: "", label: "Geen (US)" },
  { value: "V", label: ".V (TSXV)" },
  { value: "TO", label: ".TO (TSX)" },
  { value: "CN", label: ".CN (CNSX)" },
  { value: "AX", label: ".AX (ASX)" },
  { value: "L", label: ".L (LSE)" },
  { value: "HK", label: ".HK (HKG)" },
  { value: "T", label: ".T (TYO)" },
  { value: "DE", label: ".DE (XETRA)" },
  { value: "PA", label: ".PA (Paris)" },
  { value: "AS", label: ".AS (AMS)" },
  { value: "MI", label: ".MI (Milan)" },
  { value: "ST", label: ".ST (Stockholm)" },
];

const KNOWN_SUFFIX_SET = new Set(
  EXCHANGE_SUFFIXES.map((x) => x.value).filter(Boolean)
);

function applySuffix(ticker: string, suffix: string): string {
  const t = ticker.toUpperCase();
  const dot = t.lastIndexOf(".");
  let base = t;
  if (dot !== -1) {
    const existing = t.slice(dot + 1);
    if (KNOWN_SUFFIX_SET.has(existing)) base = t.slice(0, dot);
  }
  return suffix ? `${base}.${suffix}` : base;
}

interface PreviewRow {
  id: number;
  ticker: string;
  company: string;
  sector: Sector;
  selected: boolean;
  status: "pending" | "checking" | "recognized" | "unknown";
  exchange: string | null;
}

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

// Quick-add format: "OPHR.V; MEK.V; XYZ" — semicolon or whitespace separated.
// Suffix .V/.TO/.AX/.L is preserved verbatim (Yahoo-compatible).
function parseQuickAdd(
  text: string,
  defaultSector: Sector
): { rows: TickerInput[]; errors: string[] } {
  const errors: string[] = [];
  const rows: TickerInput[] = [];
  const seen = new Set<string>();
  const tokens = text
    .split(/[;,\n\r\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const t of tokens) {
    if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(t)) {
      errors.push(`'${t}' is geen geldig ticker‑formaat`);
      continue;
    }
    const ticker = t.toUpperCase();
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    rows.push({
      ticker,
      company: ticker,
      sector: defaultSector,
    });
  }
  return { rows, errors };
}

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
  const [batchMode, setBatchMode] = useState<"quick" | "table">("quick");
  const [editing, setEditing] = useState<Card | null>(null);

  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [bulkSuffix, setBulkSuffix] = useState<string>("");
  const [bulkSector, setBulkSector] = useState<Sector>("biotech");
  const nextIdRef = useRef(1);
  const extrasRef = useRef<Map<string, Partial<TickerInput>>>(new Map());

  // Re-parse text → reconcile met bestaande rijen. Behoudt company/status
  // van rijen die nog steeds in de tekst staan, zodat een lookup niet
  // herhaald hoeft te worden bij elke toetsaanslag.
  useEffect(() => {
    const parsed =
      batchMode === "quick"
        ? parseQuickAdd(batchText, batchSector)
        : parseBatch(batchText, batchSector);
    setParseErrors(parsed.errors);

    setRows((prev) => {
      const prevByTicker = new Map(prev.map((r) => [r.ticker, r]));
      const next: PreviewRow[] = [];
      for (const p of parsed.rows) {
        const existing = prevByTicker.get(p.ticker);
        // bewaar extras (commodity, jurisdiction, modality, etc) voor import
        const extras: Partial<TickerInput> = { ...p };
        delete (extras as { ticker?: string }).ticker;
        delete (extras as { company?: string }).company;
        delete (extras as { sector?: string }).sector;
        extrasRef.current.set(p.ticker, extras);
        if (existing) {
          // Behoud bestaande sector — anders worden per-rij of bulk
          // sector-edits weggeflashed zodra je een teken in de textarea
          // typt. Voor sector-wijzigingen op bestaande rijen: gebruik
          // per-rij select of bulk toolbar.
          next.push(existing);
        } else {
          next.push({
            id: nextIdRef.current++,
            ticker: p.ticker,
            company: p.company || p.ticker,
            sector: p.sector ?? batchSector,
            selected: false,
            status: "pending",
            exchange: null,
          });
        }
      }
      return next;
    });
  }, [batchText, batchSector, batchMode]);

  // Debounced lookup voor alle rijen in "pending" — pas na 600ms stilte
  // om Yahoo niet bij elke toetsaanslag te raken.
  useEffect(() => {
    const pending = rows.filter((r) => r.status === "pending").map((r) => r.ticker);
    if (pending.length === 0) return;
    const timer = setTimeout(async () => {
      // mark als "checking" voor visuele feedback
      setRows((prev) =>
        prev.map((r) =>
          pending.includes(r.ticker) ? { ...r, status: "checking" } : r
        )
      );
      try {
        const results = await lookupTickers(pending);
        const map = new Map(results.map((r) => [r.ticker, r]));
        setRows((prev) =>
          prev.map((r) => {
            const res = map.get(r.ticker);
            if (!res) return r;
            if (res.recognized) {
              return {
                ...r,
                status: "recognized",
                company: res.company ?? r.company,
                exchange: res.exchange ?? null,
              };
            }
            return { ...r, status: "unknown", exchange: null };
          })
        );
      } catch (e) {
        // Auth fout / netwerk — terug naar pending zodat retry mogelijk is
        setRows((prev) =>
          prev.map((r) =>
            pending.includes(r.ticker) ? { ...r, status: "pending" } : r
          )
        );
        setError(
          `Lookup mislukt: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [rows]);

  function toggleRow(id: number) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r))
    );
  }

  function toggleAll() {
    const anySelected = rows.some((r) => r.selected);
    setRows((prev) => prev.map((r) => ({ ...r, selected: !anySelected })));
  }

  function setRowTicker(id: number, newTicker: string) {
    const t = newTicker.trim().toUpperCase();
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              ticker: t,
              status: "pending",
              company: t,
              exchange: null,
            }
          : r
      )
    );
  }

  function setRowSector(id: number, sec: Sector) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, sector: sec } : r))
    );
  }

  function removeRow(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function applyBulkSuffix() {
    setRows((prev) =>
      prev.map((r) => {
        if (!r.selected) return r;
        const newTicker = applySuffix(r.ticker, bulkSuffix);
        if (newTicker === r.ticker) return r;
        return {
          ...r,
          ticker: newTicker,
          status: "pending",
          company: newTicker,
          exchange: null,
        };
      })
    );
  }

  function applyBulkSector() {
    setRows((prev) =>
      prev.map((r) => (r.selected ? { ...r, sector: bulkSector } : r))
    );
  }

  function removeSelected() {
    setRows((prev) => prev.filter((r) => !r.selected));
  }

  const selectedCount = rows.filter((r) => r.selected).length;
  const recognizedCount = rows.filter((r) => r.status === "recognized").length;
  const unknownCount = rows.filter((r) => r.status === "unknown").length;
  const checkingCount = rows.filter((r) => r.status === "checking").length;

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
    if (rows.length === 0) {
      setError("Geen geldige rijen gevonden");
      return;
    }
    setBatchBusy(true);
    try {
      const payload: TickerInput[] = rows.map((r) => ({
        ticker: r.ticker,
        company: r.company || r.ticker,
        sector: r.sector,
        ...(extrasRef.current.get(r.ticker) ?? {}),
      }));
      const res = await batchAddTickers(payload);
      setMsg(`${res.inserted} ticker(s) toegevoegd / bijgewerkt`);
      setBatchText("");
      setRows([]);
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
      {editing && (
        <TickerDetailsModal
          card={editing}
          onClose={() => setEditing(null)}
          onSaved={onRefresh}
        />
      )}
      {error && <div className="text-red-400 text-sm">{error}</div>}
      {msg && <div className="text-emerald-400 text-sm">{msg}</div>}

      {/* Batch import */}
      <div className="bg-slate-900 border border-slate-800 rounded p-4">
        <h2 className="text-lg font-semibold mb-2">Batch‑import</h2>
        <div className="flex gap-2 mb-2 items-center text-xs">
          <span className="text-slate-400">Format:</span>
          <button
            onClick={() => setBatchMode("quick")}
            className={`px-2 py-0.5 rounded border ${
              batchMode === "quick"
                ? "bg-slate-100 text-slate-900 border-slate-100"
                : "border-slate-700 text-slate-300"
            }`}
          >
            Snel (TICKER; TICKER; …)
          </button>
          <button
            onClick={() => setBatchMode("table")}
            className={`px-2 py-0.5 rounded border ${
              batchMode === "table"
                ? "bg-slate-100 text-slate-900 border-slate-100"
                : "border-slate-700 text-slate-300"
            }`}
          >
            Tabel (CSV met velden)
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-2">
          {batchMode === "quick" ? (
            <>
              Plak tickers gescheiden door <code>;</code> of nieuwe regels.
              Suffixen zoals <code>.V</code> (TSXV), <code>.TO</code> (TSX),{" "}
              <code>.AX</code> (ASX) blijven behouden voor Yahoo/Stooq.
              Sectorlabel komt van de keuze hieronder; bedrijfsnaam vul je
              later in via "Eén ticker toevoegen" of per‑rij bewerking.
            </>
          ) : (
            <>
              Eén ticker per regel. Eenvoudig:{" "}
              <code>TICKER,Bedrijfsnaam</code> of met header voor extra
              kolommen, bijv.: <code>ticker,company,sector,commodity,jurisdiction</code>.
            </>
          )}
        </p>
        <div className="flex gap-2 mb-2 items-center flex-wrap">
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
            {rows.length} rij(en)
            {recognizedCount > 0 && (
              <span className="text-emerald-400">
                {" · "}
                {recognizedCount} herkend
              </span>
            )}
            {checkingCount > 0 && (
              <span className="text-sky-400">
                {" · "}
                {checkingCount} bezig
              </span>
            )}
            {unknownCount > 0 && (
              <span className="text-amber-400">
                {" · "}
                {unknownCount} onbekend
              </span>
            )}
            {parseErrors.length > 0 && (
              <span className="text-red-400">
                {" · "}
                {parseErrors.length} parse-fout
              </span>
            )}
          </span>
        </div>
        <textarea
          value={batchText}
          onChange={(e) => setBatchText(e.target.value)}
          rows={batchMode === "quick" ? 4 : 8}
          spellCheck={false}
          placeholder={
            batchMode === "quick"
              ? batchSector === "mining"
                ? "OPHR.V; MEK.V; FILO.TO; NFG.TO; WA1.AX"
                : "VKTX; SAVA; AKRO; ETNB; MDGL"
              : batchSector === "mining"
              ? "FILO,Filo Mining,mining,Cu,Argentina\nNFG,New Found Gold,mining,Au,Canada\n…"
              : "VKTX,Viking Therapeutics\nSAVA,Cassava Sciences\n…"
          }
          className="w-full font-mono text-xs bg-slate-950 border border-slate-700 rounded p-2"
        />
        {parseErrors.length > 0 && (
          <ul className="mt-1 text-xs text-amber-400 list-disc list-inside">
            {parseErrors.slice(0, 5).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {parseErrors.length > 5 && <li>… en meer</li>}
          </ul>
        )}

        {/* Bulk action toolbar — verschijnt zodra er ≥1 rij geselecteerd is */}
        {selectedCount > 0 && (
          <div className="mt-2 p-2 bg-slate-800/60 border border-slate-700 rounded flex items-center gap-3 flex-wrap text-xs">
            <span className="text-slate-300 font-semibold">
              {selectedCount} geselecteerd
            </span>
            <span className="text-slate-600">|</span>
            <label className="text-slate-400">Sector:</label>
            <select
              value={bulkSector}
              onChange={(e) => setBulkSector(e.target.value as Sector)}
              className="px-2 py-1 bg-slate-900 border border-slate-700 rounded"
            >
              <option value="biotech">biotech</option>
              <option value="mining">mining</option>
            </select>
            <button
              onClick={applyBulkSector}
              className="px-2 py-1 bg-sky-700 hover:bg-sky-600 rounded text-white"
            >
              Pas sector toe
            </button>
            <span className="text-slate-600">|</span>
            <label className="text-slate-400">Suffix:</label>
            <select
              value={bulkSuffix}
              onChange={(e) => setBulkSuffix(e.target.value)}
              className="px-2 py-1 bg-slate-900 border border-slate-700 rounded"
            >
              {EXCHANGE_SUFFIXES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              onClick={applyBulkSuffix}
              className="px-2 py-1 bg-sky-700 hover:bg-sky-600 rounded text-white"
              title="Vervangt bestaande exchange-suffix; share class suffixen (bv .B) blijven staan"
            >
              Pas suffix toe
            </button>
            <span className="text-slate-600">|</span>
            <button
              onClick={removeSelected}
              className="px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-white"
            >
              Verwijder selectie
            </button>
          </div>
        )}

        {rows.length > 0 && (
          <div className="mt-2 max-h-96 overflow-auto bg-slate-950 border border-slate-800 rounded">
            <table className="w-full text-xs">
              <thead className="text-slate-500 sticky top-0 bg-slate-950">
                <tr>
                  <th className="p-1 w-8">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((r) => r.selected)}
                      onChange={toggleAll}
                      title="Selecteer alles"
                    />
                  </th>
                  <th className="text-left p-1 w-6">●</th>
                  <th className="text-left p-1">Ticker</th>
                  <th className="text-left p-1">Bedrijf</th>
                  <th className="text-left p-1">Beurs</th>
                  <th className="text-left p-1">Sector</th>
                  <th className="p-1 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rowBg =
                    r.status === "recognized"
                      ? "bg-emerald-900/20 hover:bg-emerald-900/30"
                      : r.status === "unknown"
                      ? "bg-amber-900/20 hover:bg-amber-900/30"
                      : r.status === "checking"
                      ? "bg-sky-900/20"
                      : "hover:bg-slate-900";
                  const dotColor =
                    r.status === "recognized"
                      ? "bg-emerald-500"
                      : r.status === "unknown"
                      ? "bg-amber-500"
                      : r.status === "checking"
                      ? "bg-sky-500 animate-pulse"
                      : "bg-slate-600";
                  return (
                    <tr
                      key={r.id}
                      className={`border-t border-slate-800 ${rowBg}`}
                    >
                      <td className="p-1 text-center">
                        <input
                          type="checkbox"
                          checked={r.selected}
                          onChange={() => toggleRow(r.id)}
                        />
                      </td>
                      <td className="p-1">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${dotColor}`}
                          title={
                            r.status === "recognized"
                              ? `Herkend op Yahoo${r.exchange ? ` (${r.exchange})` : ""}`
                              : r.status === "unknown"
                              ? "Niet gevonden op Yahoo — controleer ticker / suffix"
                              : r.status === "checking"
                              ? "Bezig met opzoeken..."
                              : "Wacht op lookup"
                          }
                        />
                      </td>
                      <td className="p-1">
                        <input
                          value={r.ticker}
                          onChange={(e) => setRowTicker(r.id, e.target.value)}
                          className="font-mono bg-transparent border-b border-slate-700 focus:border-sky-500 outline-none w-28"
                        />
                      </td>
                      <td className="p-1 text-slate-300 truncate max-w-xs">
                        {r.status === "recognized" ? (
                          <span className="text-emerald-300">{r.company}</span>
                        ) : r.status === "checking" ? (
                          <span className="text-slate-500 italic">opzoeken…</span>
                        ) : r.status === "unknown" ? (
                          <span className="text-amber-400">
                            niet gevonden
                          </span>
                        ) : (
                          <span className="text-slate-500">{r.company}</span>
                        )}
                      </td>
                      <td className="p-1 text-slate-400 truncate max-w-[8rem]">
                        {r.exchange ?? ""}
                      </td>
                      <td className="p-1">
                        <select
                          value={r.sector}
                          onChange={(e) =>
                            setRowSector(r.id, e.target.value as Sector)
                          }
                          className="bg-transparent border-b border-slate-700 focus:border-sky-500 outline-none"
                        >
                          <option value="biotech">biotech</option>
                          <option value="mining">mining</option>
                        </select>
                      </td>
                      <td className="p-1 text-right">
                        <button
                          onClick={() => removeRow(r.id)}
                          className="text-slate-500 hover:text-red-400"
                          title="Verwijder rij"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <button
          onClick={importBatch}
          disabled={batchBusy || rows.length === 0 || checkingCount > 0}
          className="mt-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded text-white text-sm"
          title={
            checkingCount > 0
              ? "Wacht tot alle lookups klaar zijn"
              : unknownCount > 0
              ? `${unknownCount} ticker(s) niet herkend — worden alsnog toegevoegd, controleer suffix`
              : ""
          }
        >
          {batchBusy
            ? "Bezig..."
            : checkingCount > 0
            ? `Bezig met lookup (${checkingCount})...`
            : `Importeer ${rows.length} rij(en)`}
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
                  <td className="p-2 font-bold">
                    <a
                      href={googleFinanceUrl(c.ticker)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-300 hover:underline"
                      title={`Open ${c.ticker} op Google Finance`}
                    >
                      {c.ticker}
                    </a>
                  </td>
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
                  <td className="p-2 text-right space-x-1">
                    <button
                      onClick={() => setEditing(c)}
                      className="px-2 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 rounded"
                    >
                      details
                    </button>
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
