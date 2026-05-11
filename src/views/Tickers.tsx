import { useEffect, useMemo, useRef, useState } from "react";
import type { Card as CardType, Dashboard, Sector } from "../types";
import { SECTOR_LABEL, SECTOR_TONE } from "../types";
import {
  addTicker,
  batchAddTickers,
  batchRemoveTickers,
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

// Probeer sector te raden op basis van bedrijfsnaam. Mining krijgt
// voorrang wanneer er commodity-/mijnbouwwoorden inzitten — dat is
// een sterker signaal dan biotech-prefixen die soms in mining-namen
// voorkomen ("BioGold Resources" → mining).
const MINING_RE =
  /\b(mining|miner|mines|metals?|minerals?|resources?|exploration|drill(?:ing)?|royalt(?:y|ies)|streaming|gold|silver|copper|lithium|uranium|nickel|cobalt|graphite|zinc|platinum|palladium|tin|tungsten|molybdenum|rare\s*earth|potash|iron\s*ore|coal)\b/i;

const BIOTECH_RE =
  /\b(pharma(?:ceuticals?)?|biopharma|therapeutics|bio(?:science|tech(?:nology)?|logics|pharm)?|genomics?|gene(?:tic|ric)?|oncolog(?:y|ic)|immuno(?:logy|therap)|cell\s*(?:therap|technolog)|gene\s*therap|medicines?|medical|laboratories|labs|sciences|clinical|antibody|antibodies|vaccines?|RNA|DNA|protein)\b/i;

function inferSector(company: string | null | undefined): Sector {
  if (!company) return "other";
  if (MINING_RE.test(company)) return "mining";
  if (BIOTECH_RE.test(company)) return "biotech";
  return "other";
}

interface PreviewRow {
  id: number;
  ticker: string;
  company: string;
  sector: Sector;
  // True zolang de gebruiker de sector niet handmatig heeft overruled.
  // Zo kan de Yahoo-lookup de sector auto-detecteren obv company name
  // zonder een eerdere user-keuze te overschrijven.
  sectorAuto: boolean;
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

// `defaultSector` is alleen een fallback wanneer auto-detect (na lookup) faalt.
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
      const limitRaw =
        obj["buy_limit"] ?? obj["buy limit"] ?? obj["buylimit"] ??
        obj["limit"] ?? obj["aankooplimiet"];
      const buyLimit =
        limitRaw && Number.isFinite(Number(limitRaw.replace(",", ".")))
          ? Number(limitRaw.replace(",", "."))
          : undefined;
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
        // Alleen meegeven als de kolom een waarde had — anders zou de
        // backend bij re-import een bestaande limit op NULL zetten.
        ...(buyLimit !== undefined ? { buy_limit: buyLimit } : {}),
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

  // Watchlist cleanup state
  const [wlSelected, setWlSelected] = useState<Set<string>>(new Set());
  const [wlUnrecognized, setWlUnrecognized] = useState<Set<string> | null>(null);
  const [wlValidating, setWlValidating] = useState(false);
  const [wlBulkBusy, setWlBulkBusy] = useState(false);

  useEffect(() => {
    // "biotech" is een placeholder fallback; inferSector() na de lookup
    // bepaalt de echte sector.
    const parsed =
      batchMode === "quick"
        ? parseQuickAdd(batchText, "biotech")
        : parseBatch(batchText, "biotech");
    setParseErrors(parsed.errors);
    setRows((prev) => {
      const prevByTicker = new Map(prev.map((r) => [r.ticker, r]));
      const next: PreviewRow[] = [];
      for (const p of parsed.rows) {
        const existing = prevByTicker.get(p.ticker);
        // Alleen velden mét waarde meenemen; undefined zou bij de
        // backend bestaande kolommen op NULL zetten.
        const extras: Partial<TickerInput> = {};
        for (const [k, v] of Object.entries(p)) {
          if (k === "ticker" || k === "company" || k === "sector") continue;
          if (v !== undefined && v !== null && v !== "")
            (extras as Record<string, unknown>)[k] = v;
        }
        extrasRef.current.set(p.ticker, extras);
        if (existing) {
          next.push(existing);
        } else {
          // CSV-mode kan expliciet sector="mining"/"biotech" leveren — dan is
          // dat een handmatige keuze. parseQuickAdd geeft altijd defaultSector
          // terug, dus daar is sectorAuto altijd true.
          const csvHadSector =
            batchMode === "table" && /(?:^|[,\t])sector(?:[,\t]|$)/i.test(
              batchText.split(/\r?\n/, 1)[0] ?? ""
            );
          next.push({
            id: nextIdRef.current++,
            ticker: p.ticker,
            company: p.company || p.ticker,
            sector: p.sector ?? "other",
            sectorAuto: !csvHadSector,
            selected: false,
            status: "pending",
            exchange: null,
          });
        }
      }
      return next;
    });
  }, [batchText, batchMode]);

  // In-flight ref voorkomt dat overlappende useEffect fires (door
  // setRows tussendoor) een lookup-batch annuleren. Pakt 30 pending
  // tickers per batch; volgende batch start zodra deze klaar is.
  const lookupBusy = useRef(false);
  useEffect(() => {
    if (lookupBusy.current) return;
    const pending = rows
      .filter((r) => r.status === "pending")
      .slice(0, 30);
    if (pending.length === 0) return;
    const tickers = pending.map((r) => r.ticker);
    lookupBusy.current = true;
    (async () => {
      setRows((prev) =>
        prev.map((r) =>
          tickers.includes(r.ticker) ? { ...r, status: "checking" } : r
        )
      );
      try {
        const results = await lookupTickers(tickers);
        const map = new Map(results.map((r) => [r.ticker, r]));
        setRows((prev) =>
          prev.map((r) => {
            const res = map.get(r.ticker);
            if (!res) return r;
            if (res.recognized) {
              const company = res.company ?? r.company;
              const inferred = inferSector(company);
              return {
                ...r,
                status: "recognized",
                company,
                exchange: res.exchange ?? null,
                sector: r.sectorAuto ? inferred : r.sector,
              };
            }
            return { ...r, status: "unknown", exchange: null };
          })
        );
      } catch (e) {
        setRows((prev) =>
          prev.map((r) =>
            tickers.includes(r.ticker) ? { ...r, status: "pending" } : r
          )
        );
        setError(
          `Lookup mislukt: ${e instanceof Error ? e.message : String(e)}`
        );
      } finally {
        lookupBusy.current = false;
      }
    })();
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
      prev.map((r) =>
        r.id === id ? { ...r, sector: sec, sectorAuto: false } : r
      )
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
      prev.map((r) =>
        r.selected ? { ...r, sector: bulkSector, sectorAuto: false } : r
      )
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
      // Dedupe op ticker (laatste wint) zodat de upsert geen conflict-key
      // dubbel ziet, en chunk in batches van 200 zodat de POST body niet
      // te groot wordt bij duizenden rijen.
      const byTicker = new Map<string, TickerInput>();
      for (const r of rows) {
        byTicker.set(r.ticker, {
          ticker: r.ticker,
          company: r.company || r.ticker,
          sector: r.sector,
          ...(extrasRef.current.get(r.ticker) ?? {}),
        });
      }
      const all = [...byTicker.values()];
      const CHUNK = 200;
      let inserted = 0;
      for (let i = 0; i < all.length; i += CHUNK) {
        const chunk = all.slice(i, i + CHUNK);
        const res = await batchAddTickers(chunk);
        inserted += res.inserted;
        setMsg(
          `Bezig… ${Math.min(i + CHUNK, all.length)}/${all.length} verwerkt`
        );
      }
      setMsg(`${inserted} ticker(s) toegevoegd / bijgewerkt`);
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

  // Dedupe-detectie op de huidige watchlist: groepeert op genormaliseerde
  // bedrijfsnaam, vlagt alle behalve het alfabetisch eerste ticker als
  // duplicaat. Lege/dezelfde-als-ticker company telt niet (dan is alleen
  // de ticker zelf bekend, geen betrouwbare match mogelijk).
  function normalizeCompany(s: string | null | undefined): string {
    if (!s) return "";
    return s
      .toLowerCase()
      .replace(/[.,]/g, " ")
      .replace(
        /\b(inc|corp|corporation|ltd|limited|plc|sa|nv|ag|llc|holdings?|group|co|company|the)\b/g,
        ""
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  const wlDuplicates = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const c of data.cards) {
      const key = normalizeCompany(c.company);
      if (!key) continue;
      // Skip wanneer company == ticker (geen echte naam)
      if (key === c.ticker.toLowerCase()) continue;
      const arr = groups.get(key) ?? [];
      arr.push(c.ticker);
      groups.set(key, arr);
    }
    const dupes = new Set<string>();
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      arr.sort(); // alfabetisch — eerste blijft, rest is duplicaat
      for (let i = 1; i < arr.length; i++) dupes.add(arr[i]);
    }
    return dupes;
  }, [data.cards]);

  const wlDuplicateGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const c of data.cards) {
      const key = normalizeCompany(c.company);
      if (!key) continue;
      if (key === c.ticker.toLowerCase()) continue;
      const arr = groups.get(key) ?? [];
      arr.push(c.ticker);
      groups.set(key, arr);
    }
    return [...groups.values()].filter((g) => g.length > 1);
  }, [data.cards]);

  async function validateWatchlist() {
    setWlValidating(true);
    setError(null);
    try {
      const tickers = data.cards.map((c) => c.ticker);
      const recognized = new Set<string>();
      // Chunks van 50 — endpoint cap.
      for (let i = 0; i < tickers.length; i += 50) {
        const chunk = tickers.slice(i, i + 50);
        const results = await lookupTickers(chunk);
        for (const r of results) {
          if (r.recognized) recognized.add(r.ticker);
        }
      }
      const unrecognized = new Set<string>();
      for (const t of tickers) if (!recognized.has(t)) unrecognized.add(t);
      setWlUnrecognized(unrecognized);
      setMsg(
        `${recognized.size}/${tickers.length} herkend bij Yahoo, ${unrecognized.size} niet gevonden`
      );
    } catch (e) {
      setError(`Validatie mislukt: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWlValidating(false);
    }
  }

  function selectAllUnrecognized() {
    if (!wlUnrecognized) return;
    setWlSelected(new Set(wlUnrecognized));
  }
  function selectAllDuplicates() {
    setWlSelected(new Set(wlDuplicates));
  }
  function toggleWlRow(ticker: string) {
    setWlSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  }
  function clearWlSelection() {
    setWlSelected(new Set());
  }

  async function removeWlSelection() {
    if (wlSelected.size === 0) return;
    const list = [...wlSelected];
    if (
      !confirm(
        `${list.length} ticker(s) verwijderen uit watchlist?\n\n${list
          .slice(0, 20)
          .join(", ")}${list.length > 20 ? `, … (${list.length - 20} meer)` : ""}`
      )
    )
      return;
    setWlBulkBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await batchRemoveTickers(list);
      setMsg(
        `${res.removed.length} verwijderd${
          res.failed.length ? `, ${res.failed.length} mislukt` : ""
        }`
      );
      if (res.failed.length) {
        setError(
          `Mislukt: ${res.failed
            .slice(0, 3)
            .map((f) => `${f.ticker} (${f.error})`)
            .join("; ")}`
        );
      }
      setWlSelected(new Set());
      // Verwijder ook uit unrecognized cache zodat de UI klopt.
      if (wlUnrecognized) {
        const next = new Set(wlUnrecognized);
        for (const t of res.removed) next.delete(t);
        setWlUnrecognized(next);
      }
      onRefresh();
    } finally {
      setWlBulkBusy(false);
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
            <span className="text-[11px] text-neutral-500">
              Sector wordt auto-gedetecteerd uit bedrijfsnaam — per rij of in
              bulk te overrulen.
            </span>

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
                ? "VKTX; SAVA; NFG.TO; FILO.TO; AKRO; WA1.AX  — sector wordt zelf gedetecteerd"
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

          {/* Onherkende tickers — uitklapbaar, met copy-knop */}
          {unknownCount > 0 && (
            <UnrecognizedList
              tickers={rows.filter((r) => r.status === "unknown").map((r) => r.ticker)}
            />
          )}

          {/* Bulk action toolbar */}
          {selectedCount > 0 && (
            <div className="rounded-lg border border-fog-pink/40 bg-fog-pink/10 p-3 flex items-center gap-3 flex-wrap text-xs animate-fade-up">
              <span className="font-bold text-fog-pink tabular">
                {selectedCount} geselecteerd
              </span>
              <span className="text-neutral-400">·</span>
              <span className="text-neutral-400">Sector</span>
              <Select
                value={bulkSector}
                onChange={(e) => setBulkSector(e.target.value as Sector)}
                className="h-7 text-xs"
              >
                <option value="biotech">biotech</option>
                <option value="mining">mining</option>
                <option value="other">other</option>
              </Select>
              <Button size="sm" variant="primary" onClick={applyBulkSector}>
                Pas toe
              </Button>
              <span className="text-neutral-400">·</span>
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
              <span className="text-neutral-400">·</span>
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
                <option value="other">other</option>
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
                <option value="other">other</option>
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

        {/* Cleanup toolbar */}
        <Card className="p-3 mb-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="primary"
              onClick={validateWatchlist}
              disabled={wlValidating || data.cards.length === 0}
              title="Roept Yahoo-lookup aan voor alle watchlist tickers"
            >
              {wlValidating ? "Bezig…" : "Check geldigheid"}
            </Button>
            {wlUnrecognized && (
              <span className="flex items-center gap-1.5 text-xs">
                <Dot tone={wlUnrecognized.size > 0 ? "orange" : "lime"} />
                <span className="tabular text-neutral-300">
                  {wlUnrecognized.size}
                </span>
                <span className="text-neutral-500">niet herkend</span>
                {wlUnrecognized.size > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={selectAllUnrecognized}
                  >
                    selecteer
                  </Button>
                )}
              </span>
            )}

            <span className="text-neutral-400 mx-1">·</span>

            <span className="flex items-center gap-1.5 text-xs">
              <Dot tone={wlDuplicates.size > 0 ? "loss" : "lime"} />
              <span className="tabular text-neutral-300">
                {wlDuplicates.size}
              </span>
              <span className="text-neutral-500">duplicaten</span>
              {wlDuplicates.size > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={selectAllDuplicates}
                  title={
                    wlDuplicateGroups
                      .map(
                        (g) => `${g[0]} <-> ${g.slice(1).join(", ")}`
                      )
                      .slice(0, 5)
                      .join("\n")
                  }
                >
                  selecteer
                </Button>
              )}
            </span>

            {wlSelected.size > 0 && (
              <>
                <span className="text-neutral-400 mx-1">·</span>
                <span className="font-bold text-fog-pink tabular text-xs">
                  {wlSelected.size} geselecteerd
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={removeWlSelection}
                  disabled={wlBulkBusy}
                >
                  {wlBulkBusy ? "Bezig…" : "Verwijder selectie"}
                </Button>
                <Button size="sm" variant="ghost" onClick={clearWlSelection}>
                  Deselect
                </Button>
              </>
            )}
          </div>

          {wlDuplicateGroups.length > 0 && (
            <div className="text-[11px] text-neutral-500 leading-relaxed">
              <span className="text-neutral-400 font-semibold">
                Duplicaat-groepen ({wlDuplicateGroups.length}):
              </span>{" "}
              {wlDuplicateGroups.slice(0, 8).map((g, i) => (
                <span key={i} className="inline-block mr-3">
                  <span className="text-fog-lime">{g[0]}</span>
                  <span className="text-neutral-400"> ↔ </span>
                  <span className="text-fog-loss">{g.slice(1).join(", ")}</span>
                </span>
              ))}
              {wlDuplicateGroups.length > 8 &&
                ` … en ${wlDuplicateGroups.length - 8} meer`}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-neutral-500 bg-ink-3/40">
                <tr>
                  <th className="p-3 w-8">
                    <input
                      type="checkbox"
                      checked={
                        data.cards.length > 0 &&
                        data.cards.every((c) => wlSelected.has(c.ticker))
                      }
                      onChange={() => {
                        if (data.cards.every((c) => wlSelected.has(c.ticker))) {
                          setWlSelected(new Set());
                        } else {
                          setWlSelected(
                            new Set(data.cards.map((c) => c.ticker))
                          );
                        }
                      }}
                      title="Selecteer alles"
                    />
                  </th>
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
                {data.cards.map((c) => {
                  const isSelected = wlSelected.has(c.ticker);
                  const isUnrecognized = wlUnrecognized?.has(c.ticker) ?? false;
                  const isDuplicate = wlDuplicates.has(c.ticker);
                  const accent = isSelected
                    ? "bg-fog-pink/[0.06]"
                    : isUnrecognized
                    ? "bg-fog-warn/[0.05]"
                    : isDuplicate
                    ? "bg-fog-loss/[0.05]"
                    : "";
                  return (
                    <tr
                      key={c.ticker}
                      className={`border-t border-ink-5 hover:bg-ink-3/40 transition ${accent}`}
                    >
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleWlRow(c.ticker)}
                        />
                      </td>
                      <td className="p-3">
                        <Badge tone={SECTOR_TONE[c.sector]}>
                          {SECTOR_LABEL[c.sector]}
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
                        {isUnrecognized && (
                          <Dot
                            tone="orange"
                            className="ml-2 inline-block"
                            title="Niet herkend op Yahoo"
                          />
                        )}
                        {isDuplicate && (
                          <Dot
                            tone="loss"
                            className="ml-2 inline-block"
                            title="Duplicaat (zelfde bedrijfsnaam als ander ticker)"
                          />
                        )}
                      </td>
                      <td className="p-3 text-neutral-300">{c.company}</td>
                      <td className="p-3 tabular text-neutral-200">
                        {c.goud_score ?? "—"}
                      </td>
                      <td className="p-3 text-neutral-500">
                        {c.goud_type ?? "—"}
                      </td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </div>
  );
}

function UnrecognizedList({ tickers }: { tickers: string[] }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (tickers.length === 0) return null;
  const text = tickers.join("\n");
  return (
    <div className="rounded-lg border border-fog-warn/40 bg-fog-warn/10 p-3 text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 font-bold text-fog-warn"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>{tickers.length} niet herkend op Yahoo</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <textarea
            readOnly
            value={text}
            rows={Math.min(12, tickers.length)}
            className="w-full font-mono text-[11px] rounded p-2 leading-relaxed bg-ink-1"
          />
          <button
            onClick={() => {
              navigator.clipboard?.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="px-2 py-1 rounded bg-ink-3 hover:bg-ink-4 border border-ink-5 text-[11px]"
          >
            {copied ? "Gekopieerd" : "Kopieer lijst"}
          </button>
          <p className="text-[10px] text-neutral-400 leading-relaxed">
            Plak deze in de chat zodat we kunnen kijken wat ze nodig hebben
            (verkeerde suffix, andere notatie, niet op Yahoo, etc). Je kunt
            ze ook gewoon meeselecteren — dan komen ze als-is in de
            watchlist (price polling zal dan falen voor die rijen).
          </p>
        </div>
      )}
    </div>
  );
}
