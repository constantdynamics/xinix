import { Fragment, useCallback, useEffect, useState } from "react";
import {
  fetchSprinters,
  triggerSprintRun,
  getToken,
  type SprintItem,
  type SprintNewsLift,
  type SprintResponse,
  type SprintTrackRecord,
} from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, Stat, CollapsibleIntro, toast } from "../components/ui";
import { StarRating } from "../components/MarkCells";

// Favorieten → Sprinters: je aandelen met ≥4★ gerangschikt op de kans dat ze
// binnen 10 handelsdagen ≥ +50% doen. Berekend door xinix-sprint (elke 2 uur
// op werkdagen), met verse koersen en gemeten nieuws.

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
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function probTone(p: number, threshold: number): string {
  if (threshold > 0 && p >= threshold) return "text-fog-lime font-bold";
  if (p >= 10) return "text-emerald-300 font-semibold";
  if (p >= 5) return "text-neutral-200";
  return "text-neutral-400";
}

function NewsLiftCard({ lifts }: { lifts: SprintNewsLift[] }) {
  if (!lifts.length) {
    return (
      <Card className="p-4 text-[11px] text-neutral-500">
        Nieuws wordt nog gemeten: per bericht sinds mei wordt nagegaan of er binnen 10 handelsdagen +50% volgde. Zodra
        een nieuwssoort genoeg berichten heeft, verschijnt hier zijn gemeten effect.
      </Card>
    );
  }
  return (
    <Card className="p-4 space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold">Wat nieuws gemeten doet</div>
      <table className="w-full text-[11px]">
        <thead className="text-neutral-500 border-b border-ink-5/60">
          <tr>
            <th className="py-1 text-left font-bold">Soort nieuws</th>
            <th className="py-1 text-right font-bold">Berichten</th>
            <th className="py-1 text-right font-bold">Daarna +50%</th>
            <th className="py-1 text-right font-bold">Effect</th>
            <th className="py-1 text-right font-bold">Telt mee</th>
          </tr>
        </thead>
        <tbody>
          {lifts.map((l) => (
            <tr key={l.grp} className="border-t border-ink-5/40">
              <td className="py-0.5 pr-2 text-neutral-300">{l.label}</td>
              <td className="py-0.5 text-right font-mono tabular-nums text-neutral-500">{l.n.toLocaleString("nl-NL")}</td>
              <td className="py-0.5 text-right font-mono tabular-nums text-neutral-400">
                {l.hits} ({l.rate_pct != null ? `${Number(l.rate_pct).toFixed(1)}%` : "—"})
              </td>
              <td
                className={`py-0.5 text-right font-mono tabular-nums ${
                  (l.lift ?? 1) >= 1.5 ? "text-fog-lime font-semibold" : (l.lift ?? 1) <= 1 / 1.5 ? "text-fog-loss" : "text-neutral-500"
                }`}
              >
                ×{l.lift != null ? Number(l.lift).toFixed(2) : "—"}
              </td>
              <td className="py-0.5 text-right">{l.used ? "✅" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[11px] text-neutral-500 leading-relaxed">
        Effect = hoe vaak er ná zo'n bericht binnen 10 handelsdagen +50% volgde, gedeeld door hoe vaak dat bij
        dezelfde aandelen op een willekeurige dag gebeurt. Gemeten en toegepast alleen op je ≥4★-aandelen, over hun
        berichten sinds mei. Een soort telt pas mee bij minstens 30 berichten en 5 treffers, en een effect van ×1,5 of meer
        (of ×0,67 of minder). Nieuws van de laatste 7 dagen telt; het totale nieuwseffect is begrensd op ×3.
      </div>
    </Card>
  );
}

function TrackCard({ track }: { track: SprintTrackRecord | null }) {
  if (!track || track.total === 0) return null;
  const sinds = track.since ? new Date(track.since).toLocaleDateString("nl-NL", { day: "numeric", month: "long" }) : null;
  const rows = track.buckets.filter((b) => b.n + b.open > 0);
  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <div className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold">Track record</div>
        <div className="text-[11px] text-neutral-500">
          sinds {sinds} · {track.resolved.toLocaleString("nl-NL")} afgerekend · {track.open.toLocaleString("nl-NL")} lopend
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Stat label="Afgerekend" value={track.resolved.toLocaleString("nl-NL")} />
        <Stat label="Raak" value={track.hits.toLocaleString("nl-NL")} hint="+50% en hield stand" />
        <Stat label="Meldingen" value={`${track.alerts.hits}/${track.alerts.n}`} hint={`raak / afgerekend (${track.alerts.open} lopend)`} />
      </div>
      {rows.length > 0 && (
        <table className="w-full text-[11px]">
          <thead className="text-neutral-500 border-b border-ink-5/60">
            <tr>
              <th className="py-1 text-left font-bold">Kans vooraf</th>
              <th className="py-1 text-right font-bold">Afgerekend</th>
              <th className="py-1 text-right font-bold">Lopend</th>
              <th className="py-1 text-right font-bold">Voorspeld</th>
              <th className="py-1 text-right font-bold">Werkelijk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.bucket} className="border-t border-ink-5/40">
                <td className="py-0.5 text-neutral-400">{b.bucket}%</td>
                <td className="py-0.5 text-right font-mono tabular-nums text-neutral-500">{b.n}</td>
                <td className="py-0.5 text-right font-mono tabular-nums text-neutral-600">{b.open}</td>
                <td className="py-0.5 text-right font-mono tabular-nums text-neutral-400">{b.avg_prob != null ? `${b.avg_prob}%` : "—"}</td>
                <td className="py-0.5 text-right font-mono tabular-nums text-fog-lime font-semibold">{b.rate_pct != null ? `${b.rate_pct}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="text-[11px] text-neutral-500 leading-relaxed">
        Elke dag wordt per aandeel de kans van dat moment vastgelegd met de koers erbij; na 10 handelsdagen valt het
        oordeel: haalde de slotkoers +50% en stond hij de dag erna nog minstens +20%? Dat is het enige cijfer waar
        achteraf niet aan te sleutelen valt.
      </div>
    </Card>
  );
}

function Detail({ r }: { r: SprintItem }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 text-[11px] p-3 bg-ink-2/40">
      <div className="space-y-1">
        <div className="font-bold text-neutral-300">Waarom (gemeten effect van de huidige toestand)</div>
        {(r.factors ?? []).length === 0 && <div className="text-neutral-500">Geen kenmerk staat nu duidelijk boven gemiddeld.</div>}
        {(r.factors ?? []).map((f) => (
          <div key={f.label} className="flex gap-2">
            <span className="font-mono tabular-nums text-fog-lime w-12 shrink-0">×{f.mult.toFixed(2)}</span>
            <span className="text-neutral-300">{f.label}</span>
            <span className="text-neutral-500">{f.bucket}</span>
          </div>
        ))}
        <div className="text-neutral-500 pt-1">
          7 dagen {r.prob_7d ?? "—"}% · 10 handelsdagen {r.prob_model ?? "—"}% (zonder nieuws) · 21 dagen {r.prob_21d ?? "—"}%
        </div>
      </div>
      <div className="space-y-1">
        <div className="font-bold text-neutral-300">Nieuws (laatste 30 dagen)</div>
        {(r.news ?? []).length === 0 && <div className="text-neutral-500">Geen nieuws gevonden.</div>}
        {(r.news ?? []).map((n, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-neutral-500 w-14 shrink-0">{fmtDate(n.date)}</span>
            <span className={n.counts ? "text-fog-lime" : "text-neutral-400"}>
              {n.counts ? `×${n.lift} ` : ""}
              {n.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SprintersView() {
  const [data, setData] = useState<SprintResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchSprinters());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function runNow() {
    setRefreshing(true);
    try {
      const r = await triggerSprintRun();
      toast(r.message ?? "Klaar");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  const threshold = data?.settings?.sprint_alert_min_prob ?? 15;
  const minRating = data?.settings?.sprint_min_rating ?? 4;
  const items = data?.items ?? [];
  const measured = items.filter((r) => r.prob != null);
  const above = measured.filter((r) => (r.prob ?? 0) >= threshold).length;
  const base = data?.model?.base_rate ?? null;
  const ceiling = data?.model?.ceiling ?? null;

  return (
    <div className="space-y-4">
      <CollapsibleIntro title="Sprinters" icon={<span className="text-xl">⚡</span>}>
        <p className="text-sm text-neutral-300 leading-relaxed">
          Je aandelen met minstens {"★".repeat(minRating)} gerangschikt op de kans dat ze binnen{" "}
          <strong>10 handelsdagen minimaal +50%</strong> stijgen (en een dag later nog minstens +20% staan). De kans
          komt uit 10 jaar dagkoersen van ~6000 aandelen, elke 2 uur op werkdagen opnieuw berekend met verse koersen,
          en aangevuld met nieuws dat aantoonbaar verschil maakt, zoals biotech-goedkeuringen of sterke boorresultaten.
          Vanaf {threshold}% krijg je meteen een ntfy-melding (hoogstens {data?.settings?.sprint_alert_max_per_week ?? 3}{" "}
          per week).
        </p>
        <p className="text-xs text-neutral-500 leading-relaxed mt-2">
          Eerlijk over wat haalbaar is: gemiddeld haalt een aandeel dit op {base != null ? `${base}%` : "~2,5%"} van de
          dagen. De allerhoogste kansklasse die ooit gemeten is komt uit op{" "}
          {ceiling != null ? `${ceiling}%` : "~20%"}. Zekerheid bestaat hier niet; een melding betekent dat de kans
          vele malen hoger is dan normaal, niet dat het gaat gebeuren.
        </p>
      </CollapsibleIntro>

      <div className="flex flex-wrap items-center gap-3">
        <Stat label="Aandelen" value={`${measured.length}/${items.length}`} hint="gemeten / met genoeg sterren" />
        <Stat label="Boven drempel" value={String(above)} hint={`≥ ${threshold}%`} />
        <Stat label="Hoogste nu" value={measured.length ? `${Math.max(...measured.map((r) => r.prob ?? 0)).toFixed(1)}%` : "—"} />
        <Stat label="Basiskans" value={base != null ? `${base}%` : "—"} hint="gemiddeld aandeel" />
        <Stat label="Plafond" value={ceiling != null ? `${ceiling}%` : "—"} hint="hoogste gemeten klasse" />
        <div className="text-[11px] text-neutral-500">bijgewerkt {fmtTime(data?.computed_at ?? null)}</div>
        {getToken() && (
          <Button onClick={runNow} disabled={refreshing}>
            {refreshing ? "Bezig…" : "Nu doorrekenen"}
          </Button>
        )}
      </div>

      {error && <Card className="p-4 text-fog-loss text-sm">{error}</Card>}
      {loading && !data && <Card className="p-4 text-sm text-neutral-400">Laden…</Card>}

      {data && (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] text-neutral-500 border-b border-ink-5/60">
              <tr>
                <th className="px-3 py-2 text-left">Aandeel</th>
                <th className="px-3 py-2 text-left">★</th>
                <th className="px-3 py-2 text-right">Kans</th>
                <th className="px-3 py-2 text-right">× basis</th>
                <th className="px-3 py-2 text-right">Nieuws</th>
                <th className="px-3 py-2 text-right">Koers</th>
                <th className="px-3 py-2 text-right">1d</th>
                <th className="px-3 py-2 text-right">5d</th>
                <th className="px-3 py-2 text-left">Sterkste reden</th>
                <th className="px-3 py-2 text-right">Gemeld</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r, i) => {
                const open = expanded === r.ticker;
                const p = r.prob;
                return (
                  <Fragment key={r.ticker}>
                    <tr
                      onClick={() => setExpanded(open ? null : r.ticker)}
                      className={`border-t border-ink-5/40 cursor-pointer hover:bg-white/[0.04] ${i % 2 ? "bg-white/[0.022]" : ""}`}
                    >
                      <td className="px-3 py-1.5">
                        <a
                          href={googleFinanceUrl(r.ticker, r.exchange)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-bold text-neutral-100 hover:text-fog-pink"
                        >
                          {r.ticker}
                        </a>
                        <div className="text-[11px] text-neutral-500 truncate max-w-[16rem]">{r.company ?? ""}</div>
                      </td>
                      <td className="px-3 py-1.5">
                        <StarRating ticker={r.ticker} />
                      </td>
                      <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${p != null ? probTone(p, threshold) : "text-neutral-600"}`}>
                        {p != null ? `${p.toFixed(1)}%` : r.measured ? "—" : "nog niet gemeten"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-neutral-400">
                        {p != null && r.base_rate ? `${(p / r.base_rate).toFixed(1)}×` : "—"}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right font-mono tabular-nums ${
                          (r.news_mult ?? 1) > 1 ? "text-fog-lime" : (r.news_mult ?? 1) < 1 ? "text-fog-loss" : "text-neutral-600"
                        }`}
                      >
                        {r.news_mult != null && r.news_mult !== 1 ? `×${r.news_mult}` : (r.news ?? []).length ? "·" : ""}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-neutral-300">{fmtPrice(r.close)}</td>
                      <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${(r.change_1d ?? 0) >= 0 ? "text-fog-gain" : "text-fog-loss"}`}>
                        {fmtPct(r.change_1d)}
                      </td>
                      <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${(r.perf_w ?? 0) >= 0 ? "text-fog-gain" : "text-fog-loss"}`}>
                        {fmtPct(r.perf_w)}
                      </td>
                      <td className="px-3 py-1.5 text-[11px] text-neutral-400">
                        {r.factors?.[0] ? `×${r.factors[0].mult.toFixed(1)} ${r.factors[0].label}: ${r.factors[0].bucket}` : ""}
                      </td>
                      <td className="px-3 py-1.5 text-right text-[11px] text-neutral-500">
                        {r.alerted_at ? `🚀 ${fmtDate(r.alerted_at)}` : ""}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={10} className="p-0">
                          <Detail r={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {data && <TrackCard track={data.track_record} />}
      {data && <NewsLiftCard lifts={data.news_lift} />}
    </div>
  );
}
