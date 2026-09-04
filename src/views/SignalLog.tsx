import { useEffect, useMemo, useState } from "react";
import { fetchSignalLog } from "../api";
import type { SignalEpisode } from "../api";
import { Card, SectionHeader, Button, Pill, Badge, EmptyState, Input } from "../components/ui";

type SortKey = "start_date" | "end_date" | "return_pct" | "signal_days" | "ticker" | "peak_score";
type SortDir = "asc" | "desc";

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function price(v: number | null): string {
  if (v == null) return "—";
  return v < 1 ? v.toFixed(4) : v < 10 ? v.toFixed(3) : v.toFixed(2);
}

// Visuele return-cel: kleine balk + %. Balk schaalt log: tot ±50% lineair,
// daarboven afnemend zodat extreme winsten niet alles overschaduwen.
function ReturnCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-neutral-500 text-right block tabular">—</span>;
  const pos = value >= 0;
  const cls = pos ? "text-fog-lime" : "text-fog-loss";
  const bg = pos ? "bg-fog-lime/60" : "bg-fog-loss/60";
  // 50% → 50% breedte, 100% → ~67%, 200% → ~80%
  const mag = Math.min(95, Math.abs(value) / (Math.abs(value) + 50) * 100);
  return (
    <div className="flex items-center justify-end gap-2 min-w-[110px]">
      <div className="relative h-1.5 w-14 bg-ink-1/60 rounded-full overflow-hidden flex">
        {/* Midden = 0%, links = negatief, rechts = positief */}
        <div className="flex-1 flex justify-end">
          {!pos && <span className={`${bg} h-full rounded-l-full`} style={{ width: `${mag}%` }} />}
        </div>
        <div className="w-px h-full bg-neutral-700" />
        <div className="flex-1">
          {pos && <span className={`${bg} h-full block rounded-r-full`} style={{ width: `${mag}%` }} />}
        </div>
      </div>
      <span className={`tabular text-xs font-bold ${cls} w-12 text-right`}>
        {pos ? "+" : ""}{value.toFixed(1)}%
      </span>
    </div>
  );
}

const ACTION_CLS: Record<string, string> = {
  STRONG_BUY: "bg-fog-lime/20 text-fog-lime font-bold",
  BUY: "bg-fog-pink/20 text-fog-pink font-semibold",
};

export function SignalLogView() {
  const [data, setData] = useState<{ episodes: SignalEpisode[]; as_of: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(180);

  // filters
  const [filterAction, setFilterAction] = useState<"all" | "STRONG_BUY" | "BUY">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "lopend" | "afgesloten">("all");
  const [filterSector, setFilterSector] = useState<"all" | "biotech" | "mining" | "ai" | "other">("all");
  const [search, setSearch] = useState("");

  // sort
  const [sortKey, setSortKey] = useState<SortKey>("start_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  async function load() {
    try {
      setLoading(true);
      const d = await fetchSignalLog(days);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [days]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.episodes;
    if (filterAction !== "all") list = list.filter((e) => e.peak_action === filterAction);
    if (filterStatus === "lopend") list = list.filter((e) => e.is_active);
    if (filterStatus === "afgesloten") list = list.filter((e) => !e.is_active);
    if (filterSector !== "all") list = list.filter((e) => e.sector === filterSector);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((e) => e.ticker.toLowerCase().includes(q));
    }

    // Nullable kolommen: null altijd onderaan, ongeacht sort-richting.
    // Anders zou ascending sort alle "—" bovenaan zetten wat misleidend is
    // (suggereert dat die rijen "kleiner" zijn dan de echte waarden).
    list = [...list].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "return_pct") {
        const an = a.return_pct == null, bn = b.return_pct == null;
        if (an && bn) return 0;
        if (an) return 1;
        if (bn) return -1;
        return (a.return_pct! - b.return_pct!) * dir;
      }
      if (sortKey === "peak_score") {
        const an = a.peak_score == null, bn = b.peak_score == null;
        if (an && bn) return 0;
        if (an) return 1;
        if (bn) return -1;
        return (a.peak_score! - b.peak_score!) * dir;
      }
      let va: number | string, vb: number | string;
      if (sortKey === "signal_days") { va = a.signal_days; vb = b.signal_days; }
      else if (sortKey === "start_date") { va = a.start_date; vb = b.start_date; }
      else if (sortKey === "end_date") { va = a.end_date; vb = b.end_date; }
      else { va = a.ticker; vb = b.ticker; }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return list;
  }, [data, filterAction, filterStatus, filterSector, search, sortKey, sortDir]);

  const summary = useMemo(() => {
    if (!rows.length) return null;
    const active = rows.filter((r) => r.is_active).length;
    const withReturn = rows.filter((r) => r.return_pct != null);
    const pos = withReturn.filter((r) => r.return_pct! > 0).length;
    const mean = withReturn.length
      ? withReturn.reduce((s, r) => s + r.return_pct!, 0) / withReturn.length
      : null;
    return { active, total: rows.length, pos, withReturn: withReturn.length, mean };
  }, [rows]);

  function SortTh({ label, col }: { label: string; col: SortKey }) {
    const active = sortKey === col;
    return (
      <th
        className="p-2.5 text-right cursor-pointer select-none hover:text-neutral-200 transition-colors"
        onClick={() => toggleSort(col)}
      >
        {label} {active ? (sortDir === "desc" ? "↓" : "↑") : <span className="text-neutral-600">↕</span>}
      </th>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Geloofwaardigheid"
        title={
          <span className="flex items-center gap-2">
            Signaallog
            <span
              className="text-[10px] text-neutral-500 font-normal cursor-help"
              title="Een episode = aaneengesloten reeks dagen waarop het algoritme BUY of STRONG BUY gaf (gat >5 dagen = nieuw signaal). Return = (huidige koers − instapkoers bij eerste signaaldag) / instapkoers."
            >
              ⓘ
            </span>
          </span>
        }
        subtitle={
          data
            ? `${data.episodes.length} episodes in de laatste ${days} dagen · bijgewerkt ${new Date(data.as_of).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`
            : loading ? "laden…" : "—"
        }
        aside={
          <Button size="sm" variant="secondary" onClick={load} disabled={loading} title="Vernieuw">
            {loading ? "…" : "↻"}<span className="hidden sm:inline">vernieuw</span>
          </Button>
        }
      />

      {error && (
        <Card className="p-3 text-sm text-fog-loss border border-fog-loss/40 bg-fog-loss/10">
          {error}
        </Card>
      )}

      {/* Filter + periode bar */}
      <Card className="p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500 mr-1">Signaal</span>
          <Pill tone="neutral" size="sm" active={filterAction === "all"} onClick={() => setFilterAction("all")}>Alle</Pill>
          <Pill tone="lime" size="sm" active={filterAction === "STRONG_BUY"} onClick={() => setFilterAction("STRONG_BUY")}>Strong buy</Pill>
          <Pill tone="pink" size="sm" active={filterAction === "BUY"} onClick={() => setFilterAction("BUY")}>Buy</Pill>

          <span className="w-px h-4 bg-ink-5 hidden sm:block mx-1" />

          <span className="text-[10px] uppercase tracking-wider text-neutral-500 mr-1">Status</span>
          <Pill tone="neutral" size="sm" active={filterStatus === "all"} onClick={() => setFilterStatus("all")}>Alle</Pill>
          <Pill tone="lime" size="sm" active={filterStatus === "lopend"} onClick={() => setFilterStatus("lopend")} title="Algoritme geeft nu nog steeds BUY/STRONG_BUY">Lopend</Pill>
          <Pill tone="neutral" size="sm" active={filterStatus === "afgesloten"} onClick={() => setFilterStatus("afgesloten")} title="Het BUY-signaal is inmiddels verdwenen">Afgesloten</Pill>

          <span className="w-px h-4 bg-ink-5 hidden sm:block mx-1" />

          <span className="text-[10px] uppercase tracking-wider text-neutral-500 mr-1">Sector</span>
          <Pill tone="neutral" size="sm" active={filterSector === "all"} onClick={() => setFilterSector("all")}>Alle</Pill>
          <Pill tone="cyan" size="sm" active={filterSector === "biotech"} onClick={() => setFilterSector("biotech")}>Biotech</Pill>
          <Pill tone="watch" size="sm" active={filterSector === "mining"} onClick={() => setFilterSector("mining")}>Mining</Pill>
          <Pill tone="pink" size="sm" active={filterSector === "ai"} onClick={() => setFilterSector("ai")}>AI</Pill>
          <Pill tone="neutral" size="sm" active={filterSector === "other"} onClick={() => setFilterSector("other")}>Other</Pill>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500 mr-1">Periode</span>
          {[30, 60, 90, 180, 365].map((d) => (
            <Pill key={d} tone="neutral" size="sm" active={days === d} onClick={() => setDays(d)}>
              {d}d
            </Pill>
          ))}

          <span className="w-px h-4 bg-ink-5 hidden sm:block mx-1" />

          <Input
            placeholder="Zoek ticker…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs w-40"
          />
        </div>
      </Card>

      {/* Samenvatting */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Episodes", value: summary.total.toString(), hint: "gefilterd" },
            { label: "Lopend", value: summary.active.toString(), hint: "signaal nog actief" },
            {
              label: "Gem. return",
              value: summary.mean != null ? `${summary.mean >= 0 ? "+" : ""}${summary.mean.toFixed(1)}%` : "—",
              hint: `${summary.withReturn} met koers`,
              pos: summary.mean != null && summary.mean >= 0,
            },
            {
              label: "Positief",
              value: summary.withReturn ? `${((summary.pos / summary.withReturn) * 100).toFixed(0)}%` : "—",
              hint: `${summary.pos} van ${summary.withReturn}`,
            },
          ].map((s) => (
            <Card key={s.label} className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">{s.label}</div>
              <div className={`text-xl font-bold tabular ${("pos" in s) ? (s.pos ? "text-fog-lime" : "text-fog-loss") : "text-neutral-100"}`}>
                {s.value}
              </div>
              <div className="text-[11px] text-neutral-500 mt-0.5">{s.hint}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Tabel */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-xs">
            <thead className="bg-ink-3/80 backdrop-blur text-[10px] uppercase tracking-wider text-neutral-500 sticky top-0 z-10">
              <tr>
                <th
                  className="p-2.5 text-left cursor-pointer select-none hover:text-neutral-200"
                  onClick={() => toggleSort("ticker")}
                >
                  Ticker {sortKey === "ticker" ? (sortDir === "desc" ? "↓" : "↑") : <span className="text-neutral-600">↕</span>}
                </th>
                <th className="p-2.5 text-left">Signaal</th>
                <SortTh label="Gestart" col="start_date" />
                <SortTh label="Dagen" col="signal_days" />
                <th className="p-2.5 text-right">Gestopt</th>
                <th className="p-2.5 text-right">Instap</th>
                <th className="p-2.5 text-right">Nu</th>
                <SortTh label="Return" col="return_pct" />
                <SortTh label="Score" col="peak_score" />
              </tr>
            </thead>
            <tbody>
              {rows.map((ep, i) => (
                <tr
                  key={`${ep.ticker}-${ep.start_date}-${i}`}
                  className={`border-t border-ink-5 hover:bg-ink-3/40 transition-colors ${ep.is_active ? "bg-fog-lime/5" : ""}`}
                >
                  <td className="p-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-neutral-100">{ep.ticker}</span>
                      <Badge
                        tone={ep.sector === "biotech" ? "cyan" : ep.sector === "mining" ? "watch" : "neutral"}
                        className="text-[9px] px-1 py-px"
                      >
                        {ep.sector === "biotech" ? "BIO" : ep.sector === "mining" ? "MIN" : "OTH"}
                      </Badge>
                    </div>
                  </td>
                  <td className="p-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${ACTION_CLS[ep.peak_action] ?? ""}`}>
                      {ep.peak_action.replace("_", " ")}
                    </span>
                    {ep.is_active && (
                      <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-fog-lime animate-pulse" title="Nog actief" />
                    )}
                  </td>
                  <td className="p-2.5 text-right tabular text-neutral-300">{fmt(ep.start_date)}</td>
                  <td className="p-2.5 text-right tabular text-neutral-400">{ep.signal_days}d</td>
                  <td className="p-2.5 text-right tabular text-neutral-500">
                    {ep.is_active ? <span className="text-fog-lime text-[10px] font-bold">actief</span> : fmt(ep.end_date)}
                  </td>
                  <td className="p-2.5 text-right tabular text-neutral-400">{price(ep.entry_price)}</td>
                  <td className="p-2.5 text-right tabular text-neutral-300">{price(ep.current_price)}</td>
                  <td className="p-2.5">
                    <ReturnCell value={ep.return_pct} />
                  </td>
                  <td className="p-2.5 text-right tabular text-neutral-400">
                    {ep.peak_score != null ? ep.peak_score.toFixed(2) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {rows.length === 0 && !loading && (
        <EmptyState
          title="Geen episodes gevonden"
          description={
            data && data.episodes.length === 0
              ? "Zodra compute-scores BUY/STRONG_BUY-scores aanmaakt, verschijnen ze hier. Check de Status-tab om te zien of de job loopt."
              : "Geen match voor de huidige filters. Pas de filters of het zoekveld aan."
          }
        />
      )}
    </div>
  );
}
