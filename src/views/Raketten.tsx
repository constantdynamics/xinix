import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchRocketScores,
  triggerRocketScan,
  getToken,
  addDoublingCatalyst,
  removeDoublingCatalyst,
  type RocketItem,
  type RocketCalibration,
} from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, Stat, CollapsibleIntro, toast } from "../components/ui";
import { HeartHeader, HeartInline, SeenHeader, SeenInline, StarRating } from "../components/MarkCells";
import { GradientTabIcon } from "../tabIcons";
import { PriceChartModal } from "./PriceChartModal";

type Scope = "alles" | "favorieten" | "handelbaar";

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}
function fmtMcap(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)} mrd`;
  return `$${Math.round(v / 1e6)} mln`;
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
  if (d <= 25) return "loopt nu";
  if (d < 60) return `${d} dagen`;
  if (d < 400) return `${Math.round(d / 30)} mnd`;
  return `${(d / 365).toFixed(1)} jaar`;
}

// Kleurband voor de kans. De basiskans is 4.6%, dus alles boven ~10% is
// echt uitzonderlijk — daar mag de kleur dat ook laten zien.
function probTone(p: number): string {
  if (p >= 18) return "text-fog-lime font-bold";
  if (p >= 12) return "text-emerald-300 font-semibold";
  if (p >= 8) return "text-neutral-200";
  return "text-neutral-400";
}

/**
 * Handmatig een bevestigde katalysator vastleggen — voor aandelen waarvoor geen
 * gestructureerde feed bestaat (mining, small caps). Schrijft naar
 * signal_catalysts met source="manual"; de eerstvolgende run telt hem mee.
 */
function CatalystEditor({ item, onChanged }: { item: RocketItem; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [type, setType] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!date) return;
    setBusy(true);
    try {
      await addDoublingCatalyst(item.ticker, date, type.trim() || "katalysator");
      toast(`Katalysator vastgelegd voor ${item.ticker}`, "success");
      setOpen(false);
      setDate("");
      setType("");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Opslaan mislukt", "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await removeDoublingCatalyst(item.ticker);
      toast(`Katalysator verwijderd voor ${item.ticker}`, "success");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Verwijderen mislukt", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!getToken()) return null;

  return (
    <div className="pt-2 border-t border-ink-5/40 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-neutral-500">
          {item.catalyst_date
            ? `Katalysator: ${item.catalyst_type ?? "gebeurtenis"} op ${item.catalyst_date}`
            : "Geen katalysator bekend binnen 6 maanden"}
        </span>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-fog-lime hover:underline font-semibold"
          >
            {item.catalyst_date ? "Wijzig" : "+ Voeg toe"}
          </button>
        )}
        {item.catalyst_date && !open && (
          <button type="button" onClick={remove} disabled={busy} className="text-fog-loss hover:underline">
            Verwijder
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-ink-2 border border-ink-5 rounded px-2 py-1 text-xs text-neutral-200"
          />
          <input
            type="text"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="type (bv. trial-readout)"
            className="bg-ink-2 border border-ink-5 rounded px-2 py-1 text-xs text-neutral-200 w-48"
          />
          <Button size="sm" onClick={save} disabled={busy || !date}>Opslaan</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Annuleer</Button>
        </div>
      )}
    </div>
  );
}

/** De gemeten vervalcurve als staafjes — het bewijs onder het model. */
function CurveChart({ calib }: { calib: RocketCalibration }) {
  const curve = calib.curve ?? [];
  if (!curve.length) return null;
  const max = Math.max(...curve.map((c) => c.prob_pct), 1);
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2 h-24">
        {curve.map((c) => (
          <div key={c.days} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div className="text-[10px] font-mono tabular-nums text-fog-lime font-bold">
              {c.prob_pct.toFixed(1)}%
            </div>
            <div
              className="w-full rounded-t bg-gradient-to-t from-fog-pink/30 to-fog-lime/70"
              style={{ height: `${Math.max(4, (c.prob_pct / max) * 100)}%` }}
              title={`${c.hits} van ${c.n} waarnemingen`}
            />
            <div className="text-[10px] text-neutral-500 whitespace-nowrap">
              {c.days < 365 ? `${c.days}d` : `${Math.round(c.days / 365)}j`}
            </div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-neutral-500 text-center">
        Kans op een nieuwe ≥150%-explosie binnen 6 maanden, naar tijd sinds de vorige explosie.
        Gemeten op {calib.incidents?.toLocaleString("nl-NL") ?? "—"} incidenten uit het 10-jarige archief.
      </div>
    </div>
  );
}

export function RakettenView() {
  const [items, setItems] = useState<RocketItem[]>([]);
  const [calib, setCalib] = useState<RocketCalibration | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [favCount, setFavCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("alles");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chartFor, setChartFor] = useState<{ ticker: string; company: string; exchange: string | null } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchRocketScores({ limit: 300 });
      setItems(r.items);
      setCalib(r.calibration);
      setComputedAt(r.computed_at);
      setFavCount(r.favorite_count);
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
    return items;
  }, [items, scope]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await triggerRocketScan();
      toast("Herberekening gestart — dit duurt ongeveer een minuut", "success");
      // De run draait op de achtergrond; even wachten en dan opnieuw laden.
      setTimeout(() => void load(), 45_000);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Herberekenen mislukt", "error");
    } finally {
      setRefreshing(false);
    }
  }

  const nextRun = useMemo(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 7, 0));
  }, []);

  return (
    <div className="space-y-4">
      <CollapsibleIntro title="Raketten — kans op +150% in een maand" icon={<GradientTabIcon tab="favorieten" />}>
        <div className="text-sm text-neutral-300 leading-relaxed space-y-2">
          <p>
            Deze lijst schat per aandeel de kans dat het <strong>de komende 6 maanden ergens een
            periode van 30 dagen doormaakt met +150%</strong> — het soort sprong dat FNGR, Moderna en
            ARCT recent maakten.
          </p>
          <p className="text-xs text-neutral-400">
            Het model rust op één gemeten regelmaat: <strong className="text-neutral-300">explosies
            clusteren</strong>. Na een explosie volgt in 15% van de gevallen binnen 6 maanden een
            nieuwe ≥150%-explosie, tegen een basiskans van 4,6%. En dat effect dooft meetbaar uit
            naarmate de vorige explosie langer geleden is — dat is de curve hieronder. Die wordt bij
            elke run opnieuw uit het archief gemeten, dus het model groeit mee met de data.
          </p>
          <p className="text-xs text-neutral-400">
            Daaroverheen komen vermenigvuldigers die apart zijn gemeten: marktkapitalisatie,
            hikkertje-gedrag, ruimte tot de 5-jaarstop, aangekondigde katalysatoren en
            handelbaarheid. Klik op een rij om de volledige opbouw per aandeel te zien.
          </p>
          <p className="text-xs text-neutral-500">
            <strong className="text-neutral-400">Wat dit model wél en niet kan.</strong> Getoetst op de
            hele watchlist haalt het bovenste deciel 3,9× de basiskans, en de onderste 60% bevat
            vrijwel geen enkele stijger. Maar het wijst een risicopool aan, niet dé winnaar: van de
            vijf favorieten die recent ≥150% deden stonden er drie in het bovenste vijfde deel, en
            twee niet. Een hoge kans blijft een kans — 18% betekent dat het in ruim 4 van de 5
            gevallen níét gebeurt.
          </p>
        </div>
      </CollapsibleIntro>

      {calib && (
        <Card className="p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold">
            Gemeten vervalcurve
          </div>
          <CurveChart calib={calib} />
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Stat label="Gescoord" value={calib?.tickers_scored ?? items.length} />
        <Stat label="Getoond" value={filtered.length} />
        <Stat label="Favorieten" value={favCount} />
        <Stat label="Basiskans" value={calib?.base_rate_6m != null ? `${calib.base_rate_6m.toFixed(1)}%` : "—"} hint="zonder explosie-historie" />
        <div className="text-xs text-neutral-500">
          {computedAt ? (
            <>
              Berekend: {new Date(computedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
              {" · "}
              volgende: {nextRun.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
            </>
          ) : (
            "nog niet berekend"
          )}
        </div>
        {getToken() && (
          <div className="ml-auto">
            <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? "Bezig…" : "Ververs nu"}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold mr-1">Toon:</span>
        {(["alles", "favorieten", "handelbaar"] as Scope[]).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
              scope === s
                ? "border-fog-lime/40 text-fog-lime bg-fog-lime/10"
                : "border-ink-5 text-neutral-400 hover:text-neutral-200"
            }`}
            title={
              s === "handelbaar"
                ? "Verbergt sub-penny aandelen en dode orderboeken, waar +150% een spread-artefact is"
                : s === "favorieten"
                  ? "Alleen aandelen met een hartje"
                  : "De volledige watchlist"
            }
          >
            {s === "alles" ? "Hele watchlist" : s === "favorieten" ? "♥ Favorieten" : "Handelbaar"}
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
          <div className="text-4xl">🚀</div>
          <div className="text-sm font-semibold text-neutral-300">Nog geen ranglijst</div>
          <div className="text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
            De berekening draait de 1e van elke maand. Gebruik &ldquo;Ververs nu&rdquo; om hem
            direct te starten.
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
                  <th className="px-3 py-2 text-right" title="Geschatte kans op +150% binnen ~30 dagen, ergens in de komende 6 maanden">
                    Kans 6m
                  </th>
                  <th className="px-3 py-2 text-right" title="Tijd sinds de vorige explosie — de sterkste voorspeller">
                    Laatste explosie
                  </th>
                  <th className="px-3 py-2 text-right" title="Grootste explosie ooit gemeten voor dit aandeel">
                    Grootste
                  </th>
                  <th className="px-3 py-2 text-right">vs 5j-top</th>
                  <th className="px-3 py-2 text-right">Mcap</th>
                  <th className="px-3 py-2 text-right">$vol/dag</th>
                  <th className="px-3 py-2 text-right">Koers</th>
                  <th className="px-3 py-2 text-right">22d</th>
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
                            title="Sub-penny of nauwelijks omzet — een koerssprong is hier vaak niet te verzilveren"
                          >
                            DUN
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
                        <span className={probTone(r.prob_6m)}>{r.prob_6m.toFixed(1)}%</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-300 whitespace-nowrap">
                        {fmtDays(r.days_since_explosion)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-400">
                        {r.max_explosion_pct != null ? `+${Math.round(r.max_explosion_pct)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-fog-loss">
                        {r.pct_below_high5y != null ? `−${Math.round(r.pct_below_high5y)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-300 whitespace-nowrap">{fmtMcap(r.market_cap_usd)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-400 whitespace-nowrap">{fmtDollarVol(r.dollar_volume)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">{fmtPrice(r.last_close)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        <span className={r.pct_change_22d != null && r.pct_change_22d < 0 ? "text-fog-loss" : "text-fog-lime"}>
                          {fmtSignedPct(r.pct_change_22d)}
                        </span>
                      </td>
                    </tr>
                    {expanded === r.ticker && (
                      <tr className="bg-ink-3/20">
                        <td colSpan={14} className="px-6 py-4">
                          <div className="space-y-2 max-w-3xl">
                            <div className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold">
                              Opbouw van de kans
                            </div>
                            <div className="text-xs text-neutral-400">
                              Basis {r.base_prob.toFixed(1)}%
                              {r.factors.filter((f) => f.mult !== 1).length > 0 && " × de factoren hieronder"} ={" "}
                              <span className={probTone(r.prob_6m)}>{r.prob_6m.toFixed(1)}%</span>
                            </div>
                            <ul className="space-y-1">
                              {r.factors.map((f, k) => (
                                <li key={k} className="flex items-baseline gap-2 text-xs">
                                  <span
                                    className={`font-mono tabular-nums w-12 shrink-0 text-right ${
                                      f.mult > 1 ? "text-fog-lime" : f.mult < 1 ? "text-fog-loss" : "text-neutral-600"
                                    }`}
                                  >
                                    {f.mult === 1 ? "—" : `×${f.mult}`}
                                  </span>
                                  <span className="text-neutral-300 font-semibold w-32 shrink-0">{f.label}</span>
                                  <span className="text-neutral-400">{f.detail}</span>
                                </li>
                              ))}
                            </ul>
                            {r.explosion_count > 0 && (
                              <div className="text-[11px] text-neutral-500 pt-1">
                                {r.explosion_count} explosie{r.explosion_count === 1 ? "" : "s"} in het archief
                                {r.max_explosion_pct != null && `, grootste +${Math.round(r.max_explosion_pct)}%`}.
                              </div>
                            )}
                            {r.flags.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {r.flags.map((fl) => (
                                  <span
                                    key={fl}
                                    className="px-1.5 py-0.5 rounded text-[10px] border border-fog-loss/40 text-fog-loss bg-fog-loss/10 font-semibold"
                                  >
                                    {fl}
                                  </span>
                                ))}
                              </div>
                            )}
                            <CatalystEditor item={r} onChanged={() => void load()} />
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
