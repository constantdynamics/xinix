import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchSuperSprint,
  fetchSuperSprintTest,
  getToken,
  superSprintAdopt,
  superSprintSettings,
  type SprintTrackRecord,
  type SuperSprintItem,
  type SuperSprintResponse,
  type SuperSprintTest,
  type SuperSprintTestModel,
} from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, Stat, CollapsibleIntro, toast } from "../components/ui";
import { useMarks } from "../hooks/useMarks";
import { HeartIcon, SeenInline, ShowSeenToggle } from "../components/MarkCells";

// Favorieten → SUPERsprinters: alle aandelen op de beurzen die Saxo aanbiedt, gerangschikt op de
// kans dat ze binnen 10 handelsdagen ≥ +50% doen. Berekend door xinix-supersprint: drie rondes per
// handelsdag, elk kort na het slot van de eigen beurzen. Keuzes van de gebruiker (13 november 2026):
// koers vanaf $0,50, omzet vanaf $10.000 per dag, meldingen vanaf 15% en hoogstens 3 per week,
// hartje = favoriet en op de watchlist maar niet in het Potje en de papieren portefeuille.

const REGIONS = ["VS", "Canada", "Europa", "Azië-Pacific"];
const ROUND_OF = ["amerika", "amerika", "europa", "apac"];
const BASE_RATE = 0.74; // % van de dagen in 2025–2026 (public/ss-model.json, base_rate_pct)
const NEWS_LABEL: Record<string, string> = {
  emissie: "uitgifte van aandelen", medisch: "medisch nieuws", overname: "overname of fusie", contract: "contract of samenwerking",
  cijfers: "cijfers", crypto: "crypto", ai: "AI", split: "omgekeerde split of noteringsbrief", overig: "overig",
};

const nl = (v: number, d = 1) => v.toFixed(d).replace(".", ",");
function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  return nl(v, v < 1 ? 4 : v < 10 ? 3 : 2);
}
function fmtPct(v: number | null, d = 1): string {
  if (v == null) return "—";
  return `${v < 0 ? "−" : "+"}${nl(Math.abs(v), d)}%`;
}
function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e9) return `$${nl(v / 1e9)} mrd`;
  if (v >= 1e6) return `$${nl(v / 1e6)} mln`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
}
function fmtCount(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e9) return `${nl(v / 1e9)} mrd`;
  if (v >= 1e6) return `${nl(v / 1e6)} mln`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(Math.round(v));
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
  if (p >= threshold) return "text-fog-lime font-extrabold";
  if (p >= 10) return "text-emerald-300 font-bold";
  if (p >= 5) return "text-neutral-100 font-semibold";
  return "text-neutral-400";
}
const pctTone = (v: number | null) => (v == null ? "text-neutral-500" : v >= 0 ? "text-fog-gain" : "text-fog-loss");

function Detail({ r, threshold }: { r: SuperSprintItem; threshold: number }) {
  const reasons = r.reasons ?? [];
  const news = r.news ?? [];
  return (
    <div className="grid gap-4 md:grid-cols-2 text-xs p-3 bg-ink-2/40">
      <div className="space-y-1.5">
        <div className="font-bold text-neutral-300">Waarom (effect van elk kenmerk op de kans)</div>
        {reasons.length === 0 && <div className="text-neutral-500">Geen kenmerk wijkt duidelijk af van een doorsnee aandeel.</div>}
        {reasons.map((f) => (
          <div key={f.g} className="flex gap-2">
            <span className={`font-mono tabular-nums w-14 shrink-0 ${f.f >= 1 ? "text-fog-lime" : "text-fog-loss"}`}>×{nl(f.f, f.f >= 10 ? 0 : 1)}</span>
            <span>
              <span className="text-neutral-200">{f.label}</span> <span className="text-neutral-500">{f.t}</span>
            </span>
          </div>
        ))}
        <div className="text-neutral-500 pt-1 leading-relaxed">
          Slot {fmtPrice(r.close)} {r.currency ?? ""}
          {r.currency !== "USD" && r.close_usd != null ? ` (≈ $${nl(r.close_usd, r.close_usd < 10 ? 2 : 0)})` : ""} · omzet {fmtUsd(r.dvol_usd)} per dag ·
          beurswaarde {fmtUsd(r.mcap_usd)} · vrij verhandelbaar {fmtCount(r.float_shares)} aandelen
          {r.rel_vol != null ? ` · volume ${nl(r.rel_vol)}× normaal` : ""}
          {r.first_seen ? ` · in de kopgroep sinds ${fmtDate(r.first_seen)}` : ""}
          {r.prob_base != null && Math.abs(r.prob_base - r.prob) >= 0.3 ? ` · zonder bijsturing ${nl(r.prob_base)}%` : ""}
        </div>
        {(r.alerted_at || r.alert_note || r.alert_pending) && (
          <div className="text-neutral-400">
            {r.alerted_at ? `🚀 Gemeld op ${fmtTime(r.alerted_at)} bij ${nl(Number(r.alerted_prob ?? 0), 0)}%. ` : ""}
            {r.alert_pending ? "Kandidaat voor de eerstvolgende ochtendmelding (de hoogste kansen gaan voor). " : r.alert_note ? `${r.alert_note}.` : ""}
          </div>
        )}
        {r.prob >= threshold && (r.dvol_usd ?? 0) < 100_000 && (
          <div className="text-amber-300">Let op: de omzet is laag ({fmtUsd(r.dvol_usd)} per dag). Een grotere order beweegt de koers.</div>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="font-bold text-neutral-300">Nieuws (laatste twee weken, Yahoo)</div>
        {news.length === 0 && <div className="text-neutral-500">{r.news_at ? "Geen nieuws gevonden." : "Nieuws wordt alleen opgehaald voor de bovenste aandelen van een ronde."}</div>}
        {news.map((n, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-neutral-500 w-14 shrink-0">{fmtDate(n.d)}</span>
            <span>
              {n.u ? (
                <a href={n.u} target="_blank" rel="noreferrer" className="text-neutral-200 hover:text-fog-pink">
                  {n.t}
                </a>
              ) : (
                <span className="text-neutral-200">{n.t}</span>
              )}
              <span className="text-neutral-500"> · {NEWS_LABEL[n.g] ?? n.g}</span>
            </span>
          </div>
        ))}
        <div className="text-neutral-500 pt-1">
          Nieuws telt nog niet mee in de kans: eerst wordt gemeten of een soort nieuws aantoonbaar verschil maakt.
        </div>
      </div>
    </div>
  );
}

function TrackCard({ title, track: raw, note }: { title: string; track: SprintTrackRecord | null; note: string }) {
  // Een antwoord zonder de verwachte velden telt als "nog geen track record".
  const track = raw && typeof raw.total === "number" && typeof raw.resolved === "number" && raw.alerts ? raw : null;
  const rows = (track?.buckets ?? []).filter((b) => b.n + b.open > 0);
  const sinds = track?.since ? new Date(track.since).toLocaleDateString("nl-NL", { day: "numeric", month: "long" }) : null;
  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-bold">{title}</div>
        {track && track.total > 0 && (
          <div className="text-[11px] text-neutral-500">
            sinds {sinds} · {track.resolved.toLocaleString("nl-NL")} afgerekend · {track.open.toLocaleString("nl-NL")} lopend
          </div>
        )}
      </div>
      {!track || track.total === 0 ? (
        <div className="text-xs text-neutral-500">Nog geen voorspellingen vastgelegd.</div>
      ) : (
        <>
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
                    <td className="py-0.5 text-right font-mono tabular-nums text-neutral-400">{b.avg_prob != null ? `${nl(Number(b.avg_prob))}%` : "—"}</td>
                    <td className="py-0.5 text-right font-mono tabular-nums text-fog-lime font-semibold">{b.rate_pct != null ? `${nl(Number(b.rate_pct))}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <div className="text-[11px] text-neutral-500 leading-relaxed">{note}</div>
    </Card>
  );
}

function TestCard({ test }: { test: SuperSprintTest }) {
  const h = test.holdout;
  const band = (m: SuperSprintTestModel, b: string) => {
    const c = m.calib.find((x) => x.band === b);
    return c && c.pred != null && c.real != null ? `${nl(c.pred)}% → ${nl(c.real)}%` : "komt niet voor";
  };
  const alerts = (m: SuperSprintTestModel) =>
    m.alerts.hit_pct != null ? `${nl(m.alerts.hit_pct)}% (${m.alerts.hits} van ${m.alerts.resolved})` : "geen meldingen";
  const rows: Array<[string, string, string, string]> = [
    ["Meldingen raak", "vanaf 15%, hoogstens 3 per week", alerts(h.oudA), alerts(h.new)],
    ["Top 5 per dag raak", "de vijf hoogste kansen van elke dag", `${nl(h.oudA.top5.hit_pct)}%`, `${nl(h.new.top5.hit_pct)}%`],
    ["Top 10 per dag raak", "", `${nl(h.oudA.top10.hit_pct)}%`, `${nl(h.new.top10.hit_pct)}%`],
    ["Al in de top 50 vóór de sprong", "de dag vóór de eerste dag met +20% of meer", `${nl(h.oudA.lead.top50_day_before_pct)}%`, `${nl(h.new.lead.top50_day_before_pct)}%`],
    ["Voorspeld 10–15%", "voorspeld → werkelijk", band(h.oudA, "10–15%"), band(h.new, "10–15%")],
    ["Voorspeld 15–25%", "voorspeld → werkelijk", band(h.oudA, "15–25%"), band(h.new, "15–25%")],
  ];
  return (
    <Card className="p-4 space-y-3">
      <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-bold">Eerlijke test op 2025–2026</div>
      <table className="w-full text-xs">
        <thead className="text-neutral-500 border-b border-ink-5/60">
          <tr>
            <th className="py-1 text-left font-bold">Maatstaf</th>
            <th className="py-1 text-right font-bold">Model van Sprinters</th>
            <th className="py-1 text-right font-bold">SUPERsprinters</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, hint, a, b]) => (
            <tr key={label} className="border-t border-ink-5/40 align-top">
              <td className="py-1 pr-2">
                <div className="text-neutral-200">{label}</div>
                {hint && <div className="text-[10px] text-neutral-500">{hint}</div>}
              </td>
              <td className="py-1 text-right font-mono tabular-nums text-neutral-400 whitespace-nowrap">{a}</td>
              <td className="py-1 text-right font-mono tabular-nums text-fog-lime font-semibold whitespace-nowrap">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[11px] text-neutral-500 leading-relaxed">
        Beide modellen op dezelfde aandelen en dagen: {(h.new.n / 1e6).toFixed(1).replace(".", ",")} miljoen aandelen-dagen met{" "}
        {h.new.explosions.toLocaleString("nl-NL")} explosies. SUPERsprinters had deze twee jaren niet gezien; het model van Sprinters wel.
        Opeenvolgende trefdagen van hetzelfde aandeel tellen als één explosie. Niet meegeteld: aandelen die inmiddels van de beurs zijn.
        Het volledige verslag staat in docs/supersprinters-rapport.md.
      </div>
    </Card>
  );
}

export function SuperSprintersView({ onAdopted }: { onAdopted?: () => void }) {
  const marks = useMarks();
  const [data, setData] = useState<SuperSprintResponse | null>(null);
  const [test, setTest] = useState<SuperSprintTest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState<number | null>(null);
  const [minProb, setMinProb] = useState(0);
  const [minDvol, setMinDvol] = useState(0);
  const [showSeen, setShowSeen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Een tik op een melding opent dit tabblad op dat aandeel (?t=TICKER).
  const focus = useMemo(() => new URLSearchParams(window.location.search).get("t")?.trim().toUpperCase() || null, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchSuperSprint());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    fetchSuperSprintTest().then(setTest).catch(() => {});
  }, [load]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const focusRow = focus ? items.find((r) => r.ticker.toUpperCase() === focus) : undefined;
  useEffect(() => {
    if (!focusRow) return;
    setExpanded(focusRow.ticker);
    const t = setTimeout(() => document.getElementById(`ss-${focusRow.ticker}`)?.scrollIntoView({ block: "center" }), 50);
    return () => clearTimeout(t);
  }, [focusRow]);

  const threshold = Number(data?.settings?.ss_alert_min_prob ?? 15) || 15;
  const alertsOn = data?.settings?.ss_alerts === true;
  const enabled = data?.settings?.ss_enabled !== false;
  const isFocus = (r: SuperSprintItem) => focusRow != null && r.ticker === focusRow.ticker;
  const visible = items.filter((r) => isFocus(r) || showSeen || !marks.isSeen(r.ticker));
  const hiddenSeen = items.length - items.filter((r) => !marks.isSeen(r.ticker)).length;
  const shown = visible.filter(
    (r) => isFocus(r) || ((region == null || r.region === region) && r.prob >= minProb && (r.dvol_usd ?? 0) >= minDvol),
  );
  const counts = REGIONS.map((_, g) => visible.filter((r) => r.region === g).length);
  const above = visible.filter((r) => r.prob >= threshold).length;
  const sessions = REGIONS.map((_, g) => {
    const st = data?.state?.[`round:${ROUND_OF[g]}`] as { day?: string } | undefined;
    return st?.day ?? null;
  });
  const today = data?.budget.days[0];
  const brake = data?.state?.brake as { paused_until?: string | null; last_error?: string | null } | undefined;
  const paused = brake?.paused_until && new Date(brake.paused_until).getTime() > Date.now();

  async function heart(r: SuperSprintItem) {
    if (marks.isFavorite(r.ticker)) {
      await marks.toggle("favorite", r.ticker);
      return;
    }
    if (!getToken()) {
      toast("Log eerst in met je beheertoken (Instellingen)", "error");
      return;
    }
    setBusy(r.ticker);
    try {
      const res = await superSprintAdopt(r.ticker);
      await marks.toggle("favorite", r.ticker);
      onAdopted?.();
      toast(res.added ? `${r.ticker} staat nu op de watchlist en bij je favorieten` : `${r.ticker} is favoriet`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }
  async function setSetting(patch: { ss_enabled?: boolean; ss_alerts?: boolean }) {
    setSaving(true);
    try {
      await superSprintSettings(patch);
      await load();
      toast("Opgeslagen");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  }

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-xs font-bold border ${active ? "border-fog-pink text-neutral-50" : "border-ink-5 text-neutral-400 hover:text-neutral-200"}`;

  return (
    <div className="space-y-4">
      <CollapsibleIntro title="SUPERsprinters" icon={<span aria-hidden>⚡</span>}>
        <p className="leading-relaxed">
          Alle aandelen op de beurzen die Saxo aanbiedt (VS, Canada, Europa, Japan, Hongkong, Singapore en Australië) met een
          koers vanaf $0,50 en een omzet vanaf $10.000 per dag, gerangschikt op de kans dat ze binnen{" "}
          <b>10 handelsdagen minimaal +50%</b> stijgen en een dag later nog minstens +20% staan. Dat is dezelfde definitie als
          bij Sprinters, maar dan voor de hele markt in plaats van alleen je favorieten met vier sterren.
        </p>
        <p className="leading-relaxed mt-2">
          Elke handelsdag zijn er drie rondes, steeds kort na het slot van de eigen beurzen: Azië en Australië in de ochtend,
          Europa aan het eind van de middag en de VS en Canada 's avonds. Het model kijkt naar hoe wild een aandeel beweegt,
          waar het in zijn grafiek staat, het volume, de koers, de omzet en het klimaat op de markt. Het is getraind op tien
          jaar dagkoersen van ruim 20.000 aandelen en getest op twee jaren die het niet had gezien (zie onderaan).
        </p>
        <p className="leading-relaxed mt-2">
          <b>Eerlijk over wat haalbaar is.</b> Gemiddeld haalt een aandeel dit op ongeveer {nl(BASE_RATE)}% van de dagen. De
          hoogste kansen liggen rond de 20 à 25%: van vijf meldingen komt er dan gemiddeld één uit. Bovenaan staan vaak kleine,
          hard gevallen aandelen met weinig omzet. Kijk daarom naar de omzet per dag voordat je koopt, en reken erop dat vier
          van de vijf niet raak zijn.
        </p>
        <p className="leading-relaxed mt-2">
          <b>Meldingen</b>: vanaf {threshold}%, hoogstens {data?.settings?.ss_alert_max_per_week ?? 3} per week, en per aandeel
          hoogstens één keer per 10 dagen (tenzij de kans 5 punten hoger is). Ze gaan één keer per dag uit, 's ochtends na de
          stille uren, over de slotstanden van de dag ervoor: alle regio's samen, de hoogste kans eerst. Een tik op de melding
          opent dit tabblad op dat aandeel. <b>Hartje</b>: favoriet en op de watchlist, maar het aandeel doet niet mee in het Potje en de papieren
          portefeuille. <b>Gezien</b> (verrekijker): weg uit deze lijst. Niet meegenomen: de Canadian Securities Exchange en
          Cboe Canada, want die biedt Saxo niet aan; van de Londense AIM is dat niet zeker.
        </p>
      </CollapsibleIntro>

      {!enabled && <Card className="p-3 text-sm text-amber-300">SUPERsprinters staat uit: er worden geen nieuwe rondes gedraaid.</Card>}
      {paused && (
        <Card className="p-3 text-sm text-amber-300">
          Na drie mislukte runs staat SUPERsprinters op de rem tot {fmtTime(brake?.paused_until ?? null)}: {brake?.last_error ?? ""}
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Stat label="Aandelen" value={String(visible.length)} hint="kopgroep van elke regio" />
        <Stat label="Boven de meldgrens" value={String(above)} hint={`≥ ${threshold}%`} />
        <Stat label="Hoogste nu" value={visible.length ? `${nl(Math.max(...visible.map((r) => r.prob)))}%` : "—"} />
        <Stat label="Basiskans" value={`${nl(BASE_RATE)}%`} hint="gemiddeld aandeel" />
        <Stat label="Meldingen" value={alertsOn ? "aan" : "uit"} hint={alertsOn ? "Sprinters meldt niet" : "Sprinters meldt"} tone={alertsOn ? "lime" : undefined} />
      </div>
      <div className="text-[11px] text-neutral-500">
        Laatste sessie: {REGIONS.map((n, g) => `${n} ${sessions[g] ? fmtDate(sessions[g]) : "nog niet"}`).join(" · ")}
        {data?.computed_at ? ` · bijgewerkt ${fmtTime(data.computed_at)}` : ""}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setRegion(null)} className={chip(region == null)}>
          Alle {visible.length}
        </button>
        {REGIONS.map((n, g) => (
          <button key={n} onClick={() => setRegion(region === g ? null : g)} className={chip(region === g)}>
            {n} {counts[g]}
          </button>
        ))}
        <select
          value={minProb}
          onChange={(e) => setMinProb(Number(e.target.value))}
          className="bg-ink-2 border border-ink-5 rounded px-2 py-1 text-xs text-neutral-300"
          aria-label="Minimale kans"
        >
          <option value={0}>alle kansen</option>
          <option value={5}>kans ≥ 5%</option>
          <option value={10}>kans ≥ 10%</option>
          <option value={15}>kans ≥ 15%</option>
        </select>
        <select
          value={minDvol}
          onChange={(e) => setMinDvol(Number(e.target.value))}
          className="bg-ink-2 border border-ink-5 rounded px-2 py-1 text-xs text-neutral-300"
          aria-label="Minimale omzet per dag"
        >
          <option value={0}>alle omzet</option>
          <option value={100000}>omzet ≥ $100k</option>
          <option value={1000000}>omzet ≥ $1 mln</option>
        </select>
        <span className="ml-auto flex items-center gap-2">
          {hiddenSeen > 0 || showSeen ? <ShowSeenToggle showSeen={showSeen} onChange={setShowSeen} /> : null}
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            Vernieuw
          </Button>
        </span>
      </div>

      {error && <Card className="p-4 text-fog-loss text-sm">{error}</Card>}
      {loading && !data && <Card className="p-4 text-sm text-neutral-400">Laden…</Card>}
      {focus && data && !focusRow && (
        <Card className="p-3 text-sm text-neutral-300">
          {focus} staat niet meer in de kopgroep van zijn regio.{" "}
          <a href={googleFinanceUrl(focus)} target="_blank" rel="noreferrer" className="text-fog-pink hover:underline">
            Bekijk de koers
          </a>
        </Card>
      )}
      {data && shown.length === 0 && (
        <Card className="p-4 text-sm text-neutral-500">
          {items.length ? "Niets te tonen met deze filters." : "Nog geen ronde gedraaid: de eerste volgt na het eerstvolgende slot."}
        </Card>
      )}

      {shown.length > 0 && (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] text-neutral-500 border-b border-ink-5/60">
              <tr>
                <th className="pl-2 pr-1 py-2 w-7" title="Favoriet: ook op de watchlist, maar niet in het Potje en de papieren portefeuille" />
                <th className="px-1 py-2 w-7 hidden sm:table-cell" title="Gezien: weg uit deze lijst">
                  <span aria-hidden>🔭</span>
                </th>
                <th className="px-1.5 sm:px-2 py-2 text-left">Aandeel</th>
                <th className="px-1.5 sm:px-2 py-2 text-right">Kans</th>
                <th className="px-2 py-2 text-right hidden sm:table-cell">Koers</th>
                <th className="px-2 py-2 text-right hidden sm:table-cell">1d</th>
                <th className="px-2 py-2 text-right hidden md:table-cell">1m</th>
                <th className="px-1.5 sm:px-2 py-2 text-right">Omzet/dag</th>
                <th className="px-2 py-2 text-right hidden lg:table-cell">Beurswaarde</th>
                <th className="px-2 py-2 text-left hidden lg:table-cell">Sterkste reden</th>
                <th className="px-2 py-2 text-right hidden md:table-cell">Gemeld</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const open = expanded === r.ticker;
                const fav = marks.isFavorite(r.ticker);
                const top = (r.reasons ?? []).find((x) => x.f > 1);
                return (
                  <Fragment key={r.ticker}>
                    <tr
                      id={`ss-${r.ticker}`}
                      onClick={() => setExpanded(open ? null : r.ticker)}
                      className={`border-t border-ink-5/40 cursor-pointer hover:bg-white/[0.04] ${i % 2 ? "bg-white/[0.022]" : ""} ${
                        isFocus(r) ? "outline outline-1 outline-fog-pink/60" : ""
                      } ${marks.isSeen(r.ticker) ? "opacity-50" : ""}`}
                    >
                      <td className="pl-2 pr-1 py-1.5 text-center">
                        <button
                          type="button"
                          disabled={busy === r.ticker}
                          onClick={(e) => {
                            e.stopPropagation();
                            void heart(r);
                          }}
                          className={`text-base leading-none transition-colors disabled:opacity-40 ${
                            fav ? "text-[#8855ff] hover:text-[#aa77ff]" : "text-[#2a1a4a] hover:text-[#4a2a7a]"
                          }`}
                          title={fav ? "Favoriet — klik om te verwijderen" : "Favoriet maken: ook op de watchlist, maar niet in het Potje en de papieren portefeuille"}
                          aria-label={`Markeer ${r.ticker} als favoriet`}
                          aria-pressed={fav}
                        >
                          <HeartIcon />
                        </button>
                      </td>
                      <td className="px-1 py-1.5 text-center hidden sm:table-cell" onClick={(e) => e.stopPropagation()}>
                        <SeenInline ticker={r.ticker} />
                      </td>
                      <td className="px-1.5 sm:px-2 py-1.5 min-w-0">
                        <a
                          href={googleFinanceUrl(r.ticker, r.exchange)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono font-bold text-neutral-100 hover:text-fog-pink"
                        >
                          {r.ticker}
                        </a>
                        <div className="text-[11px] text-neutral-500 truncate max-w-[8rem] sm:max-w-[16rem]" title={r.name ?? ""}>
                          {r.name ?? ""}
                        </div>
                        <div className="text-[10px] text-neutral-600">
                          {r.exchange ?? ""} · {REGIONS[r.region]}
                          {r.alerted_at ? <span className="md:hidden"> · 🚀 {fmtDate(r.alerted_at)}</span> : null}
                        </div>
                        <div className={`text-[10px] font-mono tabular-nums sm:hidden ${pctTone(r.change_1d)}`}>{fmtPct(r.change_1d)} vandaag</div>
                      </td>
                      <td className="px-1.5 sm:px-2 py-1.5 text-right whitespace-nowrap">
                        <div className={`font-mono tabular-nums text-base ${probTone(r.prob, threshold)}`}>{nl(r.prob)}%</div>
                        <div className="text-[10px] text-neutral-500 tabular-nums">{Math.round(r.prob / BASE_RATE)}× basis</div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-300 whitespace-nowrap hidden sm:table-cell">
                        {fmtPrice(r.close)}
                        <span className="ml-1 text-[10px] text-neutral-600">{r.currency ?? ""}</span>
                      </td>
                      <td className={`px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap hidden sm:table-cell ${pctTone(r.change_1d)}`}>
                        {fmtPct(r.change_1d)}
                      </td>
                      <td className={`px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap hidden md:table-cell ${pctTone(r.perf_1m)}`}>
                        {fmtPct(r.perf_1m, 0)}
                      </td>
                      <td
                        className={`px-1.5 sm:px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap ${
                          (r.dvol_usd ?? 0) < 100_000 ? "text-amber-300" : "text-neutral-300"
                        }`}
                        title={(r.dvol_usd ?? 0) < 100_000 ? "Lage omzet: een grotere order beweegt de koers" : undefined}
                      >
                        {fmtUsd(r.dvol_usd)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-400 whitespace-nowrap hidden lg:table-cell">{fmtUsd(r.mcap_usd)}</td>
                      <td className="px-2 py-1.5 text-[11px] text-neutral-400 hidden lg:table-cell max-w-[20rem]">
                        {top ? `×${nl(top.f, top.f >= 10 ? 0 : 1)} ${top.label}: ${top.t}` : ""}
                      </td>
                      <td className="px-2 py-1.5 text-right text-[11px] text-neutral-500 whitespace-nowrap hidden md:table-cell">
                        {r.alerted_at ? `🚀 ${fmtDate(r.alerted_at)}` : r.alert_pending ? "kandidaat" : ""}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={11} className="p-0">
                          <Detail r={r} threshold={threshold} />
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

      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <TrackCard
            title="Track record SUPERsprinters"
            track={data.track_record}
            note="Elke ronde legt per aandeel in de kopgroep de kans en de slotkoers vast, en bij een melding ook de kans en koers van dat moment. Na 10 handelsdagen valt het oordeel: haalde het slot +50% en stond het de dag erna nog minstens +20%? De eerste uitkomsten volgen ruim twee weken na de eerste ronde."
          />
          <TrackCard
            title="Track record Sprinters"
            track={data.sprint_track_record}
            note="Ter vergelijking: het track record van Sprinters (alleen je favorieten met vier sterren, sinds 26 september). Bij Sprinters telt de kans van de eerste run van de dag, niet die van het moment van melden."
          />
        </div>
      )}
      {test && <TestCard test={test} />}

      {data && (
        <Card className="p-4 space-y-2 text-[11px] text-neutral-500 leading-relaxed">
          <div className="uppercase tracking-wider text-neutral-400 font-bold">Marktklimaat en verbruik</div>
          <div>
            Aandeel van de aandelen dat op de laatste sessie 20% of meer steeg:{" "}
            {REGIONS.map((n, g) => {
              const b = data.breadth.find((x) => x.region === g);
              return `${n} ${b ? `${nl(b.b1_20 * 100, 2)}% (van ${b.n.toLocaleString("nl-NL")})` : "—"}`;
            }).join(" · ")}
            . In een heet klimaat komen sprints vaker voor; het model rekent dat mee.
          </div>
          <div>
            Verbruik vandaag: {today && today.day === new Date().toISOString().slice(0, 10) ? (
              <>
                {today.runs} runs, {today.tv} verzoeken aan TradingView, {today.yahoo} aan Yahoo, {today.rows_written.toLocaleString("nl-NL")} rijen
                geschreven
              </>
            ) : (
              "nog niets"
            )}{" "}
            (dagbudget: {data.budget.limits.runs} runs, {data.budget.limits.tv} en {data.budget.limits.yahoo} verzoeken,{" "}
            {data.budget.limits.rows.toLocaleString("nl-NL")} rijen). Per regio worden hoogstens {data.top_n} aandelen bewaard; de rest van de
            markt wordt alleen in het geheugen doorgerekend.
          </div>
          {getToken() && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => void setSetting({ ss_alerts: !alertsOn })}>
                {alertsOn ? "Meldingen uitzetten (Sprinters meldt dan weer)" : "Meldingen aanzetten (Sprinters meldt dan niet meer)"}
              </Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => void setSetting({ ss_enabled: !enabled })}>
                {enabled ? "SUPERsprinters uitzetten" : "SUPERsprinters aanzetten"}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
