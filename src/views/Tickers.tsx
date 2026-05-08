import { useEffect, useRef, useState } from "react";
import type { Card as CardType, Dashboard, Sector } from "../types";
import {
  addTicker,
  batchAddTickers,
  lookupTickers,
  removeTicker,
  type TickerInput,
} from "../api";
import { TickerDetailsModal } from "./TickerDetailsModal";
import { googleFinanceUrl } from "../tickerLinks";
import {
  Card,
  Button,
  Pill,
  Badge,
  Dot,
  Input,
  Select,
  SectionHeader,
} from "../components/ui";

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
    rows.push({ ticker, company: ticker, sector: defaultSector });
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
      const [ticker, company, sector, extra1, extra2] = parts;
      if (!ticker) {
        errors.push(`regel ${i + 1}: leeg`);
        continue;
      }
      const sec: Sector =
        sector === "mining"
          ? "mining"
          : sector === "biotech"
          ? "biotech"
          : defaultSector;
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
  const [editing, setEditing] = useState<CardType | null>(null);
  const [singleOpen, setSingleOpen] = useState(false);

  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [bulkSuffix, setBulkSuffix] = useState<string>("");
  const [bulkSector, setBulkSector] = useState<Sector>("biotech");
  const nextIdRef = useRef(1);
  const extrasRef = useRef<Map<string, Partial<TickerInput>>>(new Map());

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
        const extras: Partial<TickerInput> = { ...p };
        delete (extras as { ticker?: string }).ticker;
        delete (extras as { company?: string }).company;
        delete (extras as { sector?: string }).sector;
        extrasRef.current.set(p.ticker, extras);
        if (existing) {
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

  useEffect(() => {
    const pending = rows
      .filter((r) => r.status === "pending")
      .map((r) => r.ticker);
    if (pending.length === 0) return;
    const timer = setTimeout(async () => {
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
          ? { ...r, ticker: t, status: "pending", company: t, exchange: null }
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
    <div className="space-y-8">
      {editing && (
        <TickerDetailsModal
          card={editing}
          onClose={() => setEditing(null)}
          onSaved={onRefresh}
        />
      )}

      {error && (
        <div className="rounded-xl border border-fog-loss/40 bg-fog-loss/10 p-3 text-sm text-fog-loss">
          {error}
        </div>
      )}
      {msg && (
        <div className="rounded-xl border border-fog-lime/40 bg-fog-lime/10 p-3 text-sm text-fog-lime">
          {msg}
        </div>
      )}

      {/* Batch import */}
      <section>
        <SectionHeader
          eyebrow="Bulk"
          title="Tickers importeren"
          subtitle="Plak symbolen, controleer ze tegen Yahoo, pas in bulk een suffix of sector toe."
          aside={
            <div className="flex gap-1.5">
              <Pill
                tone="pink"
                active={batchMode === "quick"}
                onClick={() => setBatchMode("quick")}
                size="sm"
              >
                Snel
              </Pill>
              <Pill
                tone="cyan"
                active={batchMode === "table"}
                onClick={() => setBatchMode("table")}
                size="sm"
              >
                CSV
              </Pill>
            </div>
          }
        />

        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold">
              Default sector
            </span>
            <Select
              value={batchSector}
              onChange={(e) => setBatchSector(e.target.value as Sector)}
              className="w-32"
            >
              <option value="biotech">biotech</option>
              <option value="mining">mining</option>
            </Select>

            <div className="ml-auto flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <Dot tone="lime" />
                <span className="tabular text-neutral-300">
                  {recognizedCount}
                </span>
                <span className="text-neutral-500">herkend</span>
              </span>
              {checkingCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <Dot tone="cyan" pulse />
                  <span className="tabular text-neutral-300">
                    {checkingCount}
                  </span>
                  <span className="text-neutral-500">bezig</span>
                </span>
              )}
              {unknownCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <Dot tone="orange" />
                  <span className="tabular text-neutral-300">
                    {unknownCount}
                  </span>
                  <span className="text-neutral-500">onbekend</span>
                </span>
              )}
              {parseErrors.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <Dot tone="loss" />
                  <span className="tabular text-neutral-300">
                    {parseErrors.length}
                  </span>
                  <span className="text-neutral-500">parse</span>
                </span>
              )}
            </div>
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
                : "ticker,company,sector,commodity,jurisdiction\nFILO,Filo Mining,mining,Cu,Argentina"
            }
            className="w-full font-mono text-xs rounded-lg p-3 leading-relaxed"
          />

          {parseErrors.length > 0 && (
            <ul className="text-[11px] text-fog-warn list-disc list-inside space-y-0.5">
              {parseErrors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {parseErrors.length > 5 && <li>… en meer</li>}
            </ul>
          )}

          {/* Bulk action toolbar */}
          {selectedCount > 0 && (
            <div className="rounded-lg border border-fog-pink/40 bg-fog-pink/10 p-3 flex items-center gap-3 flex-wrap text-xs animate-fade-up">
              <span className="font-bold text-fog-pink tabular">
                {selectedCount} geselecteerd
              </span>
              <span className="text-neutral-700">·</span>
              <span className="text-neutral-400">Sector</span>
              <Select
                value={bulkSector}
                onChange={(e) => setBulkSector(e.target.value as Sector)}
                className="h-7 text-xs"
              >
                <option value="biotech">biotech</option>
                <option value="mining">mining</option>
              </Select>
              <Button size="sm" variant="primary" onClick={applyBulkSector}>
                Pas toe
              </Button>
              <span className="text-neutral-700">·</span>
              <span className="text-neutral-400">Suffix</span>
              <Select
                value={bulkSuffix}
                onChange={(e) => setBulkSuffix(e.target.value)}
                className="h-7 text-xs"
              >
                {EXCHANGE_SUFFIXES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="primary"
                onClick={applyBulkSuffix}
                title="Vervangt bestaande exchange-suffix; share class (.B) blijft staan"
              >
                Pas toe
              </Button>
              <span className="text-neutral-700">·</span>
              <Button size="sm" variant="danger" onClick={removeSelected}>
                Verwijder selectie
              </Button>
            </div>
          )}

          {rows.length > 0 && (
            <div className="rounded-xl border border-ink-5 overflow-hidden bg-ink-1">
              <div className="max-h-[28rem] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-neutral-500 bg-ink-2 sticky top-0 z-10">
                    <tr>
                      <th className="p-2 w-8">
                        <input
                          type="checkbox"
                          checked={
                            rows.length > 0 && rows.every((r) => r.selected)
                          }
                          onChange={toggleAll}
                          title="Selecteer alles"
                        />
                      </th>
                      <th className="text-left p-2 w-8"></th>
                      <th className="text-left p-2">Ticker</th>
                      <th className="text-left p-2">Bedrijf</th>
                      <th className="text-left p-2">Beurs</th>
                      <th className="text-left p-2">Sector</th>
                      <th className="p-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const tone =
                        r.status === "recognized"
                          ? "lime"
                          : r.status === "unknown"
                          ? "orange"
                          : r.status === "checking"
                          ? "cyan"
                          : "neutral";
                      const rowAccent =
                        r.status === "recognized"
                          ? "bg-fog-lime/[0.04]"
                          : r.status === "unknown"
                          ? "bg-fog-warn/[0.05]"
                          : r.status === "checking"
                          ? "bg-fog-info/[0.04]"
                          : "";
                      return (
                        <tr
                          key={r.id}
                          className={`border-t border-ink-5 hover:bg-ink-3/40 ${rowAccent}`}
                        >
                          <td className="p-2 text-center">
                            <input
                              type="checkbox"
                              checked={r.selected}
                              onChange={() => toggleRow(r.id)}
                            />
                          </td>
                          <td className="p-2">
                            <Dot
                              tone={tone}
                              pulse={r.status === "checking"}
                              title={
                                r.status === "recognized"
                                  ? `Herkend op Yahoo${
                                      r.exchange ? ` (${r.exchange})` : ""
                                    }`
                                  : r.status === "unknown"
                                  ? "Niet gevonden — controleer ticker / suffix"
                                  : r.status === "checking"
                                  ? "Bezig met opzoeken…"
                                  : "Wacht op lookup"
                              }
                            />
                          </td>
                          <td className="p-2">
                            <input
                              value={r.ticker}
                              onChange={(e) =>
                                setRowTicker(r.id, e.target.value)
                              }
                              className="font-mono font-semibold bg-transparent border-0 border-b border-ink-5 focus:border-fog-pink rounded-none w-32 px-0 h-6 text-xs"
                            />
                          </td>
                          <td className="p-2 max-w-xs">
                            {r.status === "recognized" ? (
                              <span className="text-fog-lime truncate block">
                                {r.company}
                              </span>
                            ) : r.status === "checking" ? (
                              <span className="text-neutral-500 italic">
                                opzoeken…
                              </span>
                            ) : r.status === "unknown" ? (
                              <span className="text-fog-warn">
                                niet gevonden
                              </span>
                            ) : (
                              <span className="text-neutral-500">{r.company}</span>
                            )}
                          </td>
                          <td className="p-2 text-neutral-500 truncate max-w-[10rem]">
                            {r.exchange ?? "—"}
                          </td>
                          <td className="p-2">
                            <Select
                              value={r.sector}
                              onChange={(e) =>
                                setRowSector(r.id, e.target.value as Sector)
                              }
                              className="h-7 text-xs"
                            >
                              <option value="biotech">biotech</option>
                              <option value="mining">mining</option>
                            </Select>
                          </td>
                          <td className="p-2 text-right">
                            <button
                              onClick={() => removeRow(r.id)}
                              className="text-neutral-500 hover:text-fog-loss"
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
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              variant="buy"
              onClick={importBatch}
              disabled={
                batchBusy || rows.length === 0 || checkingCount > 0
              }
              title={
                checkingCount > 0
                  ? "Wacht tot alle lookups klaar zijn"
                  : unknownCount > 0
                  ? `${unknownCount} ticker(s) niet herkend — worden alsnog toegevoegd`
                  : ""
              }
            >
              {batchBusy
                ? "Bezig…"
                : checkingCount > 0
                ? `Bezig met lookup (${checkingCount})…`
                : `Importeer ${rows.length} rij(en)`}
            </Button>
            {rows.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => {
                  setBatchText("");
                  setRows([]);
                }}
              >
                Wis
              </Button>
            )}
          </div>
        </Card>
      </section>

      {/* Single add — collapsible */}
      <section>
        <button
          onClick={() => setSingleOpen((s) => !s)}
          className="text-[11px] uppercase tracking-[0.2em] font-bold text-neutral-500 hover:text-fog-pink transition flex items-center gap-2"
        >
          <span>{singleOpen ? "▾" : "▸"}</span>
          <span>Eén ticker met details toevoegen</span>
        </button>
        {singleOpen && (
          <Card className="p-4 mt-3 animate-fade-up">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Select
                value={form.sector}
                onChange={(e) =>
                  setForm({ ...form, sector: e.target.value as Sector })
                }
              >
                <option value="biotech">biotech</option>
                <option value="mining">mining</option>
              </Select>
              <Input
                placeholder="Ticker"
                value={form.ticker}
                onChange={(e) => setForm({ ...form, ticker: e.target.value })}
              />
              <Input
                placeholder="Bedrijfsnaam"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
              <Input
                placeholder="Goud-score (0-100)"
                type="number"
                value={form.goud_score}
                onChange={(e) =>
                  setForm({ ...form, goud_score: e.target.value })
                }
              />
              <Select
                value={form.goud_type}
                onChange={(e) =>
                  setForm({ ...form, goud_type: e.target.value })
                }
              >
                <option value="">Goud-type…</option>
                <option value="single-event">single-event</option>
                <option value="multi-bagger">multi-bagger</option>
                <option value="phoenix">phoenix</option>
                <option value="mixed">mixed</option>
              </Select>
              {!isMining && (
                <>
                  <Select
                    value={form.phase}
                    onChange={(e) =>
                      setForm({ ...form, phase: e.target.value })
                    }
                  >
                    <option value="">Fase…</option>
                    <option>Pre</option>
                    <option>Ph1</option>
                    <option>Ph2</option>
                    <option>Ph3</option>
                    <option>Filed</option>
                    <option>Comm</option>
                  </Select>
                  <Input
                    placeholder="Modaliteit"
                    value={form.modality}
                    onChange={(e) =>
                      setForm({ ...form, modality: e.target.value })
                    }
                  />
                  <Input
                    placeholder="Ziektegebied"
                    value={form.disease_area}
                    onChange={(e) =>
                      setForm({ ...form, disease_area: e.target.value })
                    }
                  />
                </>
              )}
              {isMining && (
                <>
                  <Input
                    placeholder="Commodity (Au/Ag/Cu/Li/U/…)"
                    value={form.commodity}
                    onChange={(e) =>
                      setForm({ ...form, commodity: e.target.value })
                    }
                  />
                  <Input
                    placeholder="Jurisdictie"
                    value={form.jurisdiction}
                    onChange={(e) =>
                      setForm({ ...form, jurisdiction: e.target.value })
                    }
                  />
                  <Input
                    placeholder="Deposit type"
                    value={form.deposit_type}
                    onChange={(e) =>
                      setForm({ ...form, deposit_type: e.target.value })
                    }
                  />
                </>
              )}
              <Input
                placeholder="Trigger event omschrijving"
                value={form.trigger_event}
                onChange={(e) =>
                  setForm({ ...form, trigger_event: e.target.value })
                }
                className="col-span-2"
              />
              <Input
                placeholder="Trigger datum (YYYY-MM-DD)"
                value={form.trigger_date}
                onChange={(e) =>
                  setForm({ ...form, trigger_date: e.target.value })
                }
              />
            </div>
            <div className="mt-3">
              <Button variant="primary" onClick={add}>
                Toevoegen
              </Button>
            </div>
          </Card>
        )}
      </section>

      {/* Watchlist tabel */}
      <section>
        <SectionHeader
          eyebrow="Bewaakt"
          title="Huidige watchlist"
          subtitle={`${data.cards.length} tickers`}
        />
        <Card className="overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-neutral-500 bg-ink-3/40">
                <tr>
                  <th className="text-left p-3 font-semibold">Sector</th>
                  <th className="text-left p-3 font-semibold">Ticker</th>
                  <th className="text-left p-3 font-semibold">Bedrijf</th>
                  <th className="text-left p-3 font-semibold">Score</th>
                  <th className="text-left p-3 font-semibold">Type</th>
                  <th className="text-left p-3 font-semibold">Detail</th>
                  <th className="text-left p-3 font-semibold">Trigger</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {data.cards.map((c) => (
                  <tr
                    key={c.ticker}
                    className="border-t border-ink-5 hover:bg-ink-3/40 transition"
                  >
                    <td className="p-3">
                      <Badge tone={c.sector === "mining" ? "watch" : "cyan"}>
                        {c.sector === "mining" ? "MIN" : "BIO"}
                      </Badge>
                    </td>
                    <td className="p-3 font-bold">
                      <a
                        href={googleFinanceUrl(c.ticker)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-fog-pink hover:underline"
                      >
                        {c.ticker}
                      </a>
                    </td>
                    <td className="p-3 text-neutral-300">{c.company}</td>
                    <td className="p-3 tabular text-neutral-200">
                      {c.goud_score ?? "—"}
                    </td>
                    <td className="p-3 text-neutral-500">{c.goud_type ?? "—"}</td>
                    <td className="p-3 text-neutral-500">
                      {c.sector === "mining"
                        ? [c.commodity, c.jurisdiction, c.deposit_type]
                            .filter(Boolean)
                            .join(" / ")
                        : [c.phase, c.modality, c.disease_area]
                            .filter(Boolean)
                            .join(" / ")}
                    </td>
                    <td className="p-3 text-neutral-500 truncate max-w-xs">
                      {c.trigger_event ?? "—"}
                    </td>
                    <td className="p-3 text-right space-x-1 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(c)}
                      >
                        details
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => remove(c.ticker)}
                        className="hover:text-fog-loss"
                      >
                        ✕
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </div>
  );
}
