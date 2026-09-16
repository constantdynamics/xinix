import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchHippoScores,
  triggerHippoScan,
  getToken,
  type HippoItem,
  type HippoCalibration,
  type HippoTrackRecord,
} from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, Stat, CollapsibleIntro, toast } from "../components/ui";
import { HeartHeader, HeartInline, SeenHeader, SeenInline, StarRating } from "../components/MarkCells";
import { GradientTabIcon } from "../tabIcons";
import { PriceChartModal } from "./PriceChartModal";

// De ranglijst beslaat inmiddels de hele watchlist; favorieten blijft het
// standaardbeeld, want dat is waar dit tabblad over gaat.
type Scope = "favorieten" | "alles" | "handelbaar" | "gemeld";

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}
function fmtDollarVol(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)} mln`;
  return `$${Math.round(v / 1e3)}k`;
}
function fmtSignedPct(v: number | null): string {
  if (v == null) return "—";
  return v < 0 ? `−${Math.abs(v).toFixed(0)}%` : `+${v.toFixed(0)}%`;
}
function fmtDays(d: number | null): string {
  if (d == null) return "nooit";
  if (d <= 0) return "loopt nu";
  if (d < 60) return `${d} dagen`;
  if (d < 400) return `${Math.round(d / 30)} mnd`;
  return `${(d / 365).toFixed(1)} jaar`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

// Kleurband t.o.v. de meldingsdrempel: alles daarboven is "hippo".
function probTone(p: number, threshold: number): string {
  if (threshold > 0 && p >= threshold) return "text-fog-lime font-bold";
  if (p >= 20) return "text-emerald-300 font-semibold";
  if (p >= 8) return "text-neutral-200";
  return "text-neutral-400";
}

/** Modelkans vs. werkelijkheid — het bewijs dat de getoonde kans klopt. */
function CalibChart({ calib }: { calib: HippoCalibration }) {
  const rows = (calib.calib ?? []).filter((c) => c.n > 0);
  if (!rows.length) {
    return (
      <div className="text-[11px] text-neutral-500">
        Nog geen kalibratiedata: die ontstaat bij de eerstvolgende herscan van elke favoriet (per 30 dagen),
        zodra de eerste lifts gemeten zijn. Tot dan is de getoonde kans de ongekalibreerde modelkans.
      </div>
    );
  }
  const max = Math.max(...rows.map((c) => Math.max(c.rate_pct ?? 0, c.hi)), 1);
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2 h-28">
        {rows.map((c) => (
          <div key={c.bucket} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div className="text-[10px] font-mono tabular-nums text-fog-lime font-bold">
              {c.rate_pct != null ? `${c.rate_pct.toFixed(1)}%` : "—"}
            </div>
            <div className="w-full flex items-end gap-px" style={{ height: "80px" }}>
              <div
                className="flex-1 rounded-t bg-ink-5/70"
                style={{ height: `${Math.max(3, ((c.lo + c.hi) / 2 / max) * 100)}%` }}
                title={`model zegt ${c.lo}–${c.hi}%`}
              />
              <div
                className="flex-1 rounded-t bg-gradient-to-t from-fog-pink/30 to-fog-lime/70"
                style={{ height: `${Math.max(3, ((c.rate_pct ?? 0) / max) * 100)}%` }}
                title={`${c.hits} van ${c.n} dagen`}
              />
            </div>
            <div className="text-[10px] text-neutral-500 whitespace-nowrap">
              {c.lo}–{c.hi}%
            </div>
            <div className="text-[9px] text-neutral-600 whitespace-nowrap">n={c.n.toLocaleString("nl-NL")}</div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-neutral-500 text-center">
        Grijs = wat het model zei, gekleurd = hoe vaak het écht gebeurde (per kansbucket, over alle historische
        dagen van alle favorieten). De getoonde kans per aandeel is de gekleurde waarde.
      </div>
    </div>
  );
}

/** De gemeten lifts per kenmerk, als compacte tabellen. */
function LiftTables({ calib }: { calib: HippoCalibration }) {
  const entries = Object.entries(calib.lifts ?? {});
  if (!entries.length) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {entries.map(([key, f]) => (
        <div key={key} className="rounded border border-ink-5/60 p-2">
          <div className="text-[11px] font-bold text-neutral-300 mb-1">{f.label}</div>
          <table className="w-full text-[11px]">
            <tbody>
              {f.buckets.map((b) => (
                <tr key={b.bucket} className="border-t border-ink-5/40">
                  <td className="py-0.5 pr-2 text-neutral-400 whitespace-nowrap">{b.bucket}</td>
                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-neutral-500">
                    {b.n.toLocaleString("nl-NL")}d
                  </td>
                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums text-neutral-300">{b.rate_pct.toFixed(1)}%</td>
                  <td
                    className={`py-0.5 text-right font-mono tabular-nums ${
                      b.lift > 1.05 ? "text-fog-lime" : b.lift < 0.95 ? "text-fog-loss" : "text-neutral-500"
                    }`}
                  >
                    ×{b.lift.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/**
 * Track record: wat het model vooraf zei, en wat er daarna werkelijk gebeurde.
 * De kalibratie hierboven is gemeten op de eigen historie; dit is het enige
 * cijfer waar achteraf niet meer aan te sleutelen valt.
 */
function TrackRecordCard({ track, shownHz }: { track: HippoTrackRecord; shownHz: "7" | "14" }) {
  const h = track.horizons?.[shownHz];
  const sinds = track.since
    ? new Date(track.since).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })
    : null;
  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <div className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold">
          Track record over {shownHz} dagen
        </div>
        <div className="text-[11px] text-neutral-500">
          {sinds ? `bijgehouden sinds ${sinds}` : "start vandaag"} · {track.open.toLocaleString("nl-NL")} lopend
        </div>
      </div>

      {!h || h.n === 0 ? (
        <div className="text-[11px] text-neutral-500 leading-relaxed">
          Nog geen afgewikkelde voorspellingen. Elke dag wordt per aandeel de kans van dat moment vastgelegd met de
          koers erbij; na {shownHz} dagen valt het oordeel. De eerste uitkomsten verschijnen hier dus over{" "}
          {shownHz} dagen. Tot die tijd is de kalibratie hierboven het enige bewijs, en dat is terugkijkend.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Stat label="Afgewikkeld" value={h.n.toLocaleString("nl-NL")} />
            <Stat label="Voorspeld" value={h.avg_prob != null ? `${h.avg_prob.toFixed(1)}%` : "—"} hint="gemiddelde kans vooraf" />
            <Stat label="Werkelijk" value={h.rate_pct != null ? `${h.rate_pct.toFixed(1)}%` : "—"} hint="haalde +50% en hield stand" />
            <Stat label="Even aangeraakt" value={h.touches.toLocaleString("nl-NL")} hint="+50% geraakt, viel soms terug" />
          </div>
          {h.buckets.length > 0 && (
            <table className="w-full text-[11px]">
              <thead className="text-neutral-500 border-b border-ink-5/60">
                <tr>
                  <th className="py-1 text-left font-bold">Model zei</th>
                  <th className="py-1 text-right font-bold">Voorspellingen</th>
                  <th className="py-1 text-right font-bold">Voorspeld</th>
                  <th className="py-1 text-right font-bold">Werkelijk</th>
                </tr>
              </thead>
              <tbody>
                {h.buckets.map((b) => (
                  <tr key={b.bucket} className="border-t border-ink-5/40">
                    <td className="py-0.5 text-neutral-400 whitespace-nowrap">{b.bucket}%</td>
                    <td className="py-0.5 text-right font-mono tabular-nums text-neutral-500">{b.n.toLocaleString("nl-NL")}</td>
                    <td className="py-0.5 text-right font-mono tabular-nums text-neutral-400">{b.avg_prob.toFixed(1)}%</td>
                    <td className="py-0.5 text-right font-mono tabular-nums text-fog-lime font-semibold">
                      {b.rate_pct != null ? `${b.rate_pct.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="text-[11px] text-neutral-500 leading-relaxed">
            Een treffer telt pas als de koers +50% haalde <em>en</em> een dag later nog minstens 20% boven de
            instapkoers stond, dezelfde eis als in de historische meting. Gemeten op slotkoersen, dus een sprong die
            binnen de dag weer wegviel telt niet mee. Bij weinig voorspellingen zegt een afwijking nog niets; pas na
            enkele honderden afgewikkelde gevallen per bucket wordt het verschil betekenisvol.
          </div>
        </>
      )}
    </Card>
  );
}

export function HipposView() {
  const [items, setItems] = useState<HippoItem[]>([]);
  const [calibs, setCalibs] = useState<Record<string, HippoCalibration>>({});
  const [track, setTrack] = useState<HippoTrackRecord | null>(null);
  const [threshold, setThreshold] = useState(80);
  const [alertHorizon, setAlertHorizon] = useState(14);
  const [maxPerWeek, setMaxPerWeek] = useState(1);
  // Welke horizon de kalibratiekaart en de stats tonen. Standaard die waarop
  // gemeld wordt, want dat is de horizon waar de drempel op slaat.
  const [shownHz, setShownHz] = useState<"7" | "14">("14");
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [favCount, setFavCount] = useState(0);
  const [scannedCount, setScannedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("favorieten");
  const [scoredCount, setScoredCount] = useState(0);
  const [showLifts, setShowLifts] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chartFor, setChartFor] = useState<{ ticker: string; company: string; exchange: string | null } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchHippoScores();
      setItems(r.items);
      setCalibs(r.calibrations ?? (r.calibration ? { "14": r.calibration } : {}));
      setTrack(r.track_record ?? null);
      setThreshold(r.threshold);
      setAlertHorizon(r.alert_horizon ?? 14);
      setMaxPerWeek(r.max_per_week ?? 1);
      setShownHz(String(r.alert_horizon ?? 14) === "7" ? "7" : "14");
      setComputedAt(r.computed_at);
      setFavCount(r.favorite_count);
      setScannedCount(r.scanned_count);
      setScoredCount(r.scored_count ?? r.items.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (scope === "favorieten") return items.filter((r) => r.is_favorite);
    if (scope === "handelbaar") return items.filter((r) => r.tradeable);
    if (scope === "gemeld") return items.filter((r) => r.alerted_at);
    return items;
  }, [items, scope]);

  // De kans waarop de drempel slaat, per aandeel.
  const probOf = useCallback(
    (r: HippoItem) => (alertHorizon === 7 ? r.prob_7d : r.prob),
    [alertHorizon],
  );
  const aboveThreshold = useMemo(
    () => (threshold > 0 ? items.filter((r) => { const v = probOf(r); return v != null && v >= threshold && r.tradeable; }).length : 0),
    [items, threshold, probOf],
  );

  const calib = calibs[shownHz] ?? null;
  const alertCalib = calibs[String(alertHorizon)] ?? null;
  // Het plafond van het model: de hoogste frequentie die ooit in een kansbucket
  // gemeten is. Een gekalibreerde kans kan daar per definitie niet boven komen,
  // dus een drempel erboven zal nooit vuren. Dat hoort de gebruiker te weten
  // vóór hij een drempel kiest, niet pas na maanden stilte.
  const ceilingOf = useCallback((c: HippoCalibration | null) => {
    if (!c) return null;
    if (c.ceiling != null) return c.ceiling;
    const rows = (c.calib ?? []).filter((b) => b.n >= 1000 && b.rate_pct != null);
    return rows.length ? Math.max(...rows.map((b) => b.rate_pct as number)) : null;
  }, []);
  const ceiling = useMemo(() => ceilingOf(calib), [calib, ceilingOf]);
  const alertCeiling = useMemo(() => ceilingOf(alertCalib), [alertCalib, ceilingOf]);
  const thresholdUnreachable = threshold > 0 && alertCeiling != null && threshold > alertCeiling;

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await triggerHippoScan();
      toast("Run gestart — scant de volgende batch en herberekent de lijst (± 2 minuten)", "success");
      setTimeout(() => void load(), 120_000);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Starten mislukt", "error");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-4">
      <CollapsibleIntro title="Hippos — kans op +50% binnen 14 dagen" icon={<GradientTabIcon tab="favorieten" />}>
        <div className="text-sm text-neutral-300 leading-relaxed space-y-2">
          <p>
            Voor elk aandeel op de watchlist de kans dat de koers <strong>minimaal +50%</strong> doet, gemeten over twee
            vensters naast elkaar: <strong>binnen 7 dagen</strong> en <strong>binnen 14 dagen</strong>. Komt de kans
            op de horizon van <strong className="text-fog-lime">{alertHorizon} dagen</strong> voor een verhandelbare
            <strong> favoriet</strong> op of boven de drempel van <strong className="text-fog-lime">{threshold}%</strong>, dan krijg je
            meteen een ntfy-melding 🦛
            {maxPerWeek > 0 ? `, hoogstens ${maxPerWeek === 1 ? "één keer" : `${maxPerWeek} keer`} per week` : ""}.
            Beide instelbaar bij Instellingen.
          </p>
          <p className="text-xs text-neutral-400">
            <strong className="text-neutral-300">Gemeten, niet bedacht.</strong> Van elk doorgelicht aandeel zijn 10 jaar
            dagkoersen doorgelicht: voor elke handelsdag is gekeken of er binnen 5 respectievelijk 10 handelsdagen
            +50% volgde (en minstens een dag standhield). Beide vensters rusten op exact dezelfde dagen en dezelfde
            kenmerken, dus het verschil tussen 7 en 14 dagen is af te lezen in plaats van te beredeneren. Een korter
            venster is strenger, dus die kansen liggen per definitie lager. Per dag zijn vijf kenmerken vastgelegd — 5-daags en 22-daags
            rendement, volume t.o.v. het 30-daagse gemiddelde, dagen sinds de vorige +50%-piek en de afstand tot de
            1-jaarstop. Over alle favorieten samen geeft dat een basiskans en per kenmerk een gemeten lift; de eigen
            historie van het aandeel telt mee. De actuele toestand (verse koersen) bepaalt welke lifts nu gelden.
          </p>
          <p className="text-xs text-neutral-400">
            <strong className="text-neutral-300">Gekalibreerd.</strong> Omdat de kenmerken overlappen overdrijft
            zo'n vermenigvuldiging. Daarom wordt bij elke herscan voor élke historische dag uitgerekend wat het model
            zou hebben gezegd, en geteld hoe vaak het écht gebeurde. De kans die je hier ziet is die gemeten
            frequentie — niet wat het model roept. Klik op een rij voor de volledige opbouw.
          </p>
          <p className="text-xs text-neutral-500">
            <strong className="text-neutral-400">Eerlijk over de drempel.</strong> +50% in twee weken is zeldzaam. De
            basiskans over {shownHz} dagen ligt rond {calib ? `${calib.base_rate.toFixed(1)}%` : "een paar procent"} per
            dag, en de hoogste kans op dit moment is{" "}
            <strong className="text-neutral-300">{calib?.max_prob != null ? `${calib.max_prob.toFixed(0)}%` : "nog onbekend"}</strong>.
            Sub-penny en dode orderboeken (DUN) sturen geen melding: daar is +50% een spread-artefact.
          </p>
          {ceiling != null && (
            <p className="text-xs text-neutral-500">
              <strong className="text-neutral-400">Er bestaat een plafond.</strong> Zelfs in de groep waar het model
              het hardst roept, gebeurde het historisch in{" "}
              <strong className="text-neutral-300">{ceiling.toFixed(0)}%</strong> van de gevallen. Hoger dan dat kan
              een <em>gemeten</em> kans niet worden, hoe extreem een aandeel er ook bij staat. Een aandeel met 80%
              zekerheid op +50% binnen {shownHz} dagen bestaat in deze data dus niet, en dat is geen tekortkoming van
              het model maar een eigenschap van de markt. Wil je meldingen ontvangen, zet de drempel dan onder{" "}
              {ceiling.toFixed(0)}%.
            </p>
          )}
        </div>
      </CollapsibleIntro>

      {thresholdUnreachable && (
        <Card className="p-4 border-fog-loss/40 bg-fog-loss/5">
          <div className="flex items-start gap-3">
            <div className="text-2xl leading-none">🦛</div>
            <div className="text-sm text-neutral-300 leading-relaxed">
              <strong className="text-fog-loss">Je drempel van {threshold}% zal nooit vuren.</strong> Op de horizon
              van {alertHorizon} dagen is de hoogste frequentie die ooit in de historie gemeten is{" "}
              {alertCeiling!.toFixed(0)}%. Een gekalibreerde kans komt daar niet boven, dus bij deze instelling krijg
              je geen enkele melding. Zet de drempel bij{" "}
              <strong className="text-neutral-200">Instellingen → Hippo-melding vanaf kans</strong> lager om de
              sterkste kandidaten wél door te laten.
            </div>
          </div>
        </Card>
      )}

      {calib && (
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold">Kalibratie: model vs. werkelijkheid</div>
            <div className="flex items-center gap-1">
              {(["7", "14"] as const).map((hz) => (
                <button
                  key={hz}
                  type="button"
                  onClick={() => setShownHz(hz)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${
                    shownHz === hz ? "border-fog-lime/40 text-fog-lime bg-fog-lime/10" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
                  }`}
                  title={`Kalibratie over een venster van ${hz} dagen`}
                >
                  {hz} dagen
                  {Number(hz) === alertHorizon && <span className="ml-1" title="Hierop wordt gemeld">🦛</span>}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowLifts((v) => !v)}
              className="ml-auto text-[11px] text-fog-lime hover:underline font-semibold"
            >
              {showLifts ? "Verberg gemeten lifts" : "Toon gemeten lifts per kenmerk"}
            </button>
          </div>
          <CalibChart calib={calib} />
          {showLifts && <LiftTables calib={calib} />}
        </Card>
      )}

      {track && <TrackRecordCard track={track} shownHz={shownHz} />}

      <div className="flex flex-wrap items-center gap-3">
        <Stat label="Favorieten" value={favCount} />
        <Stat label="Doorgelicht" value={scannedCount} hint="10 jaar historie gemeten" />
        <Stat label="Gescoord" value={scoredCount || items.length} hint="hele watchlist, met verse koers" />
        <Stat label={`Basiskans ${shownHz}d`} value={calib ? `${calib.base_rate.toFixed(1)}%` : "—"} hint="per dag, alle favorieten" />
        <Stat label={`Hoogste ${shownHz}d`} value={calib?.max_prob != null ? `${calib.max_prob.toFixed(0)}%` : "—"} />
        <Stat label={`Plafond ${shownHz}d`} value={ceiling != null ? `${ceiling.toFixed(0)}%` : "—"} hint="hoogst gemeten frequentie ooit" />
        <Stat label={`≥ ${threshold}% op ${alertHorizon}d`} value={aboveThreshold} hint="verhandelbaar, melding" />
        <div className="text-xs text-neutral-500">
          {computedAt ? <>Berekend: {fmtDate(computedAt)} {new Date(computedAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })} · elke 2 uur</> : "nog niet berekend"}
        </div>
        {getToken() && (
          <div className="ml-auto">
            <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? "Bezig…" : "Run nu"}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold mr-1">Toon:</span>
        {(["favorieten", "alles", "handelbaar", "gemeld"] as Scope[]).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
              scope === s ? "border-fog-lime/40 text-fog-lime bg-fog-lime/10" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
            }`}
            title={
              s === "favorieten"
                ? "Alleen aandelen met een hartje — de enige die een melding kunnen krijgen"
                : s === "handelbaar"
                  ? "Verbergt sub-penny aandelen en dode orderboeken"
                  : s === "gemeld"
                    ? "Aandelen waarvoor ooit een hippo-melding is verstuurd"
                    : "De hele watchlist, ook zonder hartje"
            }
          >
            {s === "favorieten" ? "♥ Favorieten" : s === "alles" ? "Hele watchlist" : s === "handelbaar" ? "Handelbaar" : "🦛 Gemeld"}
          </button>
        ))}
      </div>

      {loading ? (
        <Card className="p-10 text-center text-sm text-neutral-400">Ranglijst laden…</Card>
      ) : error ? (
        <Card className="p-10 text-center space-y-3">
          <div className="text-4xl">⚠️</div>
          <div className="text-sm font-semibold text-neutral-300">Laden mislukt</div>
          <div className="text-xs text-neutral-500">{error}</div>
        </Card>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center space-y-3">
          <div className="text-4xl">🦛</div>
          <div className="text-sm font-semibold text-neutral-300">Nog geen ranglijst</div>
          <div className="text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
            De scan draait elke 2 uur en licht per run ± 100 favorieten door; na de eerste ronde verschijnt hier
            de lijst. Gebruik &ldquo;Run nu&rdquo; om een batch direct te starten.
          </div>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-5 bg-ink-3/40 text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                <tr>
                  <th className="px-2 py-2 text-right">#</th>
                  <SeenHeader />
                  <HeartHeader />
                  <th className="px-3 py-2 text-center">Sterren</th>
                  <th className="px-3 py-2 text-left">Ticker</th>
                  <th className="px-3 py-2 text-left">Bedrijf</th>
                  <th className="px-3 py-2 text-right" title="Gekalibreerde kans op +50% binnen 7 dagen">
                    Kans 7d{alertHorizon === 7 && <span className="ml-1">🦛</span>}
                  </th>
                  <th className="px-3 py-2 text-right" title="Gekalibreerde kans op +50% binnen 14 dagen">
                    Kans 14d{alertHorizon === 14 && <span className="ml-1">🦛</span>}
                  </th>
                  <th className="px-3 py-2 text-right" title="Modelkans vóór kalibratie, op de horizon waarop gemeld wordt">Model</th>
                  <th className="px-3 py-2 text-right" title="Eigen basiskans per dag, 10 jaar historie">Eigen</th>
                  <th className="px-3 py-2 text-right" title="Aantal +50%-sprints in 10 jaar">Sprints</th>
                  <th className="px-3 py-2 text-right" title="Tijd sinds de vorige +50%-piek">Laatste</th>
                  <th className="px-3 py-2 text-right">5d</th>
                  <th className="px-3 py-2 text-right">22d</th>
                  <th className="px-3 py-2 text-right" title="Volume t.o.v. het 30-daagse gemiddelde">Vol</th>
                  <th className="px-3 py-2 text-right" title="Onder de 1-jaarstop">vs 1j-top</th>
                  <th className="px-3 py-2 text-right">$vol/dag</th>
                  <th className="px-3 py-2 text-right">Koers</th>
                  <th className="px-3 py-2 text-right" title="Laatste hippo-melding">Gemeld</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-5/40">
                {filtered.map((r, i) => (
                  <Fragment key={r.ticker}>
                    <tr
                      className="cursor-pointer hover:bg-ink-3/30 transition-colors"
                      onClick={() => setExpanded(expanded === r.ticker ? null : r.ticker)}
                    >
                      <td className="px-2 py-2 text-right font-mono tabular-nums text-neutral-500 text-xs">{i + 1}</td>
                      <td className="px-2 py-2 text-center align-middle" onClick={(e) => e.stopPropagation()}>
                        <SeenInline ticker={r.ticker} />
                      </td>
                      <td className="px-2 py-2 text-center align-middle" onClick={(e) => e.stopPropagation()}>
                        <HeartInline ticker={r.ticker} />
                      </td>
                      <td className="px-3 py-2 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <StarRating ticker={r.ticker} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <a
                          href={googleFinanceUrl(r.ticker, r.exchange)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono font-semibold tab-accent-text hover:underline"
                        >
                          {r.ticker}
                        </a>
                        {!r.tradeable && (
                          <span
                            className="ml-1.5 px-1 py-0.5 rounded bg-fog-loss/15 text-fog-loss text-[9px] font-bold align-middle"
                            title="Sub-penny of nauwelijks omzet — geen melding, een sprong is hier vaak niet te verzilveren"
                          >
                            DUN
                          </span>
                        )}
                        {threshold > 0 && (probOf(r) ?? 0) >= threshold && (
                          <span
                            className="ml-1.5 align-middle"
                            title={r.is_favorite
                              ? `Boven de meldingsdrempel op ${alertHorizon} dagen`
                              : `Boven de drempel, maar zonder hartje gaat er geen melding uit`}
                          >
                            {r.is_favorite ? "🦛" : "🦛\u200A?"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 max-w-[220px]">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setChartFor({ ticker: r.ticker, company: r.company ?? r.ticker, exchange: r.exchange });
                          }}
                          className="text-left text-neutral-200 hover:text-fog-pink hover:underline transition-colors truncate block w-full"
                          title={`Bekijk koersgrafiek van ${r.company ?? r.ticker}`}
                        >
                          {r.company ?? "—"}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {r.prob_7d != null
                          ? <span className={probTone(r.prob_7d, alertHorizon === 7 ? threshold : 0)}>{r.prob_7d.toFixed(1)}%</span>
                          : <span className="text-neutral-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        <span className={probTone(r.prob, alertHorizon === 14 ? threshold : 0)}>{r.prob.toFixed(1)}%</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-500">
                        {(alertHorizon === 7 ? r.raw_prob_7d : r.raw_prob)?.toFixed(1) ?? "—"}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-400">
                        {r.own_rate != null ? `${r.own_rate.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-300">{r.peak_count}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-300 whitespace-nowrap">{fmtDays(r.days_since_peak)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        <span className={r.pct_change_5d != null && r.pct_change_5d < 0 ? "text-fog-loss" : "text-fog-lime"}>{fmtSignedPct(r.pct_change_5d)}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        <span className={r.pct_change_22d != null && r.pct_change_22d < 0 ? "text-fog-loss" : "text-fog-lime"}>{fmtSignedPct(r.pct_change_22d)}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-300">
                        {r.volume_ratio != null ? `${r.volume_ratio.toFixed(1)}×` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-fog-loss">
                        {r.pct_below_high1y != null ? `−${Math.round(r.pct_below_high1y)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-400 whitespace-nowrap">{fmtDollarVol(r.dollar_volume)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">{fmtPrice(r.last_close)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-500 whitespace-nowrap">
                        {r.alerted_at ? `${fmtDate(r.alerted_at)} (${Math.round(r.alerted_prob ?? 0)}%)` : "—"}
                      </td>
                    </tr>
                    {expanded === r.ticker && (
                      <tr className="bg-ink-3/20">
                        <td colSpan={19} className="px-6 py-4">
                          <div className="space-y-2 max-w-3xl">
                            <div className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold">
                              Opbouw van de kans over {shownHz} dagen
                            </div>
                            <div className="text-xs text-neutral-400">
                              Basis {((shownHz === "7" ? r.base_rate_7d : r.base_rate) ?? 0).toFixed(1)}% × eigen historie
                              × de kenmerken hieronder = model{" "}
                              {((shownHz === "7" ? r.raw_prob_7d : r.raw_prob) ?? 0).toFixed(1)}% → gekalibreerd{" "}
                              <span className={probTone((shownHz === "7" ? r.prob_7d : r.prob) ?? 0, threshold)}>
                                {((shownHz === "7" ? r.prob_7d : r.prob) ?? 0).toFixed(1)}%
                              </span>
                            </div>
                            <ul className="space-y-1">
                              {(shownHz === "7" ? r.factors_7d ?? [] : r.factors).map((f, k) => (
                                <li key={k} className="flex items-baseline gap-2 text-xs">
                                  <span
                                    className={`font-mono tabular-nums w-12 shrink-0 text-right ${
                                      f.mult > 1.05 ? "text-fog-lime" : f.mult < 0.95 ? "text-fog-loss" : "text-neutral-600"
                                    }`}
                                  >
                                    {f.mult === 1 ? "—" : `×${f.mult}`}
                                  </span>
                                  <span className="text-neutral-300 font-semibold w-40 shrink-0">{f.label}</span>
                                  <span className="text-neutral-400">{f.detail}</span>
                                </li>
                              ))}
                            </ul>
                            <div className="text-[11px] text-neutral-500 pt-1">
                              Historie gemeten op {fmtDate(r.scanned_at)}; herscan per 30 dagen. Koers en kenmerken zijn van de laatste koersupdate.
                            </div>
                            {r.flags.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {r.flags.map((fl) => (
                                  <span
                                    key={fl}
                                    className={`px-1.5 py-0.5 rounded text-[10px] border font-semibold ${
                                      fl === "sprint loopt nu"
                                        ? "border-fog-lime/40 text-fog-lime bg-fog-lime/10"
                                        : "border-fog-loss/40 text-fog-loss bg-fog-loss/10"
                                    }`}
                                  >
                                    {fl}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {chartFor && (
        <PriceChartModal ticker={chartFor.ticker} company={chartFor.company} exchange={chartFor.exchange} onClose={() => setChartFor(null)} />
      )}
    </div>
  );
}
