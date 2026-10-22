import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { fetchSkyshots, getToken, skyshotReject, type SkyshotDay, type SkyshotRow, type SkyshotsResponse } from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, CollapsibleIntro, ago, toast } from "../components/ui";
import { useMarks } from "../hooks/useMarks";
import { HeartInline, SeenInline, ShowSeenToggle, StarRating } from "../components/MarkCells";
import { PriceChartModal } from "./PriceChartModal";

// Favorieten → 🌠 Skyshots: welke aandelen schoten het vaakst binnen één
// handelsdag minstens +80% omhoog (xinix-skyshots, wekelijks op zaterdag).
// Keuzes van de gebruiker op 2026-10-22: hoogste koers t.o.v. het vorige slot,
// minstens 10 koersstapjes, volume ≥ 2× de mediaan, TradingView moet hetzelfde
// laten zien, elke dag telt apart, 12 maanden met kolommen voor 3 maanden en
// 3 jaar, drempel standaard +80% en instelbaar, ook aandelen zonder hartje.

const THRESHOLDS = [50, 80, 100, 200] as const;
type Threshold = (typeof THRESHOLDS)[number];
type HeartFilter = "alle" | "hartje" | "zonder";
type SortKey = "n12" | "n3m" | "n3y" | "n100" | "n200" | "best" | "last" | "a5" | "limit";

const THRESHOLD_KEY = "xinix_skyshots_threshold";
const DAY = 86_400_000;

/** De stijging die telt: als TradingView hem ook ziet de laagste van de twee bronnen. */
const eff = (d: SkyshotDay) => (d.s === "ok" && d.t != null ? Math.min(d.p, d.t) : d.p);
const counts = (d: SkyshotDay, min: number) => d.r == null && !d.x && eff(d) >= min;

function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v == null) return "—";
  return v < 0 ? `−${Math.abs(v).toFixed(digits)}%` : `+${v.toFixed(digits)}%`;
}
function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}
function fmtDay(day: string | null): string {
  if (!day) return "—";
  const d = new Date(`${day}T12:00:00Z`);
  const zelfdeJaar = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", ...(zelfdeJaar ? {} : { year: "numeric" }), timeZone: "UTC" });
}
const tone = (v: number | null | undefined) => (v == null ? "text-neutral-600" : v >= 0 ? "text-fog-gain" : "text-fog-loss");
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Waarom een dag boven de drempel toch niet meetelt. */
function whyNot(d: SkyshotDay, min: number): string | null {
  if (d.x) return "door jou afgekeurd";
  if (d.r === "eenheid") return "eenheidsfout (sprong van 40× of meer)";
  if (d.r === "geen_handel") return "geen handel die dag";
  if (d.r === "tick") return `maar ${d.k ?? "?"} koersstapjes (minimaal 10)`;
  if (d.r === "volume") return `volume ${d.v ?? "?"}× normaal (minimaal 2×)`;
  if (d.r === "tradingview") return d.t != null ? `TradingView ziet ${fmtPct(d.t)}` : "TradingView kent deze dag niet";
  if (eff(d) < min) return `TradingView ziet ${fmtPct(d.t)}`;
  return null;
}

interface Stats {
  row: SkyshotRow;
  n12: number;
  n3m: number;
  n3y: number;
  n100: number;
  n200: number;
  best: SkyshotDay | null;
  last: string | null;
  a1: number | null;
  a5: number | null;
  a20: number | null;
  nAfter: number;
  limitPct: number | null;
}

function statsOf(row: SkyshotRow, min: number, since12: string, since3m: string): Stats {
  const counted = row.days.filter((d) => counts(d, min));
  const in12 = counted.filter((d) => d.d >= since12);
  let best: SkyshotDay | null = null;
  for (const d of in12) if (!best || eff(d) > eff(best)) best = d;
  const after = (k: "a1" | "a5" | "a20") => avg(counted.map((d) => d[k]).filter((x): x is number => x != null));
  return {
    row,
    n12: in12.length,
    n3m: counted.filter((d) => d.d >= since3m).length,
    n3y: counted.length,
    n100: row.days.filter((d) => d.d >= since12 && counts(d, Math.max(min, 100))).length,
    n200: row.days.filter((d) => d.d >= since12 && counts(d, Math.max(min, 200))).length,
    best,
    last: counted.length ? counted.reduce((a, d) => (d.d > a ? d.d : a), counted[0].d) : null,
    a1: after("a1"),
    a5: after("a5"),
    a20: after("a20"),
    nAfter: counted.filter((d) => d.a5 != null).length,
    limitPct: row.last_close != null && row.buy_limit != null && row.buy_limit > 0 ? (row.last_close / row.buy_limit - 1) * 100 : null,
  };
}

export function SkyshotsView() {
  const marks = useMarks();
  const [data, setData] = useState<SkyshotsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [min, setMin] = useState<Threshold>(() => {
    const saved = Number(localStorage.getItem(THRESHOLD_KEY));
    return (THRESHOLDS as readonly number[]).includes(saved) ? (saved as Threshold) : 80;
  });
  const [heart, setHeart] = useState<HeartFilter>("alle");
  const [showSeen, setShowSeen] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const [sort, setSort] = useState<SortKey>("n12");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [chartFor, setChartFor] = useState<SkyshotRow | null>(null);
  const isAdmin = !!getToken();

  const load = useCallback(async (fresh = false) => {
    try {
      setError(null);
      setData(await fetchSkyshots(fresh));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  function pickMin(v: Threshold) {
    setMin(v);
    localStorage.setItem(THRESHOLD_KEY, String(v));
  }

  const now = Date.now();
  const since12 = new Date(now - 365 * DAY).toISOString().slice(0, 10);
  const since3m = new Date(now - 91 * DAY).toISOString().slice(0, 10);

  const all = useMemo(
    () => (data?.rows ?? []).map((r) => statsOf(r, min, since12, since3m)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, min],
  );
  const withShots = all.filter((s) => (showOlder ? s.n3y : s.n12) > 0);
  const unseen = withShots.filter((s) => showSeen || !marks.isSeen(s.row.ticker));
  const nFav = unseen.filter((s) => marks.isFavorite(s.row.ticker)).length;
  const hiddenSeen = withShots.length - withShots.filter((s) => !marks.isSeen(s.row.ticker)).length;

  const shown = unseen
    .filter((s) => heart === "alle" || (heart === "hartje") === marks.isFavorite(s.row.ticker))
    .sort((a, b) => {
      const by = (f: (s: Stats) => number | null) => (f(b) ?? -Infinity) - (f(a) ?? -Infinity);
      const tie = by((s) => s.n12) || by((s) => (s.best ? eff(s.best) : null)) || by((s) => s.n3y);
      switch (sort) {
        case "n3m": return by((s) => s.n3m) || tie;
        case "n3y": return by((s) => s.n3y) || tie;
        case "n100": return by((s) => s.n100) || tie;
        case "n200": return by((s) => s.n200) || tie;
        case "best": return by((s) => (s.best ? eff(s.best) : null)) || tie;
        case "last": return (b.last ?? "").localeCompare(a.last ?? "") || tie;
        case "a5": return by((s) => s.a5) || tie;
        // Dichtst bij (of onder) de limiet eerst.
        case "limit": return (a.limitPct ?? Infinity) - (b.limitPct ?? Infinity) || tie;
        default: return tie;
      }
    });

  // Wat er bij deze drempel in 12 maanden afviel, per reden.
  const dropped = useMemo(() => {
    const out = { eenheid: 0, geen_handel: 0, tick: 0, volume: 0, tradingview: 0, afgekeurd: 0 };
    for (const r of data?.rows ?? []) {
      for (const d of r.days) {
        if (d.d < since12 || d.p < min || counts(d, min)) continue;
        if (d.x) out.afgekeurd++;
        else out[d.r ?? "tradingview"]++;
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, min]);

  async function toggleReject(row: SkyshotRow, d: SkyshotDay) {
    const key = `${row.ticker}|${d.d}`;
    setBusy(key);
    try {
      await skyshotReject(row.ticker, d.d, !d.x);
      setData((prev) => prev && {
        ...prev,
        rows: prev.rows.map((r) => r.ticker !== row.ticker ? r : { ...r, days: r.days.map((x) => (x.d === d.d ? { ...x, x: !d.x } : x)) }),
      });
      toast(d.x ? `${row.ticker} ${fmtDay(d.d)} telt weer mee` : `${row.ticker} ${fmtDay(d.d)} telt niet meer mee`);
      // Ook de browsercache bijwerken, anders staat de oude stand er na herladen nog even.
      void fetchSkyshots(true).catch(() => {});
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const th = (key: SortKey | null, label: string, title?: string, right = true) => (
    <th
      onClick={key ? () => setSort(key) : undefined}
      title={title}
      className={`px-3 py-2 font-bold whitespace-nowrap ${right ? "text-right" : "text-left"} ${
        key ? "cursor-pointer select-none hover:text-neutral-300" : ""
      } ${key && sort === key ? "text-neutral-100" : "text-neutral-500"}`}
    >
      {label}
      {key && sort === key ? " ▾" : ""}
    </th>
  );
  const pill = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-xs font-bold border ${
      active ? "border-fog-pink text-neutral-50" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
    }`;

  const run = data?.last_run;
  const prog = data?.progress;
  const nDropped = Object.values(dropped).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <CollapsibleIntro title="Skyshots: welke aandelen schieten binnen één dag omhoog" icon={<span aria-hidden>🌠</span>}>
        <p>
          Een <b>skyshot</b> is een handelsdag waarop de <b>hoogste koers</b> minstens <b>+80%</b> boven het slot van de
          handelsdag ervoor lag, ook als het aandeel daarna weer zakte (zoals SDEV op 21 oktober: van $0,83 naar $1,65).
          Elke zaterdag meet Xinix drie jaar dagkoersen van de hele watchlist; de ranglijst telt de skyshots van de
          laatste 12 maanden, en elke dag telt apart.
        </p>
        <p className="mt-2">Een dag telt <b>niet</b> mee als:</p>
        <ul className="list-disc pl-5 mt-1 space-y-0.5">
          <li>
            de stijging uit <b>minder dan 10 koersstapjes</b> bestond, zoals bij Martello dat tussen $0,005 en $0,01 heen
            en weer gaat (één stapje is daar al +100%);
          </li>
          <li>er die dag <b>niet gehandeld</b> werd, of de koers 40× of meer sprong (een eenheidsfout, zoals pence/pond in Londen);</li>
          <li>het volume <b>onder 2× het gewone volume</b> bleef (de mediaan van de 20 handelsdagen ervoor);</li>
          <li>
            <b>TradingView</b> die stijging niet laat zien. Beide bronnen moeten de drempel halen; de laagste van de twee
            telt. Kent TradingView het aandeel niet, dan telt de skyshot wel, met een vraagteken.
          </li>
        </ul>
        <p className="mt-2">
          Klap een rij open om alle skyshots van drie jaar te zien, ook de afgevallen dagen met de reden. Met{" "}
          <b>telt niet</b> keur je een skyshot zelf af. <b>Na een skyshot</b> is het gemiddelde slot 1, 5 en 20
          handelsdagen later, gemeten vanaf het slot van de skyshot-dag. De drempel kies je bovenaan; de kolom in de
          favorietenlijst telt altijd met +80%.
        </p>
      </CollapsibleIntro>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500">Drempel</span>
        {THRESHOLDS.map((t) => (
          <button key={t} onClick={() => pickMin(t)} className={pill(min === t)}>
            +{t}%
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-ink-5" />
        <button onClick={() => setHeart("alle")} className={pill(heart === "alle")}>
          Alle {unseen.length}
        </button>
        <button onClick={() => setHeart("hartje")} className={pill(heart === "hartje")}>
          ♥ Met hartje {nFav}
        </button>
        <button onClick={() => setHeart("zonder")} className={pill(heart === "zonder")}>
          Zonder hartje {unseen.length - nFav}
        </button>
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowOlder((v) => !v)}
            className={`px-2 py-1 rounded text-[11px] border ${
              showOlder ? "border-fog-lime text-fog-lime bg-fog-lime/10" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
            }`}
            title="Ook aandelen tonen waarvan de laatste skyshot langer dan 12 maanden geleden was"
          >
            {showOlder ? "Alleen 12 maanden" : "Ook ouder dan 12 maanden"}
          </button>
          {hiddenSeen > 0 || showSeen ? <ShowSeenToggle showSeen={showSeen} onChange={setShowSeen} /> : null}
          <Button size="sm" variant="ghost" onClick={() => void load(true)}>
            Vernieuw
          </Button>
        </span>
      </div>

      {run || prog ? (
        <div className="text-[11px] text-neutral-500">
          {run ? <>Laatste scan {ago(run.finished_at ?? run.started_at)}</> : null}
          {run?.ok === false ? <span className="text-fog-loss"> · mislukt</span> : null}
          {prog ? (
            <span>
              {" "}· deze week {Math.min(prog.scanned, prog.pool)} van de {prog.pool} aandelen gemeten
            </span>
          ) : null}
          {nDropped > 0 ? (
            <span
              title={`Eenheidsfout ${dropped.eenheid} · geen handel ${dropped.geen_handel} · minder dan 10 koersstapjes ${dropped.tick} · te weinig volume ${dropped.volume} · TradingView ${dropped.tradingview} · door jou afgekeurd ${dropped.afgekeurd}`}
            >
              {" "}· {nDropped} dagen van ≥ +{min}% afgevallen in 12 maanden (zie de tooltip)
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? <Card className="p-4 text-sm text-fog-loss">{error}</Card> : null}
      {data == null && !error ? <Card className="p-4 text-sm text-neutral-500">Laden…</Card> : null}
      {data != null && shown.length === 0 ? (
        <Card className="p-4 text-sm text-neutral-500">
          {data.rows.length ? "Geen skyshots met deze filters." : "Nog geen skyshots gemeten: de eerste scan loopt."}
        </Card>
      ) : null}

      {shown.length ? (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-5/60 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-2 py-2 w-8" title="Favoriet" />
                <th className="px-2 py-2 w-8" title="Gezien">
                  <span aria-hidden>🔭</span>
                </th>
                {th(null, "#")}
                {th(null, "Aandeel", undefined, false)}
                {th(null, "Sterren", undefined, false)}
                {th("n12", "12 mnd", `Skyshots van minstens +${min}% in de laatste 12 maanden`)}
                {th("n3m", "3 mnd", "In de laatste 3 maanden")}
                {th("n3y", "3 jaar", "In de laatste 3 jaar")}
                {th("n100", "≥ +100%", "Skyshots van minstens +100% in 12 maanden")}
                {th("n200", "≥ +200%", "Skyshots van minstens +200% in 12 maanden")}
                {th("best", "Grootste", "Grootste skyshot in 12 maanden")}
                {th("last", "Laatste", "Datum van de laatste skyshot")}
                {th("a5", "Na een skyshot", "Gemiddeld slot 1, 5 en 20 handelsdagen later t.o.v. het slot van de skyshot-dag (alle skyshots van 3 jaar)")}
                {th("limit", "Koers", "Laatste koers en de afstand tot je aankooplimiet")}
                <th className="px-2 py-2 w-6" />
              </tr>
            </thead>
            <tbody>
              {shown.map((s, i) => {
                const r = s.row;
                const isOpen = open === r.ticker;
                const unchecked = r.days.some((d) => counts(d, min) && d.s === "onbekend");
                return (
                  <Fragment key={r.ticker}>
                    <tr
                      className={`border-t border-ink-5/40 align-top ${i % 2 ? "bg-white/[0.022]" : ""} ${
                        marks.isSeen(r.ticker) ? "opacity-50" : ""
                      }`}
                    >
                      <td className="px-2 py-2 text-center">
                        <HeartInline ticker={r.ticker} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <SeenInline ticker={r.ticker} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{i + 1}</td>
                      <td className="px-3 py-2 min-w-[12rem]">
                        <a
                          href={googleFinanceUrl(r.ticker, r.exchange)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono font-bold text-neutral-100 hover:text-fog-pink"
                        >
                          {r.ticker}
                        </a>
                        {/* Op een telefoon valt de kolom "12 mnd" buiten beeld. */}
                        <span className="ml-2 sm:hidden text-xs font-bold text-fog-lime" title={`${s.n12} skyshots in 12 maanden`}>
                          🌠 {s.n12}
                        </span>
                        <button
                          type="button"
                          onClick={() => setChartFor(r)}
                          className="block text-left text-[11px] text-neutral-400 hover:text-fog-pink truncate max-w-[16rem]"
                          title="Koersgrafiek met de skyshots"
                        >
                          {r.company}
                        </button>
                        {unchecked ? (
                          <div className="text-[10px] text-neutral-600" title={r.note ?? "TradingView kon deze skyshots niet controleren"}>
                            ? niet bij TradingView gecontroleerd
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <StarRating ticker={r.ticker} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={`text-lg font-extrabold tabular-nums ${s.n12 ? "text-fog-lime" : "text-neutral-600"}`}>{s.n12}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-200">{s.n3m || <span className="text-neutral-600">0</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-200">{s.n3y}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-200">{s.n100 || <span className="text-neutral-600">0</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-200">{s.n200 || <span className="text-neutral-600">0</span>}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {s.best ? (
                          <>
                            <div className="font-bold tabular-nums text-fog-lime">{fmtPct(eff(s.best))}</div>
                            <div className="text-[10px] text-neutral-500">{fmtDay(s.best.d)}</div>
                          </>
                        ) : (
                          <span className="text-neutral-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-neutral-300">{fmtDay(s.last)}</td>
                      <td
                        className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-xs"
                        title={`Gemiddeld over ${s.nAfter} skyshot${s.nAfter === 1 ? "" : "s"}: 1 dag ${fmtPct(s.a1, 1)}, 5 dagen ${fmtPct(s.a5, 1)}, 20 dagen ${fmtPct(s.a20, 1)}`}
                      >
                        <span className={tone(s.a1)}>{fmtPct(s.a1)}</span>
                        <span className="text-neutral-600"> · </span>
                        <span className={tone(s.a5)}>{fmtPct(s.a5)}</span>
                        <span className="text-neutral-600"> · </span>
                        <span className={tone(s.a20)}>{fmtPct(s.a20)}</span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                        <div className="text-neutral-200">
                          {fmtPrice(r.last_close)}
                          <span className="ml-1 text-[10px] text-neutral-600">{r.currency ?? ""}</span>
                        </div>
                        {s.limitPct != null ? (
                          <div
                            className={`text-[10px] ${s.limitPct <= 0 ? "text-fog-lime" : s.limitPct <= 10 ? "text-fog-warn" : "text-neutral-500"}`}
                            title={`Aankooplimiet ${fmtPrice(r.buy_limit)}`}
                          >
                            {fmtPct(s.limitPct, 1)} vs limiet
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => setOpen(isOpen ? null : r.ticker)}
                          className="text-neutral-400 hover:text-neutral-100"
                          title={isOpen ? "Inklappen" : "Alle skyshots van dit aandeel"}
                          aria-expanded={isOpen}
                        >
                          {isOpen ? "▾" : "▸"}
                        </button>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-t border-ink-5/20">
                        <td />
                        <td colSpan={14} className="px-3 pb-3">
                          <DayList row={r} min={min} isAdmin={isAdmin} busy={busy} onToggle={toggleReject} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}

      {chartFor ? (
        <PriceChartModal
          ticker={chartFor.ticker}
          company={chartFor.company}
          exchange={chartFor.exchange}
          markers={chartFor.days.filter((d) => counts(d, min)).map((d) => ({ date: d.d, label: fmtPct(eff(d)) }))}
          onClose={() => setChartFor(null)}
        />
      ) : null}
    </div>
  );
}

function DayList({
  row,
  min,
  isAdmin,
  busy,
  onToggle,
}: {
  row: SkyshotRow;
  min: number;
  isAdmin: boolean;
  busy: string | null;
  onToggle: (row: SkyshotRow, d: SkyshotDay) => void;
}) {
  const days = row.days.filter((d) => d.p >= min);
  if (!days.length) return <div className="text-xs text-neutral-500 py-2">Geen dagen van minstens +{min}%.</div>;
  return (
    <table className="w-full text-xs mt-1">
      <thead className="text-[10px] uppercase tracking-wider text-neutral-500">
        <tr>
          <th className="px-2 py-1 text-left">Dag</th>
          <th className="px-2 py-1 text-right" title="Hoogste koers t.o.v. het vorige slot, volgens Yahoo">Hoogste</th>
          <th className="px-2 py-1 text-right" title="Dezelfde stijging volgens TradingView">TradingView</th>
          <th className="px-2 py-1 text-right" title="Slot t.o.v. het vorige slot">Slot</th>
          <th className="px-2 py-1 text-right" title="Volume t.o.v. de mediaan van de 20 handelsdagen ervoor">Volume</th>
          <th className="px-2 py-1 text-right" title="De stijging in koersstapjes">Stapjes</th>
          <th className="px-2 py-1 text-right" title="Slot 1, 5 en 20 handelsdagen later t.o.v. het slot van de skyshot-dag">Daarna 1 · 5 · 20 d</th>
          <th className="px-2 py-1 text-left">Telt</th>
          {isAdmin ? <th className="px-2 py-1" /> : null}
        </tr>
      </thead>
      <tbody>
        {days.map((d) => {
          const why = whyNot(d, min);
          const key = `${row.ticker}|${d.d}`;
          return (
            <tr key={d.d} className={`border-t border-ink-5/30 ${why ? "text-neutral-500" : "text-neutral-200"}`}>
              <td className="px-2 py-1 whitespace-nowrap">{fmtDay(d.d)}</td>
              <td className={`px-2 py-1 text-right tabular-nums font-bold ${why ? "" : "text-fog-lime"}`}>{fmtPct(d.p)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{d.s === "onbekend" ? "?" : fmtPct(d.t)}</td>
              <td className={`px-2 py-1 text-right tabular-nums ${why ? "" : tone(d.c)}`}>{fmtPct(d.c)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{d.v != null ? `${d.v}×` : "—"}</td>
              <td className="px-2 py-1 text-right tabular-nums">{d.k ?? "—"}</td>
              <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">
                <span className={why ? "" : tone(d.a1)}>{fmtPct(d.a1)}</span>
                <span className="text-neutral-600"> · </span>
                <span className={why ? "" : tone(d.a5)}>{fmtPct(d.a5)}</span>
                <span className="text-neutral-600"> · </span>
                <span className={why ? "" : tone(d.a20)}>{fmtPct(d.a20)}</span>
              </td>
              <td className="px-2 py-1">
                {why ? (
                  <span>{why}</span>
                ) : (
                  <span className="text-fog-lime">
                    ✓ telt{d.s === "onbekend" ? <span className="text-neutral-500"> (TradingView kon niet controleren)</span> : null}
                  </span>
                )}
              </td>
              {isAdmin ? (
                <td className="px-2 py-1 text-right">
                  {d.r == null ? (
                    <button
                      type="button"
                      disabled={busy === key}
                      onClick={() => onToggle(row, d)}
                      className="px-2 py-0.5 rounded border border-ink-5 text-[11px] text-neutral-400 hover:text-neutral-100 disabled:opacity-40"
                    >
                      {d.x ? "telt weer" : "telt niet"}
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
