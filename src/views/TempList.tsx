import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchTempList, tempListAction, getToken, type TempListRow } from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, CollapsibleIntro, toast } from "../components/ui";
import { HeartInline, StarRating } from "../components/MarkCells";

// Favorieten → Tijdelijk: aandelen die apart gezet zijn in plaats van
// weggegooid. Nu de 100 die de explosie-motor op 25 september automatisch
// toevoegde; de motor draait sinds 26 september alleen nog voor ≥4★.

type SortKey = "ticker" | "change" | "reason" | "market";

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}
function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return v < 0 ? `−${Math.abs(v).toFixed(1)}%` : `+${v.toFixed(1)}%`;
}
function changeSinceAdd(r: TempListRow): number | null {
  if (r.last_close == null || r.close_at_add == null || r.close_at_add <= 0) return null;
  return (r.last_close / r.close_at_add - 1) * 100;
}
// De reden bestaat uit "; "-gescheiden treffers; de eerste woorden zijn het soort.
function kinds(reason: string | null): string[] {
  if (!reason) return [];
  const out = new Set<string>();
  for (const part of reason.split(";")) {
    const p = part.trim().toLowerCase();
    if (p.startsWith("hikkertje")) out.add("hikkertje");
    else if (p.startsWith("poefie")) out.add("poefie");
    else if (p.includes("feniks")) out.add("feniks");
    else if (p.includes("5-sterren")) out.add("ster");
    else if (p.startsWith("kans")) out.add("kans");
  }
  return [...out];
}
const KIND_LABEL: Record<string, string> = {
  hikkertje: "Hikkertje",
  poefie: "Poefie",
  feniks: "Feniks",
  ster: "5★-DNA",
  kans: "Hoge kans",
};

export function TempListView() {
  const [rows, setRows] = useState<TempListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("change");
  const [kind, setKind] = useState<string | null>(null);
  const hasToken = !!getToken();

  const load = useCallback(async () => {
    try {
      setError(null);
      setRows((await fetchTempList()).rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    if (hasToken) void load();
  }, [hasToken, load]);

  async function act(ticker: string, action: "restore" | "remove") {
    setBusy(ticker);
    try {
      await tempListAction(ticker, action);
      setRows((prev) => (prev ?? []).filter((r) => r.ticker !== ticker));
      toast(action === "restore" ? `${ticker} staat weer op de watchlist` : `${ticker} van het lijstje gehaald`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) for (const k of kinds(r.reason)) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  }, [rows]);

  const shown = useMemo(() => {
    let list = [...(rows ?? [])];
    if (kind) list = list.filter((r) => kinds(r.reason).includes(kind));
    list.sort((a, b) => {
      if (sort === "ticker") return a.ticker.localeCompare(b.ticker);
      if (sort === "reason") return (a.reason ?? "").localeCompare(b.reason ?? "");
      if (sort === "market") return (a.market ?? "").localeCompare(b.market ?? "") || a.ticker.localeCompare(b.ticker);
      return (changeSinceAdd(b) ?? -Infinity) - (changeSinceAdd(a) ?? -Infinity);
    });
    return list;
  }, [rows, sort, kind]);

  if (!hasToken) {
    return <Card className="p-4 text-sm text-neutral-400">Log in (Instellingen → token) om het tijdelijke lijstje te zien.</Card>;
  }

  const th = (key: SortKey, label: string, right = false) => (
    <th
      onClick={() => setSort(key)}
      className={`px-3 py-2 font-bold cursor-pointer select-none ${right ? "text-right" : "text-left"} ${
        sort === key ? "text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
      }`}
    >
      {label}
      {sort === key ? " ▾" : ""}
    </th>
  );

  return (
    <div className="space-y-4">
      <CollapsibleIntro title="Tijdelijk lijstje">
        <p className="text-sm text-neutral-300 leading-relaxed">
          De aandelen die de explosie-motor op 25 september automatisch aan de watchlist toevoegde. De motor draait
          sinds 26 september alleen nog voor je aandelen met minstens 4 sterren, dus deze staan op inactief: ze kosten
          geen koersaanvragen meer. De koers hieronder is de laatst bekende.
        </p>
        <p className="text-sm text-neutral-300 leading-relaxed mt-2">
          Geef je er één 4 of 5 sterren, dan neemt de motor hem vanzelf mee (Sprinters en de kansen op de andere
          tabbladen). <b>Terug</b> zet hem weer op de watchlist, <b>Weg</b> haalt hem alleen van dit lijstje.
        </p>
      </CollapsibleIntro>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setKind(null)}
          className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
            kind == null ? "border-fog-pink text-neutral-50" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Alle {rows?.length ?? 0}
        </button>
        {Object.keys(KIND_LABEL)
          .filter((k) => counts.get(k))
          .map((k) => (
            <button
              key={k}
              onClick={() => setKind(kind === k ? null : k)}
              className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                kind === k ? "border-fog-pink text-neutral-50" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {KIND_LABEL[k]} {counts.get(k)}
            </button>
          ))}
        <Button size="sm" variant="ghost" onClick={() => void load()} className="ml-auto">
          Vernieuw
        </Button>
      </div>

      {error ? <Card className="p-4 text-sm text-fog-loss">{error}</Card> : null}
      {rows == null && !error ? <Card className="p-4 text-sm text-neutral-500">Laden…</Card> : null}
      {rows != null && rows.length === 0 ? (
        <Card className="p-4 text-sm text-neutral-500">Het lijstje is leeg.</Card>
      ) : null}

      {shown.length ? (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-5/60 text-[11px] uppercase tracking-wider">
              <tr>
                {th("ticker", "Aandeel")}
                <th className="px-3 py-2 text-left font-bold text-neutral-500">Markeren</th>
                {th("reason", "Waarom toegevoegd")}
                {th("market", "Markt")}
                <th className="px-3 py-2 text-right font-bold text-neutral-500">Koers toen</th>
                <th className="px-3 py-2 text-right font-bold text-neutral-500">Laatst</th>
                {th("change", "Sinds 25 sep", true)}
                <th className="px-3 py-2 text-right font-bold text-neutral-500">Actie</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const ch = changeSinceAdd(r);
                return (
                  <tr key={r.ticker} className={`border-t border-ink-5/40 ${i % 2 ? "bg-white/[0.022]" : ""}`}>
                    <td className="px-3 py-1.5">
                      <a
                        href={googleFinanceUrl(r.ticker, r.exchange)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-bold text-neutral-100 hover:text-fog-pink"
                      >
                        {r.ticker}
                      </a>
                      <div className="text-[11px] text-neutral-500 truncate max-w-[16rem]">
                        {r.company ?? ""}
                        {r.active ? <span className="ml-1 text-fog-lime">· actief</span> : null}
                        {r.open_sim_positions ? (
                          <span className="ml-1 text-amber-300">· {r.open_sim_positions} open in de simulatie</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <HeartInline ticker={r.ticker} />
                        <StarRating ticker={r.ticker} />
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-[11px] text-neutral-300 max-w-[22rem]">
                      <div className="flex flex-wrap gap-1 mb-0.5">
                        {kinds(r.reason).map((k) => (
                          <span key={k} className="px-1.5 rounded bg-ink-4 text-neutral-200 font-bold">
                            {KIND_LABEL[k]}
                          </span>
                        ))}
                      </div>
                      <div className="text-neutral-500 line-clamp-2">{r.reason ?? "—"}</div>
                    </td>
                    <td className="px-3 py-1.5 text-[11px] text-neutral-400">{r.market ?? r.exchange ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-neutral-400">{fmtPrice(r.close_at_add)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-neutral-200">{fmtPrice(r.last_close)}</td>
                    <td
                      className={`px-3 py-1.5 text-right font-mono tabular-nums ${
                        ch == null ? "text-neutral-600" : ch >= 0 ? "text-fog-lime" : "text-fog-loss"
                      }`}
                    >
                      {fmtPct(ch)}
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      <Button size="sm" variant="secondary" disabled={busy === r.ticker} onClick={() => void act(r.ticker, "restore")}>
                        Terug
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-1"
                        disabled={busy === r.ticker}
                        onClick={() => void act(r.ticker, "remove")}
                      >
                        Weg
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
