// Meldingen: welke ntfy-pings zijn er wanneer over welk aandeel verstuurd,
// met per aandeel de markeringen (gezien / hartje / sterren) en een demping.
//
// Twee weergaven van hetzelfde grootboek:
//   "Per aandeel"  — één regel per ticker, waar je markeert en dempt
//   "Tijdlijn"     — elke melding los, nieuwste eerst
// Markeren gaat per aandeel, niet per melding, dus de instel-acties horen
// thuis op de aandeel-regel; de tijdlijn is puur om terug te lezen.

import { useEffect, useMemo, useState } from "react";
import {
  clearNotifyMute,
  fetchNotifyLog,
  setNotifyMute,
  type MuteMonths,
  type NotifyLogResponse,
  type NotifyLogRow,
} from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, CollapsibleIntro, Stat, Button, EmptyState } from "../components/ui";
import { HeartCell, HeartHeader, SeenCell, SeenHeader, StarRating } from "../components/MarkCells";
import { GradientTabIcon } from "../tabIcons";
import { PriceChartModal } from "./PriceChartModal";

// ntfy-prioriteiten 1..5. Alleen 4 en 5 duwen door een stille telefoon heen,
// dus die verdienen kleur; de rest blijft rustig.
const PRIO_LABEL: Record<number, string> = {
  1: "min", 2: "laag", 3: "normaal", 4: "hoog", 5: "urgent",
};
const PRIO_CLASS: Record<number, string> = {
  1: "text-neutral-500 border-ink-5",
  2: "text-neutral-400 border-ink-5",
  3: "text-neutral-300 border-ink-5",
  4: "text-fog-watch border-fog-watch/40",
  5: "text-fog-loss border-fog-loss/50",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "2-digit" });
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${fmtDate(iso)} ${d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}
function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

// Eén regel per aandeel, samengevat uit al zijn meldingen.
interface TickerRow {
  ticker: string;
  company: string | null;
  exchange: string | null;
  count: number;
  last: NotifyLogRow;
  maxPriority: number;
  sources: string[];
  mutedUntil: string | null; // ISO, of null
  muted: boolean;            // demping actief (voorgoed of nog niet verlopen)
}

function buildRows(data: NotifyLogResponse): TickerRow[] {
  const muteByTicker = new Map<string, string | null>();
  const muteActive = new Set<string>();
  for (const m of data.mutes) {
    const T = m.ticker.toUpperCase();
    // Een verlopen demping telt niet meer — de poort laat zo'n aandeel ook
    // weer door, dus de tabel moet dat niet als "gedempt" tonen.
    const active = m.muted_until == null || new Date(m.muted_until).getTime() > Date.now();
    if (!active) continue;
    muteByTicker.set(T, m.muted_until);
    muteActive.add(T);
  }

  const byTicker = new Map<string, TickerRow>();
  for (const r of data.rows) {
    const T = r.ticker.toUpperCase();
    const existing = byTicker.get(T);
    if (existing) {
      existing.count++;
      if (r.priority > existing.maxPriority) existing.maxPriority = r.priority;
      if (!existing.sources.includes(r.source)) existing.sources.push(r.source);
      // rows komen nieuwste-eerst binnen, dus `last` staat al goed.
    } else {
      byTicker.set(T, {
        ticker: T,
        company: r.company,
        exchange: r.exchange,
        count: 1,
        last: r,
        maxPriority: r.priority,
        sources: [r.source],
        mutedUntil: muteByTicker.get(T) ?? null,
        muted: muteActive.has(T),
      });
    }
  }

  // Een aandeel kan gedempt zijn zonder dat er ooit een melding over kwam
  // (bijvoorbeeld preventief gedempt). Die hoort ook in de lijst, anders kun
  // je de demping nergens meer opheffen.
  for (const T of muteActive) {
    if (byTicker.has(T)) continue;
    byTicker.set(T, {
      ticker: T, company: null, exchange: null, count: 0,
      last: null as unknown as NotifyLogRow,
      maxPriority: 0, sources: [],
      mutedUntil: muteByTicker.get(T) ?? null, muted: true,
    });
  }

  return [...byTicker.values()];
}

type SortKey = "recent" | "count" | "ticker" | "priority";

export function MeldingenView() {
  const [data, setData] = useState<NotifyLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"ticker" | "tijdlijn">("ticker");
  const [sort, setSort] = useState<SortKey>("recent");
  const [q, setQ] = useState("");
  const [onlyMuted, setOnlyMuted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [chartFor, setChartFor] = useState<{ ticker: string; company: string; exchange: string | null } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchNotifyLog());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const rows = useMemo(() => (data ? buildRows(data) : []), [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toUpperCase();
    let out = rows;
    if (needle) {
      out = out.filter(
        (r) => r.ticker.includes(needle) || (r.company ?? "").toUpperCase().includes(needle),
      );
    }
    if (onlyMuted) out = out.filter((r) => r.muted);
    const sorted = [...out];
    sorted.sort((a, b) => {
      if (sort === "ticker") return a.ticker.localeCompare(b.ticker);
      if (sort === "count") return b.count - a.count;
      if (sort === "priority") return b.maxPriority - a.maxPriority;
      const at = a.last ? new Date(a.last.sent_at).getTime() : 0;
      const bt = b.last ? new Date(b.last.sent_at).getTime() : 0;
      return bt - at;
    });
    return sorted;
  }, [rows, q, onlyMuted, sort]);

  const timeline = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toUpperCase();
    if (!needle) return data.rows;
    return data.rows.filter(
      (r) => r.ticker.toUpperCase().includes(needle) || (r.company ?? "").toUpperCase().includes(needle),
    );
  }, [data, q]);

  // Demping zetten/opheffen werkt optimistisch niet — het is een zeldzame,
  // bewuste actie en een herlaadronde houdt de weergave gegarandeerd gelijk
  // aan wat de poort straks doet.
  async function applyMute(ticker: string, months: MuteMonths | "off") {
    setBusy(ticker);
    try {
      if (months === "off") await clearNotifyMute(ticker);
      else await setNotifyMute(ticker, months);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const mutedCount = rows.filter((r) => r.muted).length;

  return (
    <div className="space-y-4">
      <CollapsibleIntro title="Meldingen" icon={<GradientTabIcon tab="meldingen" />}>
        Elke ntfy-ping die is verstuurd, met per aandeel wat je ervan vond en of je er nog
        meldingen over wilt. Markeren werkt hetzelfde als elders: <strong>gezien</strong>,{" "}
        <strong>hartje</strong> (favoriet) en <strong>sterren</strong> (1–5). Dempen is iets
        anders dan de globale cooldown van {data?.cooldown_days ?? 14} dagen: die onderdrukt
        alleen herhaling en laat een urgenter signaal er wél doorheen — een demping houdt
        <strong> alles</strong> tegen, ook urgente meldingen, tot de gekozen termijn om is.
      </CollapsibleIntro>

      {error && (
        <Card className="p-3 border-fog-loss/40 bg-fog-loss/10 text-sm text-fog-loss">
          {error}
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Meldingen" value={String(data?.rows.length ?? 0)} />
        <Stat label="Aandelen" value={String(rows.filter((r) => r.count > 0).length)} />
        <Stat label="Gedempt" value={String(mutedCount)} />
        <Stat label="Cooldown" value={`${data?.cooldown_days ?? 14}d`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-ink-5 overflow-hidden">
          {([["ticker", "Per aandeel"], ["tijdlijn", "Tijdlijn"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                view === key ? "bg-ink-3 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Zoek ticker of bedrijf…"
          className="px-3 py-1.5 rounded-lg bg-ink-2 border border-ink-5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-fog-pink/50"
        />

        {view === "ticker" && (
          <>
            <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer select-none">
              <input type="checkbox" checked={onlyMuted} onChange={(e) => setOnlyMuted(e.target.checked)} />
              Alleen gedempte
            </label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="px-2 py-1.5 rounded-lg bg-ink-2 border border-ink-5 text-xs text-neutral-300"
            >
              <option value="recent">Sorteer: meest recent</option>
              <option value="count">Sorteer: meeste meldingen</option>
              <option value="priority">Sorteer: hoogste prioriteit</option>
              <option value="ticker">Sorteer: ticker A–Z</option>
            </select>
          </>
        )}

        <div className="ml-auto">
          <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? "Laden…" : "Vernieuwen"}
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <Card className="p-10 text-center text-sm text-neutral-500">Meldingen laden…</Card>
      ) : (data?.rows.length ?? 0) === 0 && mutedCount === 0 ? (
        <EmptyState
          icon="🔔"
          title="Nog geen meldingen verstuurd"
          description="Zodra er een ntfy-ping uitgaat, verschijnt hij hier — met het aandeel, de bron en het tijdstip."
        />
      ) : view === "ticker" ? (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-5 bg-ink-3/40 text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                <tr>
                  <SeenHeader />
                  <HeartHeader />
                  <th className="px-3 py-2 text-center" title="Jouw waardering 1–5 sterren">Sterren</th>
                  <th className="px-3 py-2 text-left">Ticker</th>
                  <th className="px-3 py-2 text-left">Bedrijf</th>
                  <th className="px-3 py-2 text-right" title="Aantal verstuurde meldingen">#</th>
                  <th className="px-3 py-2 text-left">Laatste melding</th>
                  <th className="px-3 py-2 text-left">Bron</th>
                  <th className="px-3 py-2 text-center">Prio</th>
                  <th className="px-3 py-2 text-left" title="Geen ntfy-meldingen meer over dit aandeel">Meldingen ontvangen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-5/40">
                {filtered.map((r) => (
                  <tr key={r.ticker} className={r.muted ? "opacity-60" : undefined}>
                    <SeenCell ticker={r.ticker} />
                    <HeartCell ticker={r.ticker} />
                    <td className="px-3 py-2 text-center whitespace-nowrap"><StarRating ticker={r.ticker} /></td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <a
                        href={googleFinanceUrl(r.ticker, r.exchange)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono font-semibold tab-accent-text hover:underline"
                      >
                        {r.ticker}
                      </a>
                    </td>
                    <td className="px-3 py-2 max-w-[220px]">
                      {r.company ? (
                        <button
                          type="button"
                          onClick={() => setChartFor({ ticker: r.ticker, company: r.company ?? r.ticker, exchange: r.exchange })}
                          className="text-left text-neutral-200 hover:text-fog-pink hover:underline transition-colors truncate block w-full"
                          title={`Bekijk koersgrafiek van ${r.company}`}
                        >
                          {r.company}
                        </button>
                      ) : (
                        <span className="text-neutral-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-400">
                      {r.count || "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-neutral-300">
                      {r.last ? (
                        <>
                          {fmtDate(r.last.sent_at)}
                          <span className="text-neutral-600 text-xs ml-1.5">{daysAgo(r.last.sent_at)}d</span>
                        </>
                      ) : (
                        <span className="text-neutral-600">nooit</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-400 max-w-[160px] truncate" title={r.sources.join(", ")}>
                      {r.sources.join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.maxPriority > 0 && (
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${PRIO_CLASS[r.maxPriority] ?? PRIO_CLASS[3]}`}>
                          {PRIO_LABEL[r.maxPriority] ?? r.maxPriority}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <MuteControl
                        row={r}
                        busy={busy === r.ticker}
                        onChange={(m) => void applyMute(r.ticker, m)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-5 bg-ink-3/40 text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                <tr>
                  <th className="px-3 py-2 text-left">Wanneer</th>
                  <th className="px-3 py-2 text-left">Ticker</th>
                  <th className="px-3 py-2 text-left">Bedrijf</th>
                  <th className="px-3 py-2 text-left">Bron</th>
                  <th className="px-3 py-2 text-left">Aanleiding</th>
                  <th className="px-3 py-2 text-center">Prio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-5/40">
                {timeline.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 whitespace-nowrap text-neutral-300 font-mono text-xs tabular-nums">
                      {fmtDateTime(r.sent_at)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <a
                        href={googleFinanceUrl(r.ticker, r.exchange)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono font-semibold tab-accent-text hover:underline"
                      >
                        {r.ticker}
                      </a>
                    </td>
                    <td className="px-3 py-2 max-w-[200px] truncate text-neutral-300">{r.company ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-neutral-400">{r.source}</td>
                    <td className="px-3 py-2 text-xs text-neutral-500 max-w-[220px] truncate" title={r.alert_key ?? ""}>
                      {r.alert_key ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${PRIO_CLASS[r.priority] ?? PRIO_CLASS[3]}`}>
                        {PRIO_LABEL[r.priority] ?? r.priority}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {chartFor && (
        <PriceChartModal
          ticker={chartFor.ticker}
          company={chartFor.company}
          exchange={chartFor.exchange}
          onClose={() => setChartFor(null)}
        />
      )}
    </div>
  );
}

// Keuzelijst per aandeel: gewoon ontvangen, of dempen voor 3/6/12 maanden
// dan wel voorgoed. Toont bij een actieve demping tot wanneer die loopt.
function MuteControl({
  row,
  busy,
  onChange,
}: {
  row: TickerRow;
  busy: boolean;
  onChange: (m: MuteMonths | "off") => void;
}) {
  const current: string = !row.muted ? "off" : row.mutedUntil == null ? "forever" : "until";

  return (
    <div className="flex items-center gap-2">
      <select
        disabled={busy}
        value={current === "until" ? "until" : current}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "off") onChange("off");
          else if (v === "forever") onChange(null);
          else if (v === "until") return; // informatief, geen actie
          else onChange(Number(v) as MuteMonths);
        }}
        className={`px-2 py-1 rounded-lg border text-xs ${
          row.muted
            ? "bg-fog-loss/10 border-fog-loss/40 text-fog-loss"
            : "bg-ink-2 border-ink-5 text-neutral-300"
        } disabled:opacity-50`}
        title={
          row.muted
            ? row.mutedUntil
              ? `Gedempt tot ${fmtDate(row.mutedUntil)}`
              : "Voorgoed gedempt"
            : "Je ontvangt meldingen over dit aandeel"
        }
      >
        <option value="off">Ja, gewoon ontvangen</option>
        {current === "until" && (
          <option value="until">Gedempt tot {row.mutedUntil ? fmtDate(row.mutedUntil) : ""}</option>
        )}
        <option value="3">Niet — 3 maanden</option>
        <option value="6">Niet — 6 maanden</option>
        <option value="12">Niet — 12 maanden</option>
        <option value="forever">Niet — voorgoed</option>
      </select>
      {busy && <span className="text-[10px] text-neutral-500">…</span>}
    </div>
  );
}
