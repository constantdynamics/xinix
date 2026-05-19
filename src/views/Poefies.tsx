import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchScanResults,
  triggerJob,
  getToken,
  type PoefieRankEntry,
} from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, Pill, Stat, Dot } from "../components/ui";
import { useMarks } from "../hooks/useMarks";
import {
  HeartCell,
  HeartHeader,
  SeenCell,
  SeenHeader,
  ShowSeenToggle,
  MarkAllSeenButton,
} from "../components/MarkCells";

function fmtPrice(v: number): string {
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}
function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function daysAgo(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 86400000);
}

type PoefieSortKey =
  | "above_limit_pct"
  | "poefie_last_date"
  | "poefie_incident_count"
  | "poefie_median_date"
  | "poefie_max_growth_pct"
  | "poefie_days_to_peak"
  | "poefie_count_6m"
  | "poefie_count_1y"
  | "poefie_count_2y"
  | "poefie_count_5y";

type SortDir = "asc" | "desc";

interface PoefieColumn {
  key: PoefieSortKey;
  label: string;
  short: string;
  defaultDir: SortDir;
  hint: string;
}

const POEFIE_COLUMNS: PoefieColumn[] = [
  { key: "above_limit_pct",       label: "Afstand tot aankooplimiet", short: "Limit %",   defaultDir: "asc",  hint: "Hoe dichter bij 0 (of negatief), hoe dichter bij de aankooplimiet" },
  { key: "poefie_incident_count", label: "Aantal poefie-incidenten (10j)", short: "# poefies", defaultDir: "desc", hint: "Aantal afzonderlijke poefie-runs in de afgelopen 10 jaar" },
  { key: "poefie_count_6m",       label: "Poefies laatste 6 maanden", short: "6m",        defaultDir: "desc", hint: "Aantal poefies in de afgelopen 6 maanden" },
  { key: "poefie_count_1y",       label: "Poefies laatste 1 jaar",    short: "1j",        defaultDir: "desc", hint: "Aantal poefies in de afgelopen 12 maanden" },
  { key: "poefie_count_2y",       label: "Poefies laatste 2 jaar",    short: "2j",        defaultDir: "desc", hint: "Aantal poefies in de afgelopen 24 maanden" },
  { key: "poefie_count_5y",       label: "Poefies laatste 5 jaar",    short: "5j",        defaultDir: "desc", hint: "Aantal poefies in de afgelopen 60 maanden" },
  { key: "poefie_max_growth_pct", label: "Max groei %",               short: "Max %",     defaultDir: "desc", hint: "Hoogste piek-groei van alle poefies (% boven baseline)" },
  { key: "poefie_days_to_peak",   label: "Mediaan dagen tot piek",    short: "Dagen → piek", defaultDir: "asc", hint: "Mediaan aantal dagen tussen baseline en piek (max 7)" },
  { key: "poefie_median_date",    label: "Mediaan datum (dagen geleden)", short: "Mediaan dagen", defaultDir: "asc", hint: "Hoeveel dagen geleden de mediaan-poefie plaatsvond" },
  { key: "poefie_last_date",      label: "Laatste poefie datum",      short: "Laatste",   defaultDir: "desc", hint: "Datum van het meest recente poefie-incident" },
];

function getSortValue(p: PoefieRankEntry, key: PoefieSortKey): number | null {
  switch (key) {
    case "above_limit_pct":        return p.above_limit_pct;
    case "poefie_incident_count":  return p.poefie_incident_count;
    case "poefie_count_6m":        return p.poefie_count_6m;
    case "poefie_count_1y":        return p.poefie_count_1y;
    case "poefie_count_2y":        return p.poefie_count_2y;
    case "poefie_count_5y":        return p.poefie_count_5y;
    case "poefie_max_growth_pct":  return p.poefie_max_growth_pct;
    case "poefie_days_to_peak":    return p.poefie_days_to_peak;
    case "poefie_median_date":     return daysAgo(p.poefie_median_date);
    case "poefie_last_date": {
      const t = p.poefie_last_date ? new Date(p.poefie_last_date).getTime() : null;
      return t != null && Number.isFinite(t) ? t : null;
    }
  }
}

interface FacetBucket {
  id: string;
  label: string;
  match: (p: PoefieRankEntry) => boolean;
}
interface FacetGroup {
  key: PoefieSortKey;
  label: string;
  buckets: FacetBucket[];
}

const FACET_GROUPS: FacetGroup[] = [
  {
    key: "poefie_incident_count",
    label: "Aantal poefie-incidenten (10j)",
    buckets: [
      { id: "1",     label: "1 incident",     match: (p) => p.poefie_incident_count === 1 },
      { id: "2to5",  label: "2 – 5",           match: (p) => (p.poefie_incident_count ?? 0) >= 2 && (p.poefie_incident_count ?? 0) <= 5 },
      { id: "6to15", label: "6 – 15",          match: (p) => (p.poefie_incident_count ?? 0) >= 6 && (p.poefie_incident_count ?? 0) <= 15 },
      { id: "16plus", label: "16 of meer",    match: (p) => (p.poefie_incident_count ?? 0) >= 16 },
    ],
  },
  {
    key: "poefie_count_6m",
    label: "Poefies laatste 6 maanden",
    buckets: [
      { id: "1",     label: "1 poefie",   match: (p) => p.poefie_count_6m === 1 },
      { id: "2to3",  label: "2 – 3",       match: (p) => (p.poefie_count_6m ?? 0) >= 2 && (p.poefie_count_6m ?? 0) <= 3 },
      { id: "4plus", label: "4 of meer",  match: (p) => (p.poefie_count_6m ?? 0) >= 4 },
    ],
  },
  {
    key: "poefie_count_1y",
    label: "Poefies laatste 1 jaar",
    buckets: [
      { id: "1",     label: "1 poefie",   match: (p) => p.poefie_count_1y === 1 },
      { id: "2to3",  label: "2 – 3",       match: (p) => (p.poefie_count_1y ?? 0) >= 2 && (p.poefie_count_1y ?? 0) <= 3 },
      { id: "4to6",  label: "4 – 6",       match: (p) => (p.poefie_count_1y ?? 0) >= 4 && (p.poefie_count_1y ?? 0) <= 6 },
      { id: "7plus", label: "7 of meer",  match: (p) => (p.poefie_count_1y ?? 0) >= 7 },
    ],
  },
  {
    key: "poefie_count_2y",
    label: "Poefies laatste 2 jaar",
    buckets: [
      { id: "1to2",  label: "1 – 2",       match: (p) => (p.poefie_count_2y ?? 0) >= 1 && (p.poefie_count_2y ?? 0) <= 2 },
      { id: "3to5",  label: "3 – 5",       match: (p) => (p.poefie_count_2y ?? 0) >= 3 && (p.poefie_count_2y ?? 0) <= 5 },
      { id: "6to10", label: "6 – 10",      match: (p) => (p.poefie_count_2y ?? 0) >= 6 && (p.poefie_count_2y ?? 0) <= 10 },
      { id: "11plus", label: "11 of meer", match: (p) => (p.poefie_count_2y ?? 0) >= 11 },
    ],
  },
  {
    key: "poefie_count_5y",
    label: "Poefies laatste 5 jaar",
    buckets: [
      { id: "1to2",   label: "1 – 2",       match: (p) => (p.poefie_count_5y ?? 0) >= 1 && (p.poefie_count_5y ?? 0) <= 2 },
      { id: "3to5",   label: "3 – 5",       match: (p) => (p.poefie_count_5y ?? 0) >= 3 && (p.poefie_count_5y ?? 0) <= 5 },
      { id: "6to10",  label: "6 – 10",      match: (p) => (p.poefie_count_5y ?? 0) >= 6 && (p.poefie_count_5y ?? 0) <= 10 },
      { id: "11plus", label: "11 of meer",  match: (p) => (p.poefie_count_5y ?? 0) >= 11 },
    ],
  },
  {
    key: "poefie_max_growth_pct",
    label: "Max groei %",
    buckets: [
      { id: "125to200",  label: "125 – 200%",      match: (p) => p.poefie_max_growth_pct != null && p.poefie_max_growth_pct >= 125 && p.poefie_max_growth_pct < 200 },
      { id: "200to500",  label: "200 – 500%",      match: (p) => p.poefie_max_growth_pct != null && p.poefie_max_growth_pct >= 200 && p.poefie_max_growth_pct < 500 },
      { id: "500to1k",   label: "500 – 1.000%",     match: (p) => p.poefie_max_growth_pct != null && p.poefie_max_growth_pct >= 500 && p.poefie_max_growth_pct < 1000 },
      { id: "gt1k",      label: "Meer dan 1.000%", match: (p) => p.poefie_max_growth_pct != null && p.poefie_max_growth_pct >= 1000 },
    ],
  },
  {
    key: "poefie_days_to_peak",
    label: "Dagen tot piek",
    buckets: [
      { id: "1",     label: "1 dag (intraday/next-day)", match: (p) => p.poefie_days_to_peak != null && p.poefie_days_to_peak <= 1 },
      { id: "2to3",  label: "2 – 3 dagen",                match: (p) => p.poefie_days_to_peak != null && p.poefie_days_to_peak >= 2 && p.poefie_days_to_peak <= 3 },
      { id: "4to5",  label: "4 – 5 dagen",                match: (p) => p.poefie_days_to_peak != null && p.poefie_days_to_peak >= 4 && p.poefie_days_to_peak <= 5 },
      { id: "6to7",  label: "6 – 7 dagen",                match: (p) => p.poefie_days_to_peak != null && p.poefie_days_to_peak >= 6 && p.poefie_days_to_peak <= 7 },
    ],
  },
  {
    key: "above_limit_pct",
    label: "Afstand tot aankooplimiet",
    buckets: [
      { id: "below",  label: "Onder limiet",            match: (p) => p.above_limit_pct != null && p.above_limit_pct <= 0 },
      { id: "0to10",  label: "0 – 10% boven limiet",    match: (p) => p.above_limit_pct != null && p.above_limit_pct > 0 && p.above_limit_pct <= 10 },
      { id: "10to25", label: "10 – 25% boven limiet",   match: (p) => p.above_limit_pct != null && p.above_limit_pct > 10 && p.above_limit_pct <= 25 },
      { id: "25to50", label: "25 – 50% boven limiet",   match: (p) => p.above_limit_pct != null && p.above_limit_pct > 25 && p.above_limit_pct <= 50 },
      { id: "gt50",   label: "Meer dan 50% boven limiet", match: (p) => p.above_limit_pct != null && p.above_limit_pct > 50 },
    ],
  },
  {
    key: "poefie_last_date",
    label: "Laatste poefie datum",
    buckets: [
      { id: "lt1m",   label: "Laatste maand",     match: (p) => { const d = daysAgo(p.poefie_last_date); return d != null && d < 30; } },
      { id: "1to6m",  label: "1 – 6 maanden",     match: (p) => { const d = daysAgo(p.poefie_last_date); return d != null && d >= 30 && d < 182; } },
      { id: "6to12m", label: "6 – 12 maanden",    match: (p) => { const d = daysAgo(p.poefie_last_date); return d != null && d >= 182 && d < 365; } },
      { id: "1to3y",  label: "1 – 3 jaar geleden", match: (p) => { const d = daysAgo(p.poefie_last_date); return d != null && d >= 365 && d < 3 * 365; } },
      { id: "gt3y",   label: "Ouder dan 3 jaar",   match: (p) => { const d = daysAgo(p.poefie_last_date); return d != null && d >= 3 * 365; } },
    ],
  },
];

export function PoefiesView() {
  const [ranking, setRanking] = useState<PoefieRankEntry[]>([]);
  const [poefieCount, setPoefieCount] = useState(0);
  const [unscanned, setUnscanned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<PoefieSortKey>("above_limit_pct");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [visibleCols, setVisibleCols] = useState<Set<PoefieSortKey>>(
    () => new Set(POEFIE_COLUMNS.map((c) => c.key)),
  );
  const [selectedBuckets, setSelectedBuckets] = useState<Record<PoefieSortKey, Set<string>>>(() => {
    const init = {} as Record<PoefieSortKey, Set<string>>;
    for (const g of FACET_GROUPS) init[g.key] = new Set();
    return init;
  });
  const [fullScanRunning, setFullScanRunning] = useState(false);
  const [fullScanBatch, setFullScanBatch] = useState(0);
  const fullScanStopRef = useRef(false);
  const [showSeen, setShowSeen] = useState(false);
  const marks = useMarks();
  const isAdmin = !!getToken();

  async function refreshData() {
    const r = await fetchScanResults();
    setRanking(r.poefie_ranking ?? []);
    setPoefieCount(r.poefie_count ?? 0);
    setUnscanned(r.poefie_unscanned ?? 0);
    return r.poefie_unscanned ?? 0;
  }

  useEffect(() => {
    refreshData()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function runScan() {
    setScanning(true);
    setScanMsg(null);
    try {
      await triggerJob("compute-poefies-background");
      setScanMsg("Scan gestart — resultaten verschijnen na de volgende herlaad (~2-3 minuten).");
    } catch (e) {
      setScanMsg(`Fout: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning(false);
    }
  }

  async function runFullScan() {
    if (fullScanRunning) return;
    fullScanStopRef.current = false;
    setFullScanRunning(true);
    setFullScanBatch(0);
    setScanMsg(null);
    const MAX_BATCHES = 80;
    const BATCH_WAIT_MS = 95_000;
    try {
      let batch = 0;
      while (!fullScanStopRef.current && batch < MAX_BATCHES) {
        const remaining = await refreshData();
        if (remaining === 0) { setScanMsg(`Volledige scan klaar — geen ongezicende tickers meer.`); break; }
        try { await triggerJob("compute-poefies-background"); } catch (e) { setScanMsg(`Fout bij batch ${batch + 1}: ${e instanceof Error ? e.message : String(e)}`); break; }
        batch++;
        setFullScanBatch(batch);
        for (let waited = 0; waited < BATCH_WAIT_MS && !fullScanStopRef.current; waited += 1000) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      await refreshData();
    } finally {
      setFullScanRunning(false);
    }
  }
  function stopFullScan() { fullScanStopRef.current = true; }

  function toggleSort(key: PoefieSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      const col = POEFIE_COLUMNS.find((c) => c.key === key);
      setSortDir(col?.defaultDir ?? "asc");
    }
  }

  function toggleCol(key: PoefieSortKey) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleBucket(groupKey: PoefieSortKey, bucketId: string) {
    setSelectedBuckets((prev) => {
      const nextSet = new Set(prev[groupKey]);
      if (nextSet.has(bucketId)) nextSet.delete(bucketId); else nextSet.add(bucketId);
      return { ...prev, [groupKey]: nextSet };
    });
  }

  function clearAllFilters() {
    const cleared = {} as Record<PoefieSortKey, Set<string>>;
    for (const g of FACET_GROUPS) cleared[g.key] = new Set();
    setSelectedBuckets(cleared);
  }

  const filteredRanking = useMemo(() => {
    const filtered = ranking.filter((p) => {
      if (!showSeen && marks.isSeen(p.ticker)) return false;
      for (const g of FACET_GROUPS) {
        const sel = selectedBuckets[g.key];
        if (sel.size === 0) continue;
        let match = false;
        for (const bid of sel) {
          const bucket = g.buckets.find((b) => b.id === bid);
          if (bucket && bucket.match(p)) { match = true; break; }
        }
        if (!match) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "asc" ? av - bv : bv - av;
    });

    return sorted;
  }, [ranking, sortKey, sortDir, selectedBuckets, showSeen, marks]);

  const bucketCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of FACET_GROUPS) {
      const baseFiltered = ranking.filter((p) => {
        for (const og of FACET_GROUPS) {
          if (og.key === g.key) continue;
          const sel = selectedBuckets[og.key];
          if (sel.size === 0) continue;
          let match = false;
          for (const bid of sel) {
            const bucket = og.buckets.find((b) => b.id === bid);
            if (bucket && bucket.match(p)) { match = true; break; }
          }
          if (!match) return false;
        }
        return true;
      });
      for (const b of g.buckets) {
        counts[`${g.key}::${b.id}`] = baseFiltered.filter((p) => b.match(p)).length;
      }
    }
    return counts;
  }, [ranking, selectedBuckets]);

  const activeFilterCount = Object.values(selectedBuckets).reduce((s, set) => s + set.size, 0);

  if (loading) return <Card className="p-10 text-center text-sm text-neutral-500">Laden…</Card>;
  if (error) return <Card className="p-4 text-sm text-fog-loss border-fog-loss/30">{error}</Card>;

  const sortArrow = (key: PoefieSortKey) => sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "";

  return (
    <div className="space-y-6">
      {/* Uitlegkaart */}
      <Card className="p-4 border-fog-watch/20 bg-fog-watch/[0.03]">
        <div className="flex items-start gap-3">
          <Dot tone="watch" />
          <div className="flex-1">
            <div className="font-bold text-neutral-100">🎆 Poefies</div>
            <div className="text-xs text-neutral-400 mt-1 leading-relaxed">
              Aandelen die ooit in de afgelopen 10 jaar minimaal <strong className="text-neutral-200">125% (2,25×)</strong> zijn gegroeid binnen maximaal <strong className="text-neutral-200">7 dagen</strong>.
              Een poefie is een explosieve, kortstondige sprong. De kolommen <em>6m / 1j / 2j / 5j</em> tonen hoe vaak het de afgelopen 6 maanden, 1, 2 en 5 jaar gebeurde.
              Per incident wordt gecheckt op stock-splits in het venster en absurde single-bar jumps om <strong className="text-neutral-200">false poefies</strong> uit te sluiten.
            </div>
          </div>
        </div>
      </Card>

      {/* Stats + trigger */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-end">
        <Stat
          label="Poefie-aandelen"
          value={poefieCount}
          hint="is_poefie = true in watchlist"
        />
        <Stat
          label="Nog te scannen"
          value={unscanned}
          hint={unscanned > 0 ? "watchlist-aandelen zonder poefie-check" : "volledig gescand"}
        />
        {isAdmin && (
          <div className="space-y-2">
            <Button size="sm" variant="secondary" disabled={scanning || fullScanRunning} onClick={runScan}>
              {scanning ? "Scannen…" : "🔍 Scan 1×"}
            </Button>
            {!fullScanRunning ? (
              <Button size="sm" disabled={scanning || unscanned === 0} onClick={runFullScan}>
                🎆 Scan hele watchlist
              </Button>
            ) : (
              <>
                <span className="text-xs text-orange-400 font-semibold">
                  Batch {fullScanBatch} · {unscanned} resterend
                </span>
                <Button size="sm" variant="secondary" onClick={stopFullScan}>Stop</Button>
              </>
            )}
            {scanMsg && <div className="text-[11px] text-neutral-400 leading-snug">{scanMsg}</div>}
          </div>
        )}
      </div>

      {ranking.length === 0 ? (
        <Card className="p-10 text-center space-y-3">
          <div className="text-4xl">🎆</div>
          <div className="text-sm font-semibold text-neutral-300">Nog geen poefies gevonden</div>
          <div className="text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
            {unscanned > 0
              ? `Er zijn nog ${unscanned} watchlist-aandelen die niet gescand zijn. Klik "Scan hele watchlist" om te beginnen.`
              : "De achtergrond-scanner draait elke 2 uur. Eerste resultaten verschijnen automatisch."}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          {/* Facet-filters */}
          <Card className="p-4 space-y-5 lg:sticky lg:top-3 lg:self-start lg:max-h-[calc(100vh-1rem)] lg:overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-bold">
                Filters {activeFilterCount > 0 && <span className="text-fog-pink">({activeFilterCount})</span>}
              </div>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearAllFilters}
                  className="text-[11px] text-fog-lime hover:underline"
                >
                  wissen
                </button>
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <ShowSeenToggle showSeen={showSeen} onChange={setShowSeen} />
                <MarkAllSeenButton tickers={filteredRanking.map((p) => p.ticker)} />
              </div>
              <div className="mt-1 text-[10px] text-neutral-500">
                {marks.seen.size} gezien · standaard verborgen
              </div>
            </div>

            {FACET_GROUPS.map((g) => (
              <div key={g.key}>
                <div className="text-[11px] font-bold text-neutral-200 mb-1.5">{g.label}</div>
                <div className="space-y-1">
                  {g.buckets.map((b) => {
                    const count = bucketCounts[`${g.key}::${b.id}`] ?? 0;
                    const checked = selectedBuckets[g.key].has(b.id);
                    const disabled = count === 0 && !checked;
                    return (
                      <label
                        key={b.id}
                        className={`flex items-center gap-2 text-[11px] ${disabled ? "text-neutral-600 cursor-not-allowed" : "text-neutral-300 cursor-pointer hover:text-neutral-100"}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleBucket(g.key, b.id)}
                          className="accent-fog-pink"
                        />
                        <span className="flex-1">{b.label}</span>
                        <span className="text-[10px] text-neutral-500 font-mono tabular-nums">{count}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="pt-3 border-t border-ink-5/40">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-2">
                Kolommen tonen
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {POEFIE_COLUMNS.map((c) => (
                  <label key={c.key} className="flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleCols.has(c.key)}
                      onChange={() => toggleCol(c.key)}
                      className="accent-fog-lime"
                    />
                    <span>{c.short}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t border-ink-5/40 text-[11px] text-neutral-500">
              {filteredRanking.length} van {ranking.length} getoond
            </div>
          </Card>

          {/* Tabel */}
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-ink-5 bg-ink-3/40 text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                    <SeenHeader />
                    <HeartHeader />
                    <th className="px-3 py-2 text-left w-10">#</th>
                    <th className="px-3 py-2 text-left">Ticker</th>
                    {POEFIE_COLUMNS.map((c) => visibleCols.has(c.key) ? (
                      <th
                        key={c.key}
                        className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none"
                        onClick={() => toggleSort(c.key)}
                        title={c.hint}
                      >
                        <span className="inline-flex items-center gap-1">
                          {c.short}
                          <span className="text-fog-lime text-[9px]">{sortArrow(c.key)}</span>
                        </span>
                      </th>
                    ) : null)}
                    <th className="px-3 py-2 text-right">Koers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-5/40">
                  {filteredRanking.map((p, i) => {
                    const atOrBelow = p.buy_limit != null && p.last_close != null && p.last_close <= p.buy_limit;
                    const near = p.above_limit_pct != null && p.above_limit_pct <= 10 && !atOrBelow;
                    const seen = marks.isSeen(p.ticker);
                    return (
                      <tr key={p.ticker} className={(atOrBelow ? "bg-fog-lime/[0.05] " : "") + (seen ? "opacity-50" : "")}>
                        <SeenCell ticker={p.ticker} />
                        <HeartCell ticker={p.ticker} />
                        <td className="px-3 py-2 text-[11px] text-neutral-500 font-mono tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <a
                              href={googleFinanceUrl(p.ticker, p.exchange)}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-sm font-semibold text-fog-lime hover:underline"
                            >
                              {p.ticker}
                            </a>
                            {p.company && (
                              <span className="text-xs text-neutral-400 truncate max-w-[140px]">{p.company}</span>
                            )}
                            {p.sector && <Pill>{p.sector}</Pill>}
                          </div>
                          <div className="mt-0.5 text-[10px] text-neutral-500 flex items-center gap-1.5">
                            {(p.medal_gold ?? 0) > 0 && <span>🏆{p.medal_gold}</span>}
                            {(p.medal_silver ?? 0) > 0 && <span>🥈{p.medal_silver}</span>}
                            {(p.medal_bronze ?? 0) > 0 && <span>🥉{p.medal_bronze}</span>}
                          </div>
                        </td>
                        {visibleCols.has("above_limit_pct") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {p.above_limit_pct != null ? (
                              <span className={atOrBelow ? "text-fog-lime font-semibold" : near ? "text-fog-warn" : "text-neutral-300"}>
                                {atOrBelow ? "✓ onder" : `+${p.above_limit_pct.toFixed(1)}%`}
                              </span>
                            ) : (
                              <span className="text-neutral-600">—</span>
                            )}
                          </td>
                        )}
                        {visibleCols.has("poefie_incident_count") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                            {p.poefie_incident_count ?? <span className="text-neutral-600">—</span>}
                          </td>
                        )}
                        {visibleCols.has("poefie_count_6m") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                            {p.poefie_count_6m ?? <span className="text-neutral-600">—</span>}
                          </td>
                        )}
                        {visibleCols.has("poefie_count_1y") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                            {p.poefie_count_1y ?? <span className="text-neutral-600">—</span>}
                          </td>
                        )}
                        {visibleCols.has("poefie_count_2y") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                            {p.poefie_count_2y ?? <span className="text-neutral-600">—</span>}
                          </td>
                        )}
                        {visibleCols.has("poefie_count_5y") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                            {p.poefie_count_5y ?? <span className="text-neutral-600">—</span>}
                          </td>
                        )}
                        {visibleCols.has("poefie_max_growth_pct") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                            {p.poefie_max_growth_pct != null
                              ? `+${p.poefie_max_growth_pct.toFixed(0)}%`
                              : <span className="text-neutral-600">—</span>}
                          </td>
                        )}
                        {visibleCols.has("poefie_days_to_peak") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                            {p.poefie_days_to_peak != null
                              ? `${p.poefie_days_to_peak}d`
                              : <span className="text-neutral-600">—</span>}
                          </td>
                        )}
                        {visibleCols.has("poefie_median_date") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                            {(() => {
                              const d = daysAgo(p.poefie_median_date);
                              return d != null ? `${d}d` : <span className="text-neutral-600">—</span>;
                            })()}
                          </td>
                        )}
                        {visibleCols.has("poefie_last_date") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-fog-pink/80">
                            {p.poefie_last_date ? fmtDate(p.poefie_last_date) : <span className="text-neutral-600">—</span>}
                          </td>
                        )}
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {p.last_close != null && <div className="text-neutral-200">{fmtPrice(p.last_close)}</div>}
                          {p.buy_limit != null && <div className="text-[10px] text-neutral-500">lim {fmtPrice(p.buy_limit)}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
