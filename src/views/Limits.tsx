import { useEffect, useMemo, useRef, useState } from "react";
import type { Dashboard, Card as CardData, Sector } from "../types";
import { SECTOR_LABEL, SECTOR_TONE } from "../types";
import {
  batchAddTickers,
  lookupTickers,
  patchTicker,
  type TickerInput,
} from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import {
  Card,
  Button,
  Pill,
  Badge,
  Dot,
  SectionHeader,
  RangeBar,
  BlockBar,
} from "../components/ui";

const VIEW_KEY = "xinix_limit_view";

// Distance = limit/price, capped op 1.0. Hoger = dichter bij entry.
function distanceFraction(price: number, limit: number): number {
  if (price <= 0 || limit <= 0) return 0;
  if (price <= limit) return 1;
  return limit / price;
}

function distanceTone(d: number): {
  bg: string;
  text: string;
  ring: string;
  label: string;
} {
  if (d >= 1)
    return {
      bg: "bg-fog-lime",
      text: "text-fog-lime",
      ring: "ring-fog-lime/40",
      label: "BUY!",
    };
  if (d >= 0.95)
    return {
      bg: "bg-fog-lime/80",
      text: "text-fog-lime",
      ring: "ring-fog-lime/30",
      label: "≤5% boven",
    };
  if (d >= 0.85)
    return {
      bg: "bg-fog-info",
      text: "text-fog-info",
      ring: "ring-fog-info/30",
      label: "≤15% boven",
    };
  if (d >= 0.7)
    return {
      bg: "bg-fog-warn",
      text: "text-fog-warn",
      ring: "ring-fog-warn/30",
      label: "≤30% boven",
    };
  if (d >= 0.5)
    return {
      bg: "bg-fog-warn/70",
      text: "text-fog-warn",
      ring: "ring-fog-warn/20",
      label: "≤50% boven",
    };
  return {
    bg: "bg-fog-loss/70",
    text: "text-fog-loss",
    ring: "ring-fog-loss/20",
    label: ">50% boven",
  };
}

function fmt(v: number): string {
  if (v < 1) return v.toFixed(3);
  if (v < 100) return v.toFixed(2);
  return v.toFixed(1);
}

interface LimitRow {
  ticker: string;
  company: string;
  sector: Sector;
  current: number | null;
  limit: number;
  distance: number; // 0..1
  pct1d: number | null;
  low_1y: number | null;
  high_1y: number | null;
  low_5y: number | null;
  high_5y: number | null;
}

export function LimitsView({
  data,
  onRefresh,
}: {
  data: Dashboard;
  onRefresh: () => void;
}) {
  const [view, setView] = useState<"list" | "tiles">(() => {
    const saved = localStorage.getItem(VIEW_KEY);
    return saved === "tiles" ? "tiles" : "list";
  });
  function pickView(v: "list" | "tiles") {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  }

  const rows: LimitRow[] = useMemo(() => {
    return data.cards
      .filter((c) => c.buy_limit != null)
      .map((c) => {
        const price = c.summary?.last_close ?? null;
        const limit = c.buy_limit as number;
        return {
          ticker: c.ticker,
          company: c.company,
          sector: c.sector,
          current: price,
          limit,
          distance: price != null ? distanceFraction(price, limit) : 0,
          pct1d: c.summary?.pct_change_1d ?? null,
          low_1y: c.summary?.low_1y ?? null,
          high_1y: c.summary?.high_1y ?? null,
          low_5y: c.summary?.low_5y ?? null,
          high_5y: c.summary?.high_5y ?? null,
        };
      })
      .sort((a, b) => b.distance - a.distance);
  }, [data.cards]);

  const buyNowCount = rows.filter((r) => r.distance >= 1).length;
  const closeCount = rows.filter(
    (r) => r.distance >= 0.85 && r.distance < 1
  ).length;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Aankoop"
        title="Limiet-watcher"
        subtitle={`${rows.length} tickers met limit · ${buyNowCount} op/onder · ${closeCount} dicht (<15% boven)`}
        aside={
          <div className="flex gap-1.5">
            <Pill
              tone="lime"
              active={view === "list"}
              onClick={() => pickView("list")}
              size="sm"
            >
              Lijst
            </Pill>
            <Pill
              tone="cyan"
              active={view === "tiles"}
              onClick={() => pickView("tiles")}
              size="sm"
            >
              Tegels
            </Pill>
          </div>
        }
      />

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-neutral-400 text-sm">
          Geen tickers met aankooplimiet. Plak onderaan een lijst om te
          beginnen.
        </Card>
      ) : view === "list" ? (
        <LimitTable rows={rows} />
      ) : (
        <LimitTiles rows={rows} />
      )}

      <BulkPaste data={data} onRefresh={onRefresh} />
    </div>
  );
}

function LimitTable({ rows }: { rows: LimitRow[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-neutral-300 bg-ink-3/40">
            <tr>
              <th className="text-left p-3 font-semibold">Ticker</th>
              <th className="text-left p-3 font-semibold">Bedrijf</th>
              <th className="text-right p-3 font-semibold">Koers</th>
              <th className="text-right p-3 font-semibold">Limit</th>
              <th className="text-left p-3 font-semibold w-56">Distance</th>
              <th className="text-right p-3 font-semibold">Dag</th>
              <th className="text-left p-3 font-semibold w-64">1y range</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tone = distanceTone(r.distance);
              const pct = Math.round(r.distance * 100);
              return (
                <tr
                  key={r.ticker}
                  className="border-t border-ink-5 hover:bg-ink-3/40 transition"
                >
                  <td className="p-3 font-bold whitespace-nowrap">
                    <Badge
                      tone={SECTOR_TONE[r.sector]}
                      className="mr-2"
                    >
                      {SECTOR_LABEL[r.sector]}
                    </Badge>
                    <a
                      href={googleFinanceUrl(r.ticker)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-fog-pink hover:underline"
                    >
                      {r.ticker}
                    </a>
                  </td>
                  <td className="p-3 text-neutral-300 truncate max-w-xs">
                    {r.company}
                  </td>
                  <td className="p-3 text-right tabular text-neutral-100">
                    {r.current != null ? `$${fmt(r.current)}` : "—"}
                  </td>
                  <td className="p-3 text-right tabular text-neutral-300">
                    ${fmt(r.limit)}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-3.5">
                        <BlockBar
                          fill={r.distance}
                          orientation="horizontal"
                        />
                      </div>
                      <span
                        className={`text-[11px] tabular font-bold w-12 text-right ${tone.text}`}
                      >
                        {r.distance >= 1 ? "BUY!" : `${pct}%`}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 text-right tabular">
                    <span
                      className={
                        (r.pct1d ?? 0) >= 0
                          ? "text-fog-lime"
                          : "text-fog-loss"
                      }
                    >
                      {r.pct1d == null
                        ? "—"
                        : `${r.pct1d >= 0 ? "+" : ""}${r.pct1d.toFixed(1)}%`}
                    </span>
                  </td>
                  <td className="p-3">
                    {r.low_1y != null &&
                    r.high_1y != null &&
                    r.current != null ? (
                      <RangeBar
                        low={r.low_1y}
                        high={r.high_1y}
                        current={r.current}
                      />
                    ) : (
                      <span className="text-[11px] text-neutral-400 italic">
                        nog ophalen
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <RemoveLimitButton ticker={r.ticker} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function LimitTiles({ rows }: { rows: LimitRow[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
      {rows.map((r) => {
        const tone = distanceTone(r.distance);
        const pct = Math.round(r.distance * 100);
        const pctAbove = r.current != null && r.current > r.limit
          ? ((r.current - r.limit) / r.limit) * 100
          : null;
        return (
          <a
            key={r.ticker}
            href={googleFinanceUrl(r.ticker)}
            target="_blank"
            rel="noopener noreferrer"
            className={`block rounded-xl border border-ink-5 ${tone.bg} ring-1 ${tone.ring} p-2.5 hover:scale-[1.02] transition cursor-pointer`}
            title={`${r.company}\nKoers $${r.current ?? "—"}\nLimit $${r.limit}\n${tone.label}`}
          >
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="font-bold text-sm text-ink-0 truncate">
                {r.ticker}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-ink-0/70 font-bold">
                {SECTOR_LABEL[r.sector]}
              </span>
            </div>
            <div className="font-bold tabular text-ink-0 text-base leading-none">
              {r.distance >= 1 ? "BUY!" : `${pct}%`}
            </div>
            <div className="text-[10px] tabular text-ink-0/80 mt-1 leading-tight">
              {r.current != null ? `$${fmt(r.current)}` : "—"}
              <span className="text-ink-0/60"> / </span>
              ${fmt(r.limit)}
            </div>
            {pctAbove != null && (
              <div className="text-[9px] tabular text-ink-0/70 mt-0.5">
                +{pctAbove.toFixed(0)}% boven limit
              </div>
            )}
          </a>
        );
      })}
    </div>
  );
}

function RemoveLimitButton({ ticker }: { ticker: string }) {
  const [busy, setBusy] = useState(false);
  async function clear() {
    if (!confirm(`Limit voor ${ticker} verwijderen?`)) return;
    setBusy(true);
    try {
      await patchTicker(ticker, { buy_limit: null });
      window.location.reload(); // simpel: dwing dashboard refresh
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="sm" variant="ghost" onClick={clear} disabled={busy}>
      ✕
    </Button>
  );
}

interface PasteRow {
  ticker: string;             // input ticker zoals user typte
  resolvedTicker?: string;    // wat Yahoo daadwerkelijk vond (smart resolve)
  limit: number;
  name?: string;              // CSV name kolom
  currency?: string;          // CSV currency kolom (USD/HKD/EUR/etc)
  inWatchlist: boolean;
  matchedTicker?: string;
  recognized: boolean | null;
  company: string | null;
  selected: boolean;
  status: "pending" | "checking" | "done";
}

// Detecteer CSV header met Ticker + Buy Limit kolommen (case
// insensitive, kan ook ; \t als sep gebruiken). Returnt header-map of
// null als het niet een CSV is.
function detectCsvHeaders(line: string): { sep: string; cols: Record<string, number> } | null {
  // Probeer comma, tab en puntkomma. Take de sep met meeste headers herkend.
  let best: { sep: string; cols: Record<string, number> } | null = null;
  for (const sep of [",", "\t", ";"]) {
    const cells = line.split(sep).map((s) => s.trim().toLowerCase());
    const cols: Record<string, number> = {};
    cells.forEach((c, i) => { if (c) cols[c] = i; });
    const hasTicker = "ticker" in cols;
    const hasLimit = "buy limit" in cols || "buy_limit" in cols || "buylimit" in cols || "limit" in cols || "aankooplimiet" in cols;
    if (hasTicker && hasLimit) {
      const score = Object.keys(cols).length;
      if (!best || score > Object.keys(best.cols).length) best = { sep, cols };
    }
  }
  return best;
}

function parseLimitPaste(text: string): { rows: PasteRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: PasteRow[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);

  // CSV met header detectie
  const firstNonEmpty = lines.find((l) => l.trim().length > 0)?.trim() ?? "";
  const csv = detectCsvHeaders(firstNonEmpty);

  if (csv) {
    const tIdx = csv.cols["ticker"];
    const nIdx = csv.cols["name"] ?? csv.cols["naam"];
    const cIdx = csv.cols["currency"] ?? csv.cols["valuta"] ?? csv.cols["ccy"];
    const lIdx =
      csv.cols["buy limit"] ??
      csv.cols["buy_limit"] ??
      csv.cols["buylimit"] ??
      csv.cols["limit"] ??
      csv.cols["aankooplimiet"];
    const startIdx = lines.findIndex((l) => l.trim() === firstNonEmpty) + 1;
    for (let i = startIdx; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw || !raw.trim() || raw.trim().startsWith("#")) continue;
      const cells = raw.split(csv.sep).map((s) => s.trim());
      const ticker = (cells[tIdx] ?? "").toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9.-]*$/.test(ticker)) {
        if (cells[tIdx]) errors.push(`'${cells[tIdx]}' is geen geldig ticker (regel ${i + 1})`);
        continue;
      }
      const limitStr = (cells[lIdx] ?? "").replace(",", ".").trim();
      // Lege of 0-limit: gewoon stil overslaan, geen "fout". Komt vaak
      // voor in CSVs (nog geen koersdoel ingesteld voor dat aandeel).
      if (limitStr === "" || limitStr === "0" || limitStr === "0.0" || limitStr === "0.00") continue;
      const limit = Number(limitStr);
      if (!Number.isFinite(limit) || limit <= 0) {
        errors.push(`${ticker}: '${cells[lIdx] ?? ""}' is geen geldige limit`);
        continue;
      }
      const name = nIdx != null ? cells[nIdx] || undefined : undefined;
      const currency = cIdx != null ? cells[cIdx]?.toUpperCase() || undefined : undefined;
      const key = `${ticker}|${currency ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        ticker, limit, name, currency,
        inWatchlist: false, recognized: null, company: name ?? null,
        selected: false, status: "pending",
      });
    }
    return { rows, errors };
  }

  // Fallback: simpele "ticker prijs" regels
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/[\s,;\t]+/).filter(Boolean);
    if (parts.length < 2) {
      errors.push(`'${raw}' mist een prijs`);
      continue;
    }
    const ticker = parts[0].toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.-]*$/.test(ticker)) {
      errors.push(`'${parts[0]}' is geen geldig ticker`);
      continue;
    }
    const price = Number(parts[1].replace(",", "."));
    if (!Number.isFinite(price) || price <= 0) {
      errors.push(`'${parts[1]}' is geen geldige prijs voor ${ticker}`);
      continue;
    }
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    rows.push({
      ticker, limit: price,
      inWatchlist: false, recognized: null, company: null,
      selected: false, status: "pending",
    });
  }
  return { rows, errors };
}

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

function BulkPaste({
  data,
  onRefresh,
}: {
  data: Dashboard;
  onRefresh: () => void;
}) {
  const [text, setText] = useState("");
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [rows, setRows] = useState<PasteRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const watchlistTickers = useMemo(
    () => new Set(data.cards.map((c) => c.ticker)),
    [data.cards]
  );
  const companyByTicker = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of data.cards) m.set(c.ticker, c.company);
    return m;
  }, [data.cards]);
  // Index op base-ticker (alles voor de eerste punt). Zo kan "EDCU"
  // matchen met "EDCU.AX" / "EDCU.V" / "EDCU.TO" in de watchlist zonder
  // dat de gebruiker de beurscode hoeft mee te typen. Bij meerdere
  // varianten pakken we de eerste; ambigue gevallen zijn zeldzaam in
  // een persoonlijke watchlist.
  const watchlistByBase = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of data.cards) {
      const base = c.ticker.split(".")[0].toUpperCase();
      if (!m.has(base)) m.set(base, c.ticker);
    }
    return m;
  }, [data.cards]);

  // Re-parse on text change
  useEffect(() => {
    const parsed = parseLimitPaste(text);
    setParseErrors(parsed.errors);
    setRows((prev) => {
      const prevByTicker = new Map(prev.map((r) => [r.ticker, r]));
      return parsed.rows.map((p) => {
        const exact = watchlistTickers.has(p.ticker);
        const base = p.ticker.split(".")[0];
        const noSuffix = !p.ticker.includes(".");
        const fuzzyMatch =
          !exact && noSuffix ? watchlistByBase.get(base) ?? null : null;
        const matchedTicker = fuzzyMatch && fuzzyMatch !== p.ticker ? fuzzyMatch : undefined;
        const inWatchlist = exact || !!matchedTicker;
        const effectiveTicker = matchedTicker ?? p.ticker;
        const existing = prevByTicker.get(p.ticker);
        if (existing && existing.limit === p.limit && existing.currency === p.currency) {
          return { ...existing, inWatchlist, matchedTicker };
        }
        return {
          ...p,
          inWatchlist,
          matchedTicker,
          company: companyByTicker.get(effectiveTicker) ?? p.name ?? null,
          selected: inWatchlist,
        };
      });
    });
  }, [text, watchlistTickers, companyByTicker, watchlistByBase]);

  // In-flight ref voorkomt overlappende useEffect fires van het
  // annuleren van een lookup batch. Verwerkt 30 pending tickers per
  // batch; volgende batch start automatisch na completion.
  const lookupBusy = useRef(false);
  useEffect(() => {
    if (lookupBusy.current) return;
    const pending = rows
      .filter((r) => !r.inWatchlist && r.recognized === null && r.status === "pending")
      .slice(0, 30);
    if (pending.length === 0) return;
    lookupBusy.current = true;
    (async () => {
      const targets = pending.map((r) => r.ticker);
      setRows((prev) =>
        prev.map((r) =>
          targets.includes(r.ticker) ? { ...r, status: "checking" } : r
        )
      );
      try {
        const hints = pending.map((r) => ({
          ticker: r.ticker, name: r.name, currency: r.currency,
        }));
        const results = await lookupTickers(hints);
        const map = new Map(results.map((r) => [r.input_ticker ?? r.ticker, r]));
        setRows((prev) =>
          prev.map((r) => {
            const res = map.get(r.ticker);
            if (!res) return r;
            const resolvedTicker = res.recognized && res.ticker !== r.ticker ? res.ticker : undefined;
            return {
              ...r,
              recognized: res.recognized,
              resolvedTicker,
              company: res.company ?? r.company,
              status: "done",
              selected: res.recognized,
            };
          })
        );
      } catch (e) {
        setError(`Lookup mislukt: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        lookupBusy.current = false;
      }
    })();
  }, [rows]);

  const newRows = rows.filter((r) => !r.inWatchlist);
  const updateRows = rows.filter((r) => r.inWatchlist);
  const newSelected = newRows.filter((r) => r.selected);
  const checking = rows.filter((r) => r.status === "checking").length;

  async function apply() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      // 1) Bestaande tickers: update buy_limit per stuk via PATCH.
      //    matchedTicker (fuzzy match op base) krijgt voorrang zodat
      //    "EDCU 0.05" landt op de "EDCU.AX" rij.
      let updated = 0;
      for (const r of updateRows) {
        const target = r.matchedTicker ?? r.ticker;
        await patchTicker(target, { buy_limit: r.limit });
        updated++;
      }
      // 2) Nieuwe tickers (geselecteerd): batch insert met sector + limit.
      //    Gebruik resolvedTicker (bv. 2020.HK voor "ANTA + HKD") zodat
      //    we het correcte Yahoo-symbol opslaan, niet de gebruikersnotatie.
      let inserted = 0;
      if (newSelected.length > 0) {
        const payload: TickerInput[] = newSelected.map((r) => ({
          ticker: r.resolvedTicker ?? r.ticker,
          company: r.company || r.ticker,
          sector: inferSector(r.company),
          buy_limit: r.limit,
        }));
        const res = await batchAddTickers(payload);
        inserted = res.inserted;
      }
      setMsg(
        `${updated} limit(s) bijgewerkt, ${inserted} nieuwe ticker(s) toegevoegd`
      );
      setText("");
      setRows([]);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider font-bold text-neutral-300">
            Bulk import
          </div>
          <div className="text-[11px] text-neutral-400 mt-0.5">
            <code className="text-fog-pink">ticker prijs</code> per regel,{" "}
            <em>of</em> CSV met header{" "}
            <code className="text-fog-pink">Ticker,Name,Currency,Buy Limit</code>{" "}
            (Currency hint helpt bij ambigue ticker als ANTA = ANTA Sports HK
            of HK numeric ticker als 2382 = Sunny Optical).
          </div>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        spellCheck={false}
        placeholder={
          "chn.ax 1.3\ndef 0.1\ncweb 0.12\n\n— OF CSV met header:\n\nTicker,Name,Currency,Buy Limit\nANTA,ANTA Sports,HKD,48.20\n2382,Sunny Optical,HKD,52.50\nNVAX,Novavax Inc,USD,6.53"
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

      {rows.length > 0 && (
        <div className="rounded-xl border border-ink-5 overflow-hidden bg-ink-1">
          <div className="px-3 py-2 bg-ink-2 text-[11px] flex items-center gap-3 flex-wrap">
            <span className="text-neutral-300">
              <span className="font-bold text-fog-lime tabular">
                {updateRows.length}
              </span>{" "}
              bestaande
            </span>
            <span className="text-neutral-300">
              <span className="font-bold text-fog-pink tabular">
                {newRows.length}
              </span>{" "}
              nieuw
            </span>
            {checking > 0 && (
              <span className="flex items-center gap-1 text-fog-info">
                <Dot tone="cyan" pulse />
                {checking} bezig
              </span>
            )}
            <span className="ml-auto text-neutral-400">
              <span className="font-bold text-neutral-200 tabular">
                {newSelected.length + updateRows.length}
              </span>{" "}
              wordt toegepast
            </span>
          </div>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <tbody>
                {rows.map((r) => {
                  const checkboxDisabled = r.inWatchlist; // bestaande mag je niet uit-vinken
                  return (
                    <tr
                      key={r.ticker}
                      className="border-t border-ink-5 hover:bg-ink-3/40"
                    >
                      <td className="p-2 w-8 text-center">
                        <input
                          type="checkbox"
                          checked={r.selected || r.inWatchlist}
                          disabled={checkboxDisabled}
                          onChange={() =>
                            setRows((prev) =>
                              prev.map((x) =>
                                x.ticker === r.ticker
                                  ? { ...x, selected: !x.selected }
                                  : x
                              )
                            )
                          }
                        />
                      </td>
                      <td className="p-2 font-mono font-bold w-32">
                        {r.ticker}
                        {r.resolvedTicker && (
                          <div className="text-[10px] font-normal text-fog-info">
                            → {r.resolvedTicker}
                          </div>
                        )}
                        {r.currency && (
                          <div className="text-[10px] font-normal text-neutral-400">
                            {r.currency}
                          </div>
                        )}
                      </td>
                      <td className="p-2 tabular text-fog-pink w-20">
                        ${fmt(r.limit)}
                      </td>
                      <td className="p-2">
                        {r.inWatchlist ? (
                          <span className="text-fog-lime text-[11px]">
                            ✓ in watchlist
                            {r.matchedTicker && (
                              <span className="text-fog-info">
                                {" "}
                                als{" "}
                                <span className="font-mono font-bold">
                                  {r.matchedTicker}
                                </span>
                              </span>
                            )}
                            {" "}— limit wordt geüpdatet
                          </span>
                        ) : r.status === "checking" ? (
                          <span className="text-neutral-400 italic text-[11px]">
                            opzoeken…
                          </span>
                        ) : r.recognized ? (
                          <span className="text-fog-info text-[11px]">
                            nieuw · {r.company} — voeg toe
                          </span>
                        ) : r.recognized === false ? (
                          <span className="text-fog-warn text-[11px]">
                            niet herkend op Yahoo · vink uit als typo
                          </span>
                        ) : (
                          <span className="text-neutral-400 text-[11px]">
                            wachten op lookup
                          </span>
                        )}
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
          variant="primary"
          onClick={apply}
          disabled={
            busy ||
            checking > 0 ||
            (newSelected.length === 0 && updateRows.length === 0)
          }
        >
          {busy
            ? "Bezig…"
            : checking > 0
            ? `Lookup (${checking})…`
            : `Toepassen (${updateRows.length}+${newSelected.length})`}
        </Button>
        {rows.length > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              setText("");
              setRows([]);
            }}
          >
            Wis
          </Button>
        )}
        {msg && <span className="text-fog-lime text-xs">{msg}</span>}
        {error && <span className="text-fog-loss text-xs">{error}</span>}
      </div>
    </Card>
  );
}
