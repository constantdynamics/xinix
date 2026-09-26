// Gemeten voorspellende waarde van één onderdeel, uit de explosie-motor:
// basiskans, backtest van de vaste criteria, kalibratie, lifts per kenmerk
// (welke meetellen) en het track record. Plus de aandelen uit het hele
// universum die nu aan het criterium van dit onderdeel voldoen.
import { useEffect, useMemo, useState } from "react";
import {
  fetchEngineOverview, fetchEngineList, fetchEngineProbs, ENGINE_EVENTS,
  type EngineEvent, type EngineHit, type EngineItem, type EngineModel, type EngineOverview, type EngineScope,
} from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Stat, Pill, ago } from "./ui";

// Eén keer per pagina-bezoek ophalen; meerdere tabbladen delen het resultaat.
let overviewPromise: Promise<EngineOverview> | null = null;
function loadOverview(): Promise<EngineOverview> {
  if (!overviewPromise) overviewPromise = fetchEngineOverview().catch((e) => { overviewPromise = null; throw e; });
  return overviewPromise;
}
let probsPromise: Promise<Record<string, (number | null)[]>> | null = null;
/** Kansen per watchlist-aandeel voor extra kolommen in bestaande tabellen. */
export function useEngineProbs(): (ticker: string, ev: EngineEvent) => number | null {
  const [probs, setProbs] = useState<Record<string, (number | null)[]>>({});
  useEffect(() => {
    if (!probsPromise) probsPromise = fetchEngineProbs().catch(() => { probsPromise = null; return {}; });
    probsPromise.then(setProbs);
  }, []);
  return (ticker, ev) => probs[ticker]?.[ENGINE_EVENTS.indexOf(ev)] ?? null;
}

const EVENT_LABEL: Record<EngineEvent, string> = {
  h7: "+50% in 7 dagen", h14: "+50% in 14 dagen", h21: "+50% in 21 dagen",
  k30: "spike in 30 dagen", k90: "spike in 90 dagen", p30: "poefie in 30 dagen", p90: "poefie in 90 dagen",
  rk: "+150%-maand in 6 mnd",
};
const MARKET_LABEL: Record<string, string> = {
  america: "VS", canada: "Canada", uk: "VK", germany: "Duitsland", france: "Frankrijk", netherlands: "Nederland",
  belgium: "België", italy: "Italië", spain: "Spanje", portugal: "Portugal", poland: "Polen", switzerland: "Zwitserland",
  sweden: "Zweden", norway: "Noorwegen", denmark: "Denemarken", finland: "Finland", australia: "Australië",
  hongkong: "Hongkong", japan: "Japan", singapore: "Singapore",
};
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v.toFixed(d)}%`);
const fmtN = (n: number) => n.toLocaleString("nl-NL");
function probOf(it: EngineItem, ev: EngineEvent): number | null { return it[`p_${ev}` as const]; }
function fmtPrice(v: number | null, cur: string | null): string {
  if (v == null) return "—";
  const s = v < 1 ? v.toFixed(4) : v < 10 ? v.toFixed(3) : v.toFixed(2);
  return cur && cur !== "USD" ? `${s} ${cur}` : `$${s}`;
}

function CalibBars({ m }: { m: EngineModel }) {
  const rows = m.calib.filter((c) => c.n > 0);
  if (!rows.length) return <div className="text-[11px] text-neutral-500">Nog geen kalibratie: die ontstaat bij de tweede meetronde, zodra er lifts zijn om mee te voorspellen.</div>;
  const max = Math.max(...rows.map((c) => Math.max(c.rate_pct ?? 0, (c.lo + c.hi) / 2)), 1);
  return (
    <div>
      <div className="flex items-end gap-2 h-28">
        {rows.map((c) => (
          <div key={c.bucket} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div className="text-[10px] font-mono tabular-nums text-fog-lime font-bold">{pct(c.rate_pct)}</div>
            <div className="w-full flex items-end gap-px" style={{ height: "72px" }}>
              <div className="flex-1 rounded-t bg-ink-5/70" style={{ height: `${Math.max(3, ((c.lo + c.hi) / 2 / max) * 100)}%` }} title={`model zei ${c.lo}–${c.hi}%`} />
              <div className="flex-1 rounded-t bg-gradient-to-t from-fog-pink/30 to-fog-lime/70" style={{ height: `${Math.max(3, ((c.rate_pct ?? 0) / max) * 100)}%` }} title={`${fmtN(c.hits)} van ${fmtN(c.n)} dagen`} />
            </div>
            <div className="text-[10px] text-neutral-500 whitespace-nowrap">{c.lo}–{c.hi}%</div>
            <div className="text-[9px] text-neutral-600 whitespace-nowrap">n={fmtN(c.n)}</div>
          </div>
        ))}
      </div>
      <div className="mt-1 text-[11px] text-neutral-500 text-center">Grijs = wat het model zei, gekleurd = hoe vaak het écht gebeurde. De getoonde kans per aandeel is de gekleurde waarde.</div>
    </div>
  );
}

function LiftGrid({ m }: { m: EngineModel }) {
  const [showAll, setShowAll] = useState(false);
  const feats = [...m.features].sort((a, b) => Number(b.used) - Number(a.used) || b.max_lift - a.max_lift);
  const shown = showAll ? feats : feats.filter((f) => f.used);
  return (
    <div className="space-y-2">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((f) => (
          <div key={f.key} className={`rounded border p-2 ${f.used ? "border-fog-lime/30" : "border-ink-5/60 opacity-60"}`}>
            <div className="flex items-center justify-between text-[11px] font-bold text-neutral-300 mb-1">
              <span>{f.label}</span>
              <span className={f.used ? "text-fog-lime" : "text-neutral-500"}>{f.used ? "telt mee" : "te zwak"}</span>
            </div>
            <table className="w-full text-[11px]"><tbody>
              {f.buckets.map((b) => (
                <tr key={b.slot} className="border-t border-ink-5/40">
                  <td className="py-0.5 pr-2 text-neutral-400 whitespace-nowrap">{b.bucket}</td>
                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-neutral-500">{fmtN(b.n)}d</td>
                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-neutral-300">{pct(b.rate_pct)}</td>
                  <td className={`py-0.5 text-right font-mono tabular-nums font-bold ${b.lift >= 1.5 ? "text-fog-lime" : b.lift <= 0.67 ? "text-fog-loss" : "text-neutral-400"}`}>×{b.lift.toFixed(2)}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        ))}
      </div>
      <button className="text-[11px] text-neutral-400 hover:text-neutral-200" onClick={() => setShowAll((s) => !s)}>
        {showAll ? "▾ alleen kenmerken die meetellen" : `▸ toon ook de ${feats.filter((f) => !f.used).length} kenmerken die te zwak bleken`}
      </button>
    </div>
  );
}

export function EngineInsight({ events, criterion, hit, title }: {
  events: EngineEvent[];
  criterion?: string;          // backtest-rij die bij dit tabblad hoort
  hit?: EngineHit;             // toon aandelen die nu aan dit criterium voldoen
  title?: string;
}) {
  const [ov, setOv] = useState<EngineOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [ev, setEv] = useState<EngineEvent>(events[events.length - 1]);
  const [scope, setScope] = useState<EngineScope>("universum");
  const [items, setItems] = useState<EngineItem[] | null>(null);
  useEffect(() => { loadOverview().then(setOv).catch((e) => setErr(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(() => {
    if (!open || !hit) return;
    setItems(null);
    fetchEngineList({ hit, sort: ev, scope, limit: 300 }).then(setItems).catch(() => setItems([]));
  }, [open, hit, ev, scope]);

  const m = ov?.models[ev];
  const tr = ov?.track_record?.[ev];
  const cov = ov?.coverage;
  const summary = useMemo(() => events.map((e) => {
    const mm = ov?.models[e];
    if (!mm) return null;
    const top = mm.calib.filter((c) => c.n >= 1000 && c.rate_pct != null).at(-1);
    return `${EVENT_LABEL[e]}: basis ${pct(mm.base_rate, 2)}${top ? `, beste groep ${pct(top.rate_pct)}` : ""}`;
  }).filter(Boolean).join(" · "), [ov, events]);

  if (err) return <Card className="p-3 text-xs text-neutral-500">Explosie-motor: nog geen gegevens ({err}).</Card>;
  if (!ov) return null;
  const hitInfo = hit && cov?.hits?.[hit];
  return (
    <Card className="overflow-hidden">
      <button className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="text-xl leading-none">📐</span>
        <span className="flex-1 min-w-0">
          <span className="font-semibold text-neutral-100">{title ?? "Voorspellende waarde — gemeten"}</span>
          <span className="block text-[11px] text-neutral-400 truncate">
            {summary || "wordt nog gemeten"}
            {hitInfo ? ` · nu ${fmtN(hitInfo.all)} aandelen die voldoen, waarvan ${fmtN(hitInfo.outside)} buiten de watchlist` : ""}
          </span>
        </span>
        <span className="text-[11px] text-neutral-400 shrink-0">{open ? "▾ inklappen" : "▸ openklappen"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          {events.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {events.map((e) => <Pill key={e} active={ev === e} onClick={() => setEv(e)}>{EVENT_LABEL[e]}</Pill>)}
            </div>
          )}
          {!m ? (
            <div className="text-xs text-neutral-500">Voor {EVENT_LABEL[ev]} is nog niet genoeg gemeten. De deep-scan werkt eerst de watchlist af; het model verschijnt zodra er ~150 aandelen in de pool zitten.</div>
          ) : (
            <>
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                <Stat label="Basiskans" value={pct(m.base_rate, 2)} hint={`${fmtN(m.hits)} van ${fmtN(m.days_n)} handelsdagen, ${fmtN(m.tickers)} aandelen`} />
                <Stat label="Plafond" value={pct(m.ceiling)} hint="hoogste gemeten kans in een kansgroep (≥1000 dagen)" tone="lime" />
                <Stat label="Kenmerken" value={`${m.features.filter((f) => f.used).length} / ${m.features.length}`} hint="met ≥1,5× verschil; de rest telt niet mee" />
                <Stat label="Track record" value={tr && tr.resolved ? `${tr.hits}/${tr.resolved}` : "—"}
                  hint={tr && tr.resolved ? `${pct((100 * tr.hits) / tr.resolved)} uitgekomen bij gem. voorspelde ${pct(tr.avg_prob)}` : tr ? `${fmtN(tr.made)} voorspellingen lopen nog` : "start bij de eerste dagelijkse run"} />
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-1">Backtest: vaste criteria op 10 jaar historie → {EVENT_LABEL[ev]}</div>
                <table className="w-full text-xs">
                  <thead><tr className="text-neutral-500 text-[10px] uppercase"><th className="text-left py-1">Criterium</th><th className="text-right">Dagen</th><th className="text-right">Kans</th><th className="text-right">× basis</th></tr></thead>
                  <tbody>
                    {m.backtest.map((b) => (
                      <tr key={b.key} className={`border-t border-ink-5/40 ${b.key === criterion ? "bg-fog-pink/10 font-semibold" : ""}`}>
                        <td className="py-1 text-neutral-300">{b.label}</td>
                        <td className="text-right font-mono tabular-nums text-neutral-500">{fmtN(b.n)}</td>
                        <td className="text-right font-mono tabular-nums text-neutral-200">{b.n ? pct(b.rate_pct) : "—"}</td>
                        <td className={`text-right font-mono tabular-nums ${b.lift != null && b.lift >= 1.5 ? "text-fog-lime" : "text-neutral-400"}`}>{b.lift != null && b.n ? `×${b.lift.toFixed(1)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-1">Kalibratie</div>
                <CalibBars m={m} />
              </div>
              {tr && tr.buckets.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-1">Track record per kansgroep (vooruit gemeten, niet aan te sleutelen)</div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {tr.buckets.map((b) => (
                      <span key={b.bucket} className="rounded border border-ink-5/60 px-2 py-1 text-neutral-300">
                        {b.bucket}%: <b className="text-fog-lime">{b.hits}/{b.n}</b> ({pct((100 * b.hits) / b.n)}; voorspeld {pct(b.avg_prob)})
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-1">Wat telt mee (lift per bucket)</div>
                <LiftGrid m={m} />
              </div>
            </>
          )}

          {hit && (
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mr-2">Nu aan het criterium: {items ? items.length : "…"}</div>
                {(["universum", "watchlist", "alles"] as EngineScope[]).map((s) => (
                  <Pill key={s} active={scope === s} onClick={() => setScope(s)}>{s === "universum" ? "buiten watchlist" : s}</Pill>
                ))}
              </div>
              {items && items.length > 0 && (
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-ink-2"><tr className="text-neutral-500 text-[10px] uppercase">
                      <th className="text-left py-1">Aandeel</th><th className="text-left">Markt</th><th className="text-right">Koers</th>
                      <th className="text-right">1W</th><th className="text-right">{EVENT_LABEL[ev]}</th><th className="text-left pl-3">Waarom</th>
                    </tr></thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.ticker} className="border-t border-ink-5/40">
                          <td className="py-1">
                            <a className="font-mono font-bold text-neutral-100 hover:text-fog-pink" href={googleFinanceUrl(it.ticker, it.exchange)} target="_blank" rel="noreferrer">{it.ticker}</a>
                            <span className="block text-[10px] text-neutral-500 truncate max-w-[220px]">{it.name}</span>
                          </td>
                          <td className="text-neutral-400">{MARKET_LABEL[it.market ?? ""] ?? it.market ?? "—"}</td>
                          <td className="text-right font-mono tabular-nums text-neutral-300">{fmtPrice(it.close, it.currency)}</td>
                          <td className={`text-right font-mono tabular-nums ${(it.perf_w ?? 0) >= 0 ? "text-fog-gain" : "text-fog-loss"}`}>{it.perf_w != null ? `${it.perf_w >= 0 ? "+" : ""}${it.perf_w.toFixed(0)}%` : "—"}</td>
                          <td className="text-right font-mono tabular-nums font-bold text-fog-lime">{pct(probOf(it, ev))}</td>
                          <td className="pl-3 text-[11px] text-neutral-400">
                            {it.added_at ? <span className="text-fog-pink font-semibold">toegevoegd {ago(it.added_at)} · </span> : it.in_watchlist ? <span className="text-neutral-300">watchlist · </span> : null}
                            {(it.hits ?? []).join(", ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {cov && (
            <div className="text-[11px] text-neutral-500 border-t border-ink-5/40 pt-2">
              Universum: {fmtN(cov.tv)} aandelen op 20 beurzen · {fmtN(cov.deep_ok)} volledig doorgemeten ({cov.tv ? Math.round((100 * cov.deep_ok) / cov.tv) : 0}%), nog {fmtN(cov.pending_scan)} in de wachtrij ·
              pool {fmtN(cov.pool_tickers)} aandelen · {fmtN(cov.added_total)} automatisch toegevoegd ({cov.added_today} vandaag)
              {cov.sweep_at ? ` · sweep ${ago(cov.sweep_at)}` : ""}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
