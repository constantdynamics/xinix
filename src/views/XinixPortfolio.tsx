import { Fragment, useEffect, useMemo, useState } from "react";
import {
  fetchXinixPortfolio,
  fetchSimResults,
  triggerJob,
  triggerEvolve,
  getToken,
  type XinixPortfolio,
  type XinixOpenPosition,
  type XinixClosedPosition,
  type SimResults,
  type SimStrategy,
  type SimEvolution,
  type SimPosDetail,
  type SimStrategyConfig,
} from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import {
  Card,
  Badge,
  Button,
  Pill,
  SectionHeader,
  Dot,
  Sparkline,
  Stat,
} from "../components/ui";

const SIGNAL_LABELS: Record<string, string> = {
  near_90d_low: "Bij 90d-bodem",
  big_drop: "Forse daling",
  price_spike_up: "Koerssprong",
  volume_spike: "Volume-spike",
  jv_strategic: "JV/strategische deal",
  "8k_material": "SEC 8-K",
  buy_limit_hit: "Buy-limit hit",
  buy_limit_warmup: "Buy-limit nadert",
  buy_limit_close: "Vlak boven limit",
  pre_catalyst_7d: "Catalyst <7d",
  pre_catalyst_14d: "Catalyst <14d",
  pre_catalyst_30d: "Catalyst <30d",
  pre_catalyst_60d: "Catalyst <60d",
  financing: "Financiering",
  takeover_bid: "Overname-bod",
  buyout_definitive: "Overname definitief",
  topline_positive: "Trial topline +",
  pfs: "Mining PFS",
  resource_update: "Resource-update",
  loser_gem: "Daler + track",
  near5y_low_gem: "5y-bodem + track",
  macro_tide: "Macro-stroming",
};
function signalLabel(t: string): string {
  return SIGNAL_LABELS[t] ?? t;
}

function fmtUsd(v: number, decimals = 0): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  return `${sign}$${abs.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
function fmtPct(v: number, decimals = 1): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(decimals)}%`;
}
function fmtPrice(v: number): string {
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}
function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function XinixPortfolioView() {
  const [mainTab, setMainTab] = useState<"portfolio" | "sim">("portfolio");
  const [data, setData] = useState<XinixPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchXinixPortfolio()
      .then((d) => { setData(d); setLoading(false); setError(null); })
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false); });
  }
  useEffect(() => { load(); }, []);

  async function triggerNow() {
    if (!getToken()) {
      setTriggerMsg("Eerst Admin-token instellen bovenaan");
      return;
    }
    setTriggering(true);
    setTriggerMsg(null);
    try {
      await triggerJob("xinix-trade-background");
      setTriggerMsg("Trade-run getriggerd — herlaad over enkele seconden.");
      setTimeout(load, 4000);
    } catch (e) {
      setTriggerMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTriggering(false);
    }
  }

  if (loading) {
    return <Card className="p-10 text-center text-sm text-neutral-500">Laden…</Card>;
  }
  if (error) {
    return <Card className="p-4 text-sm text-fog-loss border-fog-loss/30">{error}</Card>;
  }
  if (!data) return null;

  const { state, open_positions, closed_positions, equity_history, signal_insights, sector_insights, recommendations } = data;
  const returnTone = state.total_return_pct >= 0 ? "lime" : "loss";

  return (
    <div className="space-y-6">
      {/* Tab-switcher: Portfolio vs Simulatie */}
      <div className="flex gap-0 border-b border-ink-5">
        {([["portfolio", "📈 Basisportefeuille"], ["sim", "🔬 100 Strategieën"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setMainTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              mainTab === key
                ? "border-fog-pink text-fog-pink"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mainTab === "sim" && <SimulationView />}
      {mainTab === "portfolio" && <div className="space-y-8">

      {/* Intro */}
      <Card className="p-4 border-fog-pink/30 bg-fog-pink/[0.04]">
        <div className="flex items-start gap-3">
          <Dot tone="pink" pulse />
          <div className="flex-1">
            <div className="font-bold text-neutral-100">Xinix — fictieve $10K portefeuille</div>
            <div className="text-xs text-neutral-400 mt-1 leading-relaxed">
              Xinix bestuurt zelf een papieren portefeuille van $10.000 op basis van scores + signalen.
              Strategie: max 8 posities van ~$1200, vast tijdvenster van 60 dagen, stop-loss op -15%.
              Doel: leren welke signalen voorspellende waarde hebben en aanbevelingen genereren om
              de scoring slimmer af te stellen.
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={triggerNow} disabled={triggering}>
            {triggering ? "…" : "▶ Run nu"}
          </Button>
        </div>
        {triggerMsg && <div className="mt-2 text-[11px] text-neutral-400">{triggerMsg}</div>}
      </Card>

      {/* KPI's */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="Totaal vermogen"
          value={fmtUsd(state.total_equity)}
          delta={{ value: state.total_return_pct }}
          tone={state.total_return_pct >= 0 ? "lime" : undefined}
          hint={`${fmtUsd(state.total_return_usd)} t.o.v. $${state.initial_capital.toFixed(0)}`}
        />
        <Stat
          label="Rendement"
          value={fmtPct(state.total_return_pct)}
          tone={returnTone === "lime" ? "lime" : undefined}
          hint={`gerealiseerd ${fmtUsd(state.realized_usd)} · open ${fmtUsd(state.unrealized_usd)}`}
        />
        <Stat
          label="Open posities"
          value={`${state.open_count}/8`}
          hint={`cash ${fmtUsd(state.cash)}`}
        />
        <Stat
          label="Gesloten trades"
          value={state.closed_count}
          hint={`gestart ${fmtDate(state.started_at)}`}
        />
      </div>

      {/* Equity curve */}
      {equity_history.length >= 2 && (
        <section>
          <SectionHeader
            eyebrow="Performance"
            title="Equity-curve"
            subtitle={`${equity_history.length} dagen, gestart ${fmtDate(state.started_at)}`}
          />
          <Card className="p-4">
            <div className="flex items-center gap-4">
              <Sparkline
                values={equity_history.map((p) => p.total_equity)}
                width={500}
                height={80}
                tone={state.total_return_pct >= 0 ? "lime" : "loss"}
              />
              <div className="text-xs text-neutral-400">
                <div className="flex justify-between gap-4">
                  <span>Start</span>
                  <span className="tabular text-neutral-200">{fmtUsd(state.initial_capital)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Nu</span>
                  <span className="tabular text-neutral-100 font-bold">{fmtUsd(state.total_equity)}</span>
                </div>
                <div className={`flex justify-between gap-4 mt-1 ${state.total_return_pct >= 0 ? "text-fog-lime" : "text-fog-loss"}`}>
                  <span>Δ</span>
                  <span className="tabular font-bold">{fmtPct(state.total_return_pct)}</span>
                </div>
              </div>
            </div>
          </Card>
        </section>
      )}

      {/* Open posities */}
      <OpenPositionsSection positions={open_positions} />

      {/* Inzichten + aanbevelingen */}
      {(recommendations.length > 0 || signal_insights.length > 0) && (
        <InsightsSection
          recommendations={recommendations}
          signal_insights={signal_insights}
          sector_insights={sector_insights}
        />
      )}

      {/* Gesloten trades */}
      <ClosedPositionsSection positions={closed_positions} />
    </div>}
    </div>
  );
}

function OpenPositionsSection({ positions }: { positions: XinixOpenPosition[] }) {
  return (
    <section>
      <SectionHeader
        eyebrow="Portefeuille"
        title="Open posities"
        subtitle={positions.length === 0 ? "Nog geen open posities" : `${positions.length} actief`}
      />
      {positions.length === 0 ? (
        <Card className="p-8 text-center text-sm text-neutral-500">
          Xinix heeft nog geen posities ingenomen. De volgende run is dagelijks om 22:00 UTC, of klik
          "Run nu" om handmatig te triggeren.
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="text-[10px] uppercase tracking-wider text-neutral-500 bg-ink-3/40">
              <tr>
                <th className="text-left p-3 font-semibold">Ticker</th>
                <th className="text-right p-3 font-semibold">Qty</th>
                <th className="text-right p-3 font-semibold">Entry</th>
                <th className="text-right p-3 font-semibold">Koers</th>
                <th className="text-right p-3 font-semibold">P/L</th>
                <th className="text-right p-3 font-semibold">Stop</th>
                <th className="text-right p-3 font-semibold">Dagen</th>
                <th className="text-left p-3 font-semibold">Reden</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const plTone =
                  p.unrealized_pct == null
                    ? "text-neutral-400"
                    : p.unrealized_pct > 0
                    ? "text-fog-lime"
                    : p.unrealized_pct < 0
                    ? "text-fog-loss"
                    : "text-neutral-300";
                return (
                  <tr key={p.id} className="border-t border-ink-5 hover:bg-ink-3/40">
                    <td className="p-3 font-bold whitespace-nowrap">
                      <a
                        href={googleFinanceUrl(p.ticker, p.exchange)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-fog-pink hover:underline"
                      >
                        {p.ticker}
                      </a>
                      <div className="text-[10px] font-normal text-neutral-500 truncate max-w-[140px]">
                        {p.company ?? "—"}
                      </div>
                    </td>
                    <td className="p-3 text-right tabular text-[11px] text-neutral-300">
                      {p.qty.toFixed(p.qty < 10 ? 3 : 1)}
                    </td>
                    <td className="p-3 text-right tabular text-[12px]">
                      <div>{fmtPrice(p.avg_price)}</div>
                      <div className="text-[10px] text-neutral-500">{fmtDate(p.entry_date)}</div>
                    </td>
                    <td className="p-3 text-right tabular text-[12px]">
                      {p.current_price != null ? fmtPrice(p.current_price) : <span className="text-neutral-500">—</span>}
                    </td>
                    <td className={`p-3 text-right tabular ${plTone}`}>
                      <div className="font-bold">
                        {p.unrealized_pct != null ? fmtPct(p.unrealized_pct) : "—"}
                      </div>
                      <div className="text-[10px]">
                        {p.unrealized_usd != null ? fmtUsd(p.unrealized_usd) : ""}
                      </div>
                    </td>
                    <td className="p-3 text-right tabular text-[12px] text-neutral-500">
                      {p.stop_loss_price != null ? fmtPrice(p.stop_loss_price) : "—"}
                    </td>
                    <td className="p-3 text-right tabular text-[12px]">
                      <span className={p.days_remaining <= 7 ? "text-fog-warn font-bold" : "text-neutral-400"}>
                        {p.days_remaining}d
                      </span>
                    </td>
                    <td className="p-3 text-[11px] text-neutral-400 max-w-xs">
                      <div className="line-clamp-1" title={p.entry_reason}>{p.entry_reason}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {p.entry_signal_types.slice(0, 3).map((s, i) => (
                          <Badge key={`${s}-${i}`} tone="neutral">{signalLabel(s)}</Badge>
                        ))}
                        {p.entry_signal_types.length > 3 && (
                          <span className="text-[10px] text-neutral-500">+{p.entry_signal_types.length - 3}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}

function ClosedPositionsSection({ positions }: { positions: XinixClosedPosition[] }) {
  const [show, setShow] = useState<"all" | "winners" | "losers">("all");
  const filtered = useMemo(() => {
    if (show === "winners") return positions.filter((p) => p.return_pct > 0);
    if (show === "losers") return positions.filter((p) => p.return_pct < 0);
    return positions;
  }, [positions, show]);
  const winners = positions.filter((p) => p.return_pct > 0).length;
  const losers = positions.filter((p) => p.return_pct < 0).length;

  return (
    <section>
      <SectionHeader
        eyebrow="Geschiedenis"
        title="Gesloten posities"
        subtitle={positions.length === 0 ? "Nog geen gesloten trades" : `${positions.length} trades · ${winners}W / ${losers}L`}
      />
      {positions.length === 0 ? null : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            <Pill tone="neutral" active={show === "all"} count={positions.length} onClick={() => setShow("all")} size="sm">Alles</Pill>
            <Pill tone="lime" active={show === "winners"} count={winners} onClick={() => setShow("winners")} size="sm">Winnaars</Pill>
            <Pill tone="loss" active={show === "losers"} count={losers} onClick={() => setShow("losers")} size="sm">Verliezers</Pill>
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="text-[10px] uppercase tracking-wider text-neutral-500 bg-ink-3/40">
                <tr>
                  <th className="text-left p-3 font-semibold">Ticker</th>
                  <th className="text-right p-3 font-semibold">Entry → Exit</th>
                  <th className="text-right p-3 font-semibold">Dagen</th>
                  <th className="text-right p-3 font-semibold">P/L</th>
                  <th className="text-left p-3 font-semibold">Reden entry</th>
                  <th className="text-left p-3 font-semibold">Reden exit</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const plTone = p.return_pct > 0 ? "text-fog-lime" : p.return_pct < 0 ? "text-fog-loss" : "text-neutral-300";
                  return (
                    <tr key={p.id} className="border-t border-ink-5 hover:bg-ink-3/40">
                      <td className="p-3 font-bold whitespace-nowrap">
                        <span className="text-fog-pink">{p.ticker}</span>
                        <div className="text-[10px] font-normal text-neutral-500 truncate max-w-[140px]">
                          {p.company ?? ""}
                        </div>
                      </td>
                      <td className="p-3 text-right tabular text-[11px]">
                        <div>{fmtPrice(p.avg_price)} → {fmtPrice(p.closed_price)}</div>
                        <div className="text-[10px] text-neutral-500">{fmtDate(p.entry_date)} → {fmtDate(p.closed_at)}</div>
                      </td>
                      <td className="p-3 text-right tabular text-[12px] text-neutral-400">{p.hold_days}d</td>
                      <td className={`p-3 text-right tabular ${plTone}`}>
                        <div className="font-bold">{fmtPct(p.return_pct)}</div>
                        <div className="text-[10px]">{fmtUsd(p.return_usd)}</div>
                      </td>
                      <td className="p-3 text-[11px] text-neutral-400 max-w-xs">
                        <div className="line-clamp-1" title={p.entry_reason}>{p.entry_reason}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {p.entry_signal_types.slice(0, 3).map((s, i) => (
                            <Badge key={`${s}-${i}`} tone="neutral">{signalLabel(s)}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 text-[11px] text-neutral-400 max-w-xs line-clamp-2" title={p.closed_reason}>
                        {p.closed_reason}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </section>
  );
}

function InsightsSection({
  recommendations,
  signal_insights,
  sector_insights,
}: {
  recommendations: string[];
  signal_insights: XinixPortfolio["signal_insights"];
  sector_insights: XinixPortfolio["sector_insights"];
}) {
  return (
    <section>
      <SectionHeader
        eyebrow="Lerende AI"
        title="Inzichten & aanbevelingen"
        subtitle="Wat Xinix heeft geleerd van gesloten trades — basis voor scorings-tuning"
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Aanbevelingen */}
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-fog-pink font-bold mb-2">
            Aanbevelingen voor het dashboard
          </div>
          {recommendations.length === 0 ? (
            <div className="text-xs text-neutral-500 italic">
              Nog te weinig data — Xinix heeft minimaal 3 gesloten posities per signaal-type
              nodig om betrouwbare aanbevelingen te doen.
            </div>
          ) : (
            <ul className="space-y-2">
              {recommendations.map((r, i) => (
                <li key={i} className="text-xs text-neutral-200 leading-relaxed">{r}</li>
              ))}
            </ul>
          )}
        </Card>

        {/* Signal-type performance */}
        <Card className="p-0 overflow-hidden">
          <div className="p-3 text-[10px] uppercase tracking-wider text-neutral-500 font-bold border-b border-ink-5">
            Performance per signaal-type
          </div>
          {signal_insights.length === 0 ? (
            <div className="p-4 text-xs text-neutral-500 italic">Nog geen gesloten trades.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-neutral-500 bg-ink-3/30">
                <tr>
                  <th className="text-left p-2 font-semibold">Signaal</th>
                  <th className="text-right p-2 font-semibold">N</th>
                  <th className="text-right p-2 font-semibold">Hit-rate</th>
                  <th className="text-right p-2 font-semibold">Gem. %</th>
                  <th className="text-right p-2 font-semibold">Totaal $</th>
                </tr>
              </thead>
              <tbody>
                {signal_insights.map((s) => (
                  <tr key={s.signal_type} className="border-t border-ink-5">
                    <td className="p-2">{signalLabel(s.signal_type)}</td>
                    <td className="p-2 text-right tabular">{s.closed_count}</td>
                    <td className={`p-2 text-right tabular ${s.win_rate >= 0.6 ? "text-fog-lime" : s.win_rate <= 0.4 ? "text-fog-loss" : "text-neutral-300"}`}>
                      {(s.win_rate * 100).toFixed(0)}%
                    </td>
                    <td className={`p-2 text-right tabular ${s.avg_return_pct >= 0 ? "text-fog-lime" : "text-fog-loss"}`}>
                      {fmtPct(s.avg_return_pct, 1)}
                    </td>
                    <td className={`p-2 text-right tabular ${s.total_return_usd >= 0 ? "text-fog-lime" : "text-fog-loss"}`}>
                      {fmtUsd(s.total_return_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Sector performance */}
        {sector_insights.length > 0 && (
          <Card className="p-0 overflow-hidden lg:col-span-2">
            <div className="p-3 text-[10px] uppercase tracking-wider text-neutral-500 font-bold border-b border-ink-5">
              Performance per sector
            </div>
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-neutral-500 bg-ink-3/30">
                <tr>
                  <th className="text-left p-2 font-semibold">Sector</th>
                  <th className="text-right p-2 font-semibold">N trades</th>
                  <th className="text-right p-2 font-semibold">Hit-rate</th>
                  <th className="text-right p-2 font-semibold">Gem. %</th>
                  <th className="text-right p-2 font-semibold">Totaal $</th>
                </tr>
              </thead>
              <tbody>
                {sector_insights.map((s) => (
                  <tr key={s.sector} className="border-t border-ink-5">
                    <td className="p-2 capitalize">{s.sector}</td>
                    <td className="p-2 text-right tabular">{s.closed_count}</td>
                    <td className={`p-2 text-right tabular ${s.win_rate >= 0.6 ? "text-fog-lime" : s.win_rate <= 0.4 ? "text-fog-loss" : "text-neutral-300"}`}>
                      {(s.win_rate * 100).toFixed(0)}%
                    </td>
                    <td className={`p-2 text-right tabular ${s.avg_return_pct >= 0 ? "text-fog-lime" : "text-fog-loss"}`}>
                      {fmtPct(s.avg_return_pct, 1)}
                    </td>
                    <td className={`p-2 text-right tabular ${s.total_return_usd >= 0 ? "text-fog-lime" : "text-fog-loss"}`}>
                      {fmtUsd(s.total_return_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 100-STRATEGIE SIMULATIE
// ═══════════════════════════════════════════════════════════════════════════════

function fmtPct2(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function fmtUsd2(v: number) {
  return `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(0)}`;
}

function RetCell({ v }: { v: number }) {
  const cls = v > 0 ? "text-fog-lime" : v < 0 ? "text-fog-loss" : "text-neutral-400";
  return <span className={cls}>{fmtPct2(v)}</span>;
}

const GROUP_LABELS: Record<string, string> = {
  "A-Score": "Score-drempel", "B-Hold": "Tijdvenster", "C-Stop": "Stop-loss",
  "D-TP": "Take-profit", "E-Sector": "Sector", "F-Concentratie": "Concentratie",
  "G-Signaal": "Signaal-type", "H-Medaille": "Medaille-filter", "I-Limiet": "Limiet-buffer",
  "J-Exit-combo": "Exit-combinatie", "K-Profiel": "Agressief profiel",
  "L-Profiel": "Conservatief profiel", "M-Combo": "Cross-combo",
};
function groupLabel(grp: string): string {
  if (GROUP_LABELS[grp]) return GROUP_LABELS[grp];
  const genMatch = grp.match(/^N-Gen(\d+)$/);
  if (genMatch) return `Evolutie Gen-${genMatch[1]}`;
  return grp;
}

function GenBadge({ gen, protected: prot }: { gen: number; protected: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {gen > 1 && (
        <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-fog-pink/20 text-fog-pink border border-fog-pink/30">
          G{gen}
        </span>
      )}
      {prot && (
        <span title="Beschermd — overleeft elke evolutiecyclus" className="text-[11px]">🛡️</span>
      )}
    </span>
  );
}

// ── Per-strategie uitleg helpers ─────────────────────────────────────────────

function stratDescBullets(cfg: SimStrategyConfig): [string, string, string] {
  const sectorDesc = cfg.sector === "biotech" ? "biotechbedrijven"
    : cfg.sector === "mining" ? "mijnbouwbedrijven"
    : "bedrijven uit alle sectoren";
  const goldDesc = cfg.minGold > 0
    ? ` en minstens ${cfg.minGold} goud-medaille${cfg.minGold > 1 ? "s" : ""}`
    : "";
  const redDesc = cfg.redReq ? " — rood-signaal verplicht als entry-bevestiging" : "";
  const b1 = `Selecteert ${sectorDesc} met een minimale score van ${cfg.minScore}${goldDesc}${redDesc}.`;

  const holdDesc = cfg.holdDays <= 30 ? `${cfg.holdDays} dagen (ultra-korte termijn)`
    : cfg.holdDays <= 60 ? `${cfg.holdDays} dagen (korte termijn)`
    : cfg.holdDays <= 90 ? `${cfg.holdDays} dagen (middellange termijn)`
    : `${cfg.holdDays} dagen (lange termijn)`;
  const limitDesc = cfg.limitBuf != null
    ? ` via limietorder ${Math.round(cfg.limitBuf * 100)}% boven actuele koers`
    : "";
  const b2 = `Houdt posities maximaal ${holdDesc}, max. ${cfg.maxPos} posities van ~$${cfg.posSize}${limitDesc}.`;

  const riskParts: string[] = [];
  if (cfg.stop != null) riskParts.push(`stop-loss op -${Math.round(Math.abs(cfg.stop) * 100)}%`);
  else riskParts.push("geen stop-loss (tijdvenster als risicogrens)");
  if (cfg.tp != null) riskParts.push(`take-profit op +${Math.round(cfg.tp * 100)}%`);
  else riskParts.push("geen take-profit (laat winnaars doorlopen)");
  const b3 = `Risicobeheer: ${riskParts.join(", ")}.`;

  return [b1, b2, b3];
}

function stratUniqueBullets(s: SimStrategy, all: SimStrategy[]): [string, string, string] {
  if (all.length < 2) return [
    "Originele configuratie — eerste generatie.",
    "Parameters zorgvuldig gekozen voor maximale diversiteit.",
    `Behoort tot groep "${groupLabel(s.grp)}".`,
  ];

  function med(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  const cfg = s.config;
  const candidates: Array<{ score: number; text: string }> = [];

  // holdDays
  const medHold = med(all.map(x => x.config.holdDays));
  const zHold = Math.abs(cfg.holdDays - medHold) / (medHold || 1);
  if (zHold > 0.25) {
    candidates.push({ score: zHold, text: cfg.holdDays > medHold
      ? `Bovengemiddeld lange houdperiode van ${cfg.holdDays} dagen (mediaan: ${medHold}d) — richt zich op langetermijnontwikkelingen die kortetermijnstrategieën missen.`
      : `Korte houdperiode van ${cfg.holdDays} dagen (mediaan: ${medHold}d) — roteert sneller en pakt korte koersbewegingen.` });
  }

  // minScore
  const medScore = med(all.map(x => x.config.minScore));
  const zScr = Math.abs(cfg.minScore - medScore) / (medScore || 1);
  if (zScr > 0.04) {
    candidates.push({ score: zScr * 2.5, text: cfg.minScore > medScore
      ? `Hoge score-drempel van ≥${cfg.minScore} (mediaan: ≥${medScore}) — koopt enkel bij sterke signalen, maximaliseert kwaliteitszekerheid per trade.`
      : `Lage score-drempel van ≥${cfg.minScore} (mediaan: ≥${medScore}) — bredere selectie, hogere activiteitsgraad bij iets zwakkere signalen.` });
  }

  // sector
  if (cfg.sector !== "all") {
    const pct = Math.round(all.filter(x => x.config.sector === cfg.sector).length / all.length * 100);
    candidates.push({ score: 2.5, text: `Pure ${cfg.sector === "biotech" ? "biotech" : "mijnbouw"}-specialist (${pct}% van strategieën richt zich op dezelfde sector) — diep gespecialiseerd in één markt.` });
  }

  // stop
  const stopCount = all.filter(x => x.config.stop != null).length;
  const stopPct = Math.round(stopCount / all.length * 100);
  if (cfg.stop == null && stopPct > 55) {
    candidates.push({ score: 1.5, text: `Geen stop-loss (${100 - stopPct}% van strategieën ook niet) — accepteert grotere interimdaling, laat het tijdvenster als enige exitregel werken.` });
  } else if (cfg.stop != null) {
    const allStops = all.filter(x => x.config.stop != null).map(x => Math.abs(x.config.stop!));
    if (allStops.length > 1) {
      const medStop = med(allStops);
      const thisStop = Math.abs(cfg.stop);
      const zStop = Math.abs(thisStop - medStop) / (medStop || 1);
      if (zStop > 0.2) candidates.push({ score: zStop + 1, text: thisStop < medStop
        ? `Strak stop-loss van -${Math.round(thisStop * 100)}% (mediaan: -${Math.round(medStop * 100)}%) — snijdt verliezen radicaal af, beschermt kapitaal maximaal.`
        : `Ruime stop-loss van -${Math.round(thisStop * 100)}% (mediaan: -${Math.round(medStop * 100)}%) — geeft aandelen meer speelruimte voor herstel.` });
    }
  }

  // TP
  const tpCount = all.filter(x => x.config.tp != null).length;
  const tpPct = Math.round(tpCount / all.length * 100);
  if (cfg.tp != null && tpPct < 40) {
    candidates.push({ score: 1.6, text: `Take-profit op +${Math.round(cfg.tp * 100)}% (slechts ${tpPct}% van strategieën hanteert een TP) — neemt winst definitief mee, voorkomt terugval.` });
  } else if (cfg.tp == null && tpPct > 55) {
    candidates.push({ score: 1.2, text: `Geen take-profit (${100 - tpPct}% ook niet) — trend-following aanpak, laat winnaars zo lang mogelijk doorlopen.` });
  }

  // maxPos
  const medMaxPos = med(all.map(x => x.config.maxPos));
  const zPos = Math.abs(cfg.maxPos - medMaxPos) / (medMaxPos || 1);
  if (zPos > 0.25) {
    candidates.push({ score: zPos + 0.5, text: cfg.maxPos < medMaxPos
      ? `Geconcentreerde portefeuille van max. ${cfg.maxPos} posities (mediaan: ${medMaxPos}) — hoge conviction per trade, grotere impact van individuele winnaars.`
      : `Brede spreiding over max. ${cfg.maxPos} posities (mediaan: ${medMaxPos}) — lagere concentratierisico, meer diversificatie.` });
  }

  // minGold
  if (cfg.minGold >= 2) {
    candidates.push({ score: 2.0, text: `Vereist minimaal ${cfg.minGold} goud-medailles — de strengste medaille-eis in het veld, enkel de meest beproefde signaalcombinaties passeren.` });
  } else if (cfg.minGold === 1) {
    candidates.push({ score: 1.3, text: `Eén goud-medaille als minimumeis (${Math.round(all.filter(x => x.config.minGold >= 1).length / all.length * 100)}% ook) — extra kwaliteitsfilter bovenop de score.` });
  }

  // redReq
  if (cfg.redReq) {
    candidates.push({ score: 1.4, text: `Rood-signaal verplicht bij entry (${Math.round(all.filter(x => x.config.redReq).length / all.length * 100)}% van strategieën) — vereist bewijs van kortetermijndruk als bevestiging.` });
  }

  // limitBuf
  if (cfg.limitBuf != null) {
    candidates.push({ score: 1.3, text: `Koopt via limietorder ${Math.round(cfg.limitBuf * 100)}% boven actuele koers (${Math.round(all.filter(x => x.config.limitBuf != null).length / all.length * 100)}% van strategieën) — disciplines entry-prijs.` });
  }

  // posSize
  const medSize = med(all.map(x => x.config.posSize));
  const zSize = Math.abs(cfg.posSize - medSize) / (medSize || 1);
  if (zSize > 0.2) {
    candidates.push({ score: zSize + 0.4, text: cfg.posSize > medSize
      ? `Grote positiegrootte van $${cfg.posSize} per trade (mediaan: $${medSize}) — hogere absolute blootstelling per aandeel.`
      : `Kleine positiegrootte van $${cfg.posSize} per trade (mediaan: $${medSize}) — conservatief kapitaalsgebruik, lagere blootstelling.` });
  }

  candidates.sort((a, b) => b.score - a.score);
  const fallbacks = [
    `Behoort tot groep "${groupLabel(s.grp)}" — geoptimaliseerd voor die specifieke configuratie-dimensie.`,
    "Gebalanceerde combinatie van parameters, zonder extreme uitschieters t.o.v. het gemiddelde van de 100 strategieën.",
    `${s.protected ? "Beschermde" : "Cullbare"} ${s.generation > 1 ? `Gen-${s.generation}` : "originele"} strategie met solide parameterruimte.`,
  ];
  while (candidates.length < 3) {
    candidates.push({ score: 0, text: fallbacks[candidates.length % fallbacks.length] });
  }
  return [candidates[0].text, candidates[1].text, candidates[2].text];
}

const GRP_LABELS_EXTRA: Record<string, string[]> = {
  "A-Score":       ["Score-geoptimaliseerd", "Fundamentele selectie"],
  "B-Hold":        ["Tijdvenster-expert",     "Hold-strategie"],
  "C-Stop":        ["Stop-loss specialist",   "Risicobeheer focus"],
  "D-TP":          ["Winstnemings-expert",    "Target-price strategie"],
  "E-Sector":      ["Sector-specialist",      "Niche-markt"],
  "F-Concentratie":["Concentratie-expert",    "Positiebeheer"],
  "G-Signaal":     ["Signaal-specialist",     "Signaalintensiteit focus"],
  "H-Medaille":    ["Medaille-filter expert", "Kwaliteits-selectie"],
  "I-Limiet":      ["Limietorder-expert",     "Prijsdiscipline"],
  "J-Exit-combo":  ["Exit-combinatie",        "Multi-factor exit"],
  "K-Profiel":     ["Agressief geoptimaliseerd","High-risk high-reward"],
  "L-Profiel":     ["Conservatief geoptimaliseerd","Kapitaalsbehoud"],
  "M-Combo":       ["Cross-factor strategie", "Multi-dimensioneel"],
};

function stratLabels(s: SimStrategy): string[] {
  const c = s.config;
  const labels: string[] = [];

  // Always present (8)
  labels.push("Algoritmisch", "Kwantitatief", "Daily signal scan", "Paper portefeuille",
    "Small/mid-cap focus", "US & Internationaal", "Technisch + Fundamenteel", "Niet-leveraged");

  // Sector (3-4)
  if (c.sector === "biotech") {
    labels.push("Biotech", "Healthcare", "FDA-katalysator", "Klinische trials");
  } else if (c.sector === "mining") {
    labels.push("Mining", "Grondstoffen", "Commodity", "Edelmetalen");
  } else {
    labels.push("Multi-sector", "Sector-neutraal", "Brede markt");
  }

  // Tijdshorizon (2-3)
  if (c.holdDays <= 30) {
    labels.push("Ultra-korte termijn", "Swing-trading", "Tactisch");
  } else if (c.holdDays <= 60) {
    labels.push("Korte termijn", "Momentum-trading", "Rotatie-stijl");
  } else if (c.holdDays <= 90) {
    labels.push("Middellange termijn", "Positie-trading");
  } else if (c.holdDays <= 120) {
    labels.push("Lange termijn", "Langetermijn-houder");
  } else {
    labels.push("Ultra-lange termijn", "Lottery-ticket", "5-jaar-horizon");
  }

  // Stop-loss (2-3)
  if (c.stop == null) {
    labels.push("Geen stop-loss", "Tijdvenster-exit", "Onbeperkt houdpotentieel");
  } else if (Math.abs(c.stop) <= 0.08) {
    labels.push("Tight stop (<8%)", "Beschermend", "Laag verliesrisico");
  } else if (Math.abs(c.stop) <= 0.15) {
    labels.push("Normale stop", "Gebalanceerd risicobeheer");
  } else {
    labels.push("Ruime stop (>15%)", "Hoge volatiliteitstolerantie", "Contrarian");
  }

  // Take-profit (1-2)
  if (c.tp == null) {
    labels.push("Geen take-profit", "Trend-following");
  } else if (c.tp >= 0.40) {
    labels.push("Hoge take-profit (≥40%)", "Agressief winstnemend");
  } else {
    labels.push("Take-profit actief", "Winstnemingsstrategie");
  }

  // Concentratie (1-2)
  if (c.maxPos <= 4) {
    labels.push("Geconcentreerd (≤4 pos)", "High-conviction");
  } else if (c.maxPos >= 8) {
    labels.push("Breed gespreide portefeuille", "Gediversifieerd");
  } else {
    labels.push("Gebalanceerde concentratie");
  }

  // Positiegrootte (1-2)
  if (c.posSize <= 900) {
    labels.push("Micro-posities", "Laag kapitaal per trade");
  } else if (c.posSize >= 1600) {
    labels.push("Grote posities", "Hoog kapitaal per trade");
  } else {
    labels.push("Standaard positiegrootte");
  }

  // Score-drempel (1-2)
  if (c.minScore >= 72) {
    labels.push("Strikt signaalfilter", "Hoge kwaliteitseis");
  } else if (c.minScore <= 58) {
    labels.push("Breed signaalnet", "Actief handelen");
  } else {
    labels.push("Gebalanceerde scorefilter");
  }

  // Entry type (1-2)
  if (c.redReq) {
    labels.push("Rood-signaal vereist", "Bevestigingsstrategie");
  } else {
    labels.push("Breed entry-criterium");
  }

  // Medaille-eis (1-2)
  if (c.minGold === 0) {
    labels.push("Geen medaille-eis");
  } else if (c.minGold === 1) {
    labels.push("Eén goud-medaille vereist", "Kwaliteitsfilter");
  } else {
    labels.push(`≥${c.minGold} goud-medailles vereist`, "Ultra-selectief");
  }

  // Limiet-buffer (1-2)
  if (c.limitBuf == null) {
    labels.push("Marktorder-entry");
  } else if (c.limitBuf <= 0.05) {
    labels.push("Strakke limietorder", "Prijsdiscipline");
  } else {
    labels.push("Ruime limietorder", "Geduldig instappen");
  }

  // Generatie (2)
  if (s.generation <= 1) {
    labels.push("Originele strategie", "Gen-1");
  } else {
    labels.push(`Evolutie Gen-${s.generation}`, "Nakomelingsstrategie");
  }

  // Bescherming (1)
  labels.push(s.protected ? "🛡️ Beschermd" : "Cullbaar");

  // Risicoprofiel composite (1-2)
  const riskScore =
    (c.stop == null ? 0 : Math.abs(c.stop) > 0.15 ? 1 : Math.abs(c.stop) < 0.08 ? -1 : 0) +
    (c.tp == null ? 1 : 0) +
    (c.maxPos <= 4 ? 1 : c.maxPos >= 8 ? -1 : 0) +
    (c.holdDays >= 90 ? 1 : c.holdDays <= 30 ? -1 : 0);
  if (riskScore >= 2) {
    labels.push("Agressief profiel", "Hoog risico / hoog potentieel");
  } else if (riskScore <= -2) {
    labels.push("Conservatief profiel", "Laag risico");
  } else {
    labels.push("Gebalanceerd risicoprofiel");
  }

  // Handelsfrequentie (1)
  const tradesPerYear = Math.round((365 / c.holdDays) * c.maxPos);
  labels.push(tradesPerYear >= 50 ? "Hoge handelsfrequentie" : tradesPerYear <= 10 ? "Lage handelsfrequentie" : "Gemiddelde handelsfrequentie");

  // Stijl composite (1-2)
  if (c.sector !== "all" && c.minGold >= 1) {
    labels.push("Event-driven", "Catalyst-speler");
  } else if (c.holdDays <= 40 && c.stop != null) {
    labels.push("Momentum-trader", "Technisch georiënteerd");
  } else if (c.holdDays >= 100) {
    labels.push("Value-investing-stijl", "Geduldig");
  } else {
    labels.push("Kwantitatief signaal-gedreven");
  }

  // Kapitaalefficiëntie (1)
  const maxDeploy = Math.min(100, Math.round((c.maxPos * c.posSize) / 10000 * 100));
  labels.push(`Max. ${maxDeploy}% gedeployed`);

  // Groep (2)
  const grpExtra = GRP_LABELS_EXTRA[s.grp] ?? ["Geëvolueerde variant", "Adaptieve strategie"];
  labels.push(...grpExtra);

  return labels;
}

// ── WhyBought ─────────────────────────────────────────────────────────────────

const SIG_EXPLAIN: Record<string, string> = {
  near_90d_low:    "nabij 90d-bodem",
  big_drop:        "forse koersdaling",
  price_spike_up:  "plotse koerssprong",
  volume_spike:    "volume-spike",
  jv_strategic:    "strategische deal / JV",
  "8k_material":   "SEC 8-K materieel event",
  buy_limit_hit:   "buy-limit bereikt",
  buy_limit_warmup:"buy-limit nadert",
  buy_limit_close: "vlak boven buy-limit",
  pre_catalyst_7d: "catalyst <7d",
  pre_catalyst_14d:"catalyst <14d",
  pre_catalyst_30d:"catalyst <30d",
  pre_catalyst_60d:"catalyst <60d",
  financing:       "financieringsronde",
  takeover_bid:    "overnamebod",
  buyout_definitive:"definitieve overname",
  topline_positive:"positieve trial-resultaten",
  pfs:             "mining prefeasibility-studie",
  resource_update: "resource-update",
  loser_gem:       "daler met sterk track-record",
  near5y_low_gem:  "nabij 5j-dieptepunt + track-record",
  macro_tide:      "macro-stroming",
};

function WhyBought({ pos, cfg }: { pos: SimPosDetail; cfg: SimStrategyConfig }) {
  const sigParts = pos.entry_signal_types.slice(0, 4).map(s => SIG_EXPLAIN[s] ?? s);
  const explanation = sigParts.length > 0 ? sigParts.join(", ") : (pos.entry_reason || "signaaldrempel gehaald");

  const ctxParts: string[] = [];
  if (cfg.redReq) ctxParts.push("rood-signaal aanwezig");
  if (cfg.minGold > 0) ctxParts.push(`≥${cfg.minGold} goud-medaille${cfg.minGold > 1 ? "s" : ""}`);
  if (cfg.sector !== "all") ctxParts.push(cfg.sector);

  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 py-0.5">
      <a
        href={googleFinanceUrl(pos.ticker)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] text-fog-pink font-medium hover:underline shrink-0"
      >
        {pos.ticker}
      </a>
      {pos.entry_date && (
        <span className="text-[10px] text-neutral-600 shrink-0">{fmtDate(pos.entry_date)}</span>
      )}
      <span className="text-[10px] text-neutral-400">
        {explanation}
        {ctxParts.length > 0 && <span className="text-neutral-600"> ({ctxParts.join(", ")})</span>}
        {pos.return_pct != null && (
          <span className={`ml-1 font-medium ${pos.return_pct >= 0 ? "text-fog-lime" : "text-fog-loss"}`}>
            → {pos.return_pct >= 0 ? "+" : ""}{pos.return_pct.toFixed(1)}%
          </span>
        )}
      </span>
    </div>
  );
}

// ── StrategyDetailPanel ───────────────────────────────────────────────────────

function StrategyDetailPanel({ s, all }: { s: SimStrategy; all: SimStrategy[] }) {
  const descBullets = stratDescBullets(s.config);
  const uniqueBullets = stratUniqueBullets(s, all);
  const labels = stratLabels(s);
  const hasPositions = (s.open_pos_detail?.length ?? 0) > 0 || (s.closed_pos_detail?.length ?? 0) > 0;

  return (
    <div className="px-4 py-4 bg-ink-3/25 border-b border-ink-5/40 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-fog-pink font-bold mb-2">
            Wat doet deze strategie
          </div>
          <ul className="space-y-1.5">
            {descBullets.map((b, i) => (
              <li key={i} className="text-[11px] text-neutral-300 flex gap-2 leading-relaxed">
                <span className="text-fog-pink shrink-0 mt-0.5">•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-fog-lime font-bold mb-2">
            Wat maakt haar uniek t.o.v. de andere strategieën
          </div>
          <ul className="space-y-1.5">
            {uniqueBullets.map((b, i) => (
              <li key={i} className="text-[11px] text-neutral-300 flex gap-2 leading-relaxed">
                <span className="text-fog-lime shrink-0 mt-0.5">◆</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-2">
          Familie & types <span className="text-neutral-600">({labels.length} labels)</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {labels.map((l, i) => (
            <span
              key={i}
              className="px-1.5 py-0.5 rounded text-[10px] bg-ink-3 border border-ink-5/60 text-neutral-500"
            >
              {l}
            </span>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-2">
          Waarom specifiek deze aandelen op dit moment gekocht
        </div>
        {hasPositions ? (
          <div className="space-y-0.5">
            {(s.open_pos_detail ?? []).map((pos, i) => (
              <WhyBought key={`o-${i}`} pos={pos} cfg={s.config} />
            ))}
            {(s.closed_pos_detail ?? []).slice(0, 3).map((pos, i) => (
              <WhyBought key={`c-${i}`} pos={pos} cfg={s.config} />
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-neutral-500 italic">
            Nog geen posities ingenomen — wacht op het juiste moment dat aan alle criteria voldoet:
            score ≥{s.config.minScore}
            {s.config.redReq ? ", rood-signaal vereist" : ""}
            {s.config.minGold > 0 ? `, ≥${s.config.minGold} goud-medaille` : ""}
            {s.config.sector !== "all" ? `, sector: ${s.config.sector}` : ""}.
          </div>
        )}
      </div>
    </div>
  );
}

function SimRankingTable({ strategies }: { strategies: SimStrategy[] }) {
  const [grpFilter, setGrpFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"rank" | "winrate" | "closed">("rank");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const groups = useMemo(() => ["all", ...new Set(strategies.map((s) => s.grp))], [strategies]);
  const filtered = useMemo(() => {
    let rows = grpFilter === "all" ? strategies : strategies.filter((s) => s.grp === grpFilter);
    if (sortBy === "winrate") rows = [...rows].sort((a, b) => b.win_rate - a.win_rate);
    else if (sortBy === "closed") rows = [...rows].sort((a, b) => b.closed_count - a.closed_count);
    return rows;
  }, [strategies, grpFilter, sortBy]);

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        {groups.map((g) => (
          <button
            key={g}
            onClick={() => setGrpFilter(g)}
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
              grpFilter === g
                ? "bg-fog-lime/20 border-fog-lime text-fog-lime"
                : "border-ink-5 text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {g === "all" ? "Alle groepen" : groupLabel(g)}
          </button>
        ))}
      </div>
      <div className="flex gap-2 mb-3 text-[11px]">
        <span className="text-neutral-500">Sorteer:</span>
        {(["rank", "winrate", "closed"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setSortBy(k)}
            className={`underline-offset-2 ${sortBy === k ? "text-fog-lime underline" : "text-neutral-400 hover:text-neutral-200"}`}
          >
            {k === "rank" ? "Rendement" : k === "winrate" ? "Hit-rate" : "Trades"}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[720px]">
          <thead className="text-[10px] uppercase tracking-wider text-neutral-500 bg-ink-3/30">
            <tr>
              <th className="text-left p-2 font-semibold w-8">#</th>
              <th className="text-left p-2 font-semibold w-6"></th>
              <th className="text-left p-2 font-semibold">Strategie</th>
              <th className="text-left p-2 font-semibold hidden md:table-cell">Groep</th>
              <th className="text-right p-2 font-semibold">Rendement</th>
              <th className="text-right p-2 font-semibold">Equity</th>
              <th className="text-right p-2 font-semibold hidden sm:table-cell">Hit-rate</th>
              <th className="text-right p-2 font-semibold hidden sm:table-cell">Trades</th>
              <th className="text-right p-2 font-semibold hidden lg:table-cell">Open</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <Fragment key={s.id}>
                <tr
                  className={`border-t border-ink-5/40 hover:bg-ink-3/20 transition-colors cursor-pointer select-none ${s.protected ? "bg-fog-watch/[0.03]" : ""} ${expandedId === s.id ? "bg-ink-3/30" : ""}`}
                  onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                >
                  <td className="p-2 tabular text-neutral-400">{s.rank}</td>
                  <td className="p-2 text-base leading-none">{s.medal ?? ""}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-neutral-100">{s.name}</span>
                      <GenBadge gen={s.generation ?? 1} protected={s.protected ?? false} />
                      <span className="text-[10px] text-neutral-600 ml-auto">{expandedId === s.id ? "▲" : "▼"}</span>
                    </div>
                    <div className="text-[10px] text-neutral-500 mt-0.5">
                      {s.config.holdDays}d
                      {s.config.stop != null && ` · stop-${(Math.abs(s.config.stop) * 100).toFixed(0)}%`}
                      {s.config.tp != null && ` · tp+${(s.config.tp * 100).toFixed(0)}%`}
                      {s.config.sector !== "all" && ` · ${s.config.sector}`}
                      {s.config.minGold > 0 && ` · ≥${s.config.minGold}🏆`}
                    </div>
                  </td>
                  <td className="p-2 hidden md:table-cell text-neutral-400 text-[11px]">
                    {groupLabel(s.grp)}
                  </td>
                  <td className="p-2 text-right tabular font-bold">
                    <RetCell v={s.total_return_pct} />
                  </td>
                  <td className="p-2 text-right tabular text-neutral-300">
                    ${s.total_equity.toFixed(0)}
                  </td>
                  <td className="p-2 text-right tabular hidden sm:table-cell">
                    {s.closed_count > 0 ? (
                      <span className={s.win_rate >= 0.5 ? "text-fog-lime" : "text-fog-loss"}>
                        {(s.win_rate * 100).toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-neutral-500">—</span>
                    )}
                  </td>
                  <td className="p-2 text-right tabular hidden sm:table-cell text-neutral-400">
                    {s.closed_count}
                  </td>
                  <td className="p-2 text-right tabular hidden lg:table-cell text-neutral-400">
                    {s.open_count}
                  </td>
                </tr>
                {expandedId === s.id && (
                  <tr>
                    <td colSpan={9} className="p-0">
                      <StrategyDetailPanel s={s} all={strategies} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SimInsightsSection({ sim }: { sim: SimResults }) {
  const { insights, recommendations, meta } = sim;
  return (
    <div className="space-y-4">
      {/* Recommendations */}
      <Card className="p-4 space-y-3">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
          Aanbevelingen voor het dashboard
        </div>
        {meta.strategies_with_closed_positions === 0 ? (
          <p className="text-xs text-neutral-400 italic">
            ⏳ Nog geen gesloten trades — inzichten verschijnen nadat de eerste posities sluiten (na 20–180 dagen, afhankelijk van strategie).
          </p>
        ) : (
          <ul className="space-y-2">
            {recommendations.map((r, i) => (
              <li key={i} className="text-xs text-neutral-200 leading-relaxed">{r}</li>
            ))}
          </ul>
        )}
      </Card>

      {/* Per-dimension insights */}
      {insights.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="p-3 text-[10px] uppercase tracking-wider text-neutral-500 font-bold border-b border-ink-5">
            Resultaten per configuratie-dimensie
          </div>
          <div className="divide-y divide-ink-5/40">
            {insights.map((ins) => (
              <div key={ins.dimension} className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-neutral-200">{ins.dimension}</span>
                  <span className="text-[11px] text-neutral-400">
                    beste: <span className="text-fog-lime font-mono">{ins.best}</span>
                    {" vs slechtste: "}
                    <span className="text-fog-loss font-mono">{ins.worst}</span>
                    {" ("}
                    <span className="text-fog-lime">+{ins.diff.toFixed(1)}%</span>
                    {" verschil)"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ins.entries.map((e) => (
                    <span
                      key={e.value}
                      title={`${e.value}: gem. ${fmtPct2(e.avgRet)} (n=${e.count})`}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono border ${
                        e.value === ins.best
                          ? "border-fog-lime/50 bg-fog-lime/10 text-fog-lime"
                          : e.value === ins.worst
                          ? "border-fog-loss/50 bg-fog-loss/10 text-fog-loss"
                          : "border-ink-5 text-neutral-400"
                      }`}
                    >
                      {e.value} {fmtPct2(e.avgRet)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function CyclePulse({ evo }: { evo: SimEvolution }) {
  const cycleStart = evo.cycle_start ? new Date(evo.cycle_start) : null;
  const cycleEnd   = evo.next_approx  ? new Date(evo.next_approx)  : null;
  if (!cycleStart || !cycleEnd) return null;

  const now         = Date.now();
  const totalMs     = cycleEnd.getTime() - cycleStart.getTime();
  const elapsedMs   = Math.max(0, now - cycleStart.getTime());
  const elapsedDays = Math.floor(elapsedMs / 86400000);
  const totalDays   = Math.round(totalMs / 86400000);
  const remainDays  = Math.max(0, totalDays - elapsedDays);
  const pct         = Math.min(100, Math.round((elapsedMs / totalMs) * 100));
  const barFull     = pct >= 100;

  // Markeer per 60 dagen (de holdDays van de basisstrategie) — 1 "tactische cyclus"
  const tacticalMarks = [60, 120];

  return (
    <div className="mb-4">
      <div className="flex justify-between text-[11px] text-neutral-400 mb-1.5">
        <span>
          Huidige cyclus: <strong className="text-neutral-200">{elapsedDays} van {totalDays} dagen</strong>
        </span>
        <span className={barFull ? "text-fog-lime font-semibold" : "text-neutral-400"}>
          {barFull
            ? "Klaar voor verversing"
            : `nog ${remainDays} dag${remainDays === 1 ? "" : "en"}`}
        </span>
      </div>

      {/* Progress bar */}
      <div className="relative h-3 rounded-full bg-ink-3/60 overflow-hidden border border-ink-5">
        <div
          className={`h-full rounded-full transition-all ${barFull ? "bg-fog-lime" : "bg-fog-watch/70"}`}
          style={{ width: `${pct}%` }}
        />
        {/* Tactische markeringen bij 60d en 120d */}
        {tacticalMarks.map((d) => (
          <div
            key={d}
            className="absolute top-0 bottom-0 w-px bg-ink-5/80"
            style={{ left: `${Math.round((d / totalDays) * 100)}%` }}
            title={`${d} dagen`}
          />
        ))}
      </div>

      <div className="flex justify-between text-[10px] text-neutral-600 mt-1">
        <span>{cycleStart.toLocaleDateString("nl-NL", { day: "2-digit", month: "short" })}</span>
        {tacticalMarks.map((d) => (
          <span key={d} className="text-neutral-700">60d</span>
        ))}
        <span>{cycleEnd.toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "numeric" })}</span>
      </div>

      <div className="flex gap-4 mt-2 text-[11px] flex-wrap">
        <span className="text-neutral-400">
          🛡️ <strong className="text-neutral-200">{evo.protected_count}</strong> beschermd (overleven altijd)
        </span>
        <span className="text-neutral-400">
          🌱 <strong className="text-neutral-200">{100 - evo.protected_count}</strong> cullbaar (bottom 10% gaat eruit)
        </span>
        <span className="text-neutral-400">
          ✂️ Verwacht: <strong className="text-neutral-200">~{Math.floor((100 - evo.protected_count) * 0.10)}</strong> strategie{Math.floor((100 - evo.protected_count) * 0.10) === 1 ? "" : "ën"} vervangen
        </span>
      </div>
    </div>
  );
}

function EvolutionPanel({ evo, isAdmin }: { evo: SimEvolution; isAdmin: boolean }) {
  const [evolving, setEvolving] = useState(false);
  const [evolveMsg, setEvolveMsg] = useState<string | null>(null);
  const [confirmForce, setConfirmForce] = useState(false);

  const nextDate = evo.next_approx ? new Date(evo.next_approx) : null;
  const daysUntil = nextDate ? Math.ceil((nextDate.getTime() - Date.now()) / 86400000) : null;
  const isPast = daysUntil != null && daysUntil <= 0;

  async function runEvolve(force: boolean) {
    setEvolving(true);
    setEvolveMsg(null);
    try {
      const result = await triggerEvolve(force) as Record<string, unknown>;
      if (result.skipped) {
        setEvolveMsg(`Overgeslagen: ${result.reason as string}`);
      } else {
        const culled = (result.culled as unknown[])?.length ?? 0;
        const spawned = (result.spawned as unknown[])?.length ?? 0;
        setEvolveMsg(`Gen-${result.generation}: ${culled} gecullled, ${spawned} nakomelingen. Herlaad om de ranglijst te zien.`);
      }
    } catch (e) {
      setEvolveMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setEvolving(false);
      setConfirmForce(false);
    }
  }

  return (
    <Card className="p-4 border-fog-watch/20 bg-fog-watch/[0.03]">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-1">
            Evolutie-mechanisme · 180-daagse cyclus
          </div>
          <div className="text-sm font-semibold text-neutral-100">
            {evo.cycles === 0 ? "Generatie 1 — nog geen cyclus afgerond" : `Generatie ${evo.max_generation} — ${evo.cycles} ${evo.cycles === 1 ? "cyclus" : "cycli"} voltooid`}
          </div>
        </div>
        {evo.retired.length > 0 && (
          <div className="text-center text-[11px] shrink-0">
            <div className="text-lg font-bold text-neutral-100">{evo.retired.length}</div>
            <div className="text-neutral-500">gepensioneerd</div>
          </div>
        )}
      </div>

      {/* Afteller met progress bar */}
      <CyclePulse evo={evo} />

      <div className="text-xs text-neutral-400 leading-relaxed mb-3">
        Na elke <strong className="text-neutral-200">180 dagen</strong> worden de onderste <strong className="text-neutral-200">10%</strong> van de niet-beschermde strategieën (≈8) gecullled en vervangen door nakomelingen van de top-15% met 1–3 mutaties.
        {" "}De <strong className="text-neutral-200">{evo.protected_count} beschermde</strong> strategieën (holdDays ≥ 90 — de "lottery-ticker" categorie die eens per 5 jaar spiket) overleven altijd.
      </div>

      {evo.last_at && (
        <div className="text-[11px] text-neutral-500 mb-3">
          Laatste evolutie: {new Date(evo.last_at).toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" })}
        </div>
      )}

      {evolveMsg && (
        <div className={`text-xs mb-3 p-2 rounded border ${evolveMsg.includes("Overgeslagen") || evolveMsg.includes("nakomelingen") ? "border-ink-5 text-neutral-300" : "border-fog-loss/30 text-fog-loss"}`}>
          {evolveMsg}
        </div>
      )}

      {isAdmin && (
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="secondary"
            disabled={evolving}
            onClick={() => runEvolve(false)}
          >
            {evolving ? "…" : isPast ? "▶ Voer cyclus uit" : "▶ Probeer cyclus"}
          </Button>
          {!confirmForce ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={evolving}
              onClick={() => setConfirmForce(true)}
            >
              Forceer nu
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={evolving}
              onClick={() => runEvolve(true)}
              className="border-fog-loss/50 text-fog-loss"
            >
              Bevestig forceer (onomkeerbaar)
            </Button>
          )}
          {confirmForce && (
            <button onClick={() => setConfirmForce(false)} className="text-[11px] text-neutral-500 hover:text-neutral-300">
              Annuleer
            </button>
          )}
        </div>
      )}

      {/* Evolutie-log */}
      {evo.run_log.length > 0 && (
        <details className="mt-3">
          <summary className="text-[11px] text-neutral-500 cursor-pointer hover:text-neutral-300">
            Evolutie-log ({evo.run_log.length} {evo.run_log.length === 1 ? "entry" : "entries"})
          </summary>
          <div className="mt-2 space-y-1">
            {evo.run_log.map((e, i) => (
              <div key={i} className="text-[10px] text-neutral-500">
                <span className="text-neutral-400">{new Date(e.at).toLocaleDateString("nl-NL")}:</span> {e.message}
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}

function RetiredSection({ retired }: { retired: SimEvolution["retired"] }) {
  if (retired.length === 0) return null;
  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-3 text-[10px] uppercase tracking-wider text-neutral-500 font-bold border-b border-ink-5">
        Gepensioneerde strategieën ({retired.length})
      </div>
      <div className="divide-y divide-ink-5/40">
        {retired.map((r) => (
          <div key={r.id} className="p-2 flex items-center gap-3 text-xs">
            <div className="w-5 text-center text-neutral-500">
              <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-neutral-700 text-neutral-400">G{r.generation}</span>
            </div>
            <div className="flex-1">
              <div className="text-neutral-300">{r.name}</div>
              <div className="text-[10px] text-neutral-500">
                {groupLabel(r.grp)} · {r.holdDays}d · {r.sector}
              </div>
            </div>
            <div className="text-[11px] text-neutral-500">
              {r.retired_at ? new Date(r.retired_at).toLocaleDateString("nl-NL") : "—"}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function SimulationView() {
  const [sim, setSim] = useState<SimResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"ranking" | "insights" | "evolutie">("ranking");

  useEffect(() => {
    fetchSimResults()
      .then(setSim)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const isAdmin = Boolean(getToken());

  if (loading) return <div className="text-xs text-neutral-400 py-4">Laden…</div>;
  if (error) return <div className="text-xs text-fog-loss py-4">Fout: {error}</div>;
  if (!sim) return null;

  const { meta, evolution } = sim;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="100 Strategieën — simulatie-ranglijst"
        subtitle={
          meta.last_run_at
            ? `Laatste run: ${new Date(meta.last_run_at).toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
            : "Nog niet gerund"
        }
        aside={isAdmin ? (
          <Button size="sm" variant="secondary" onClick={() => {
            triggerJob("xinix-sim-background").then(() => window.location.reload()).catch(() => {});
          }}>▶ Sim run</Button>
        ) : undefined}
      />

      {/* KPI row */}
      {(() => {
        const waitingCount = sim.strategies.filter(s => s.open_count === 0 && s.closed_count === 0).length;
        return (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="p-3 text-center">
                <div className="text-2xl font-bold tabular text-neutral-100">{meta.total}</div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mt-0.5">Actieve strategieën</div>
              </Card>
              <Card className="p-3 text-center">
                <div className="text-2xl font-bold tabular text-fog-lime">
                  {sim.strategies.filter((s) => s.total_return_pct > 0).length}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mt-0.5">Positief rendement</div>
              </Card>
              <Card className="p-3 text-center">
                <div className="text-2xl font-bold tabular text-neutral-100">{meta.strategies_with_closed_positions}</div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mt-0.5">Met gesloten trades</div>
              </Card>
              <Card className="p-3 text-center">
                <div className="text-2xl font-bold tabular text-neutral-400">{waitingCount}</div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mt-0.5">Wachten op entry</div>
              </Card>
            </div>
            {waitingCount > 0 && (
              <p className="text-[11px] text-neutral-500 -mt-1">
                💰 {waitingCount} strategie{waitingCount === 1 ? "" : "ën"} houd{waitingCount === 1 ? "t" : "en"} volledig cash — hun criteria (hoge score-drempel, medaille-eis of sector-focus) zijn nog niet getriggerd. Dit is normaal: sommige zijn bewust selectief en wachten op het juiste moment.
              </p>
            )}
          </>
        );
      })()}

      {/* Top 3 podium */}
      {sim.strategies.length >= 3 && (
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-2">Podium</div>
          <div className="grid grid-cols-3 gap-3 text-center text-xs">
            {[sim.strategies[1], sim.strategies[0], sim.strategies[2]].map((s, podiumIdx) => {
              const emoji = podiumIdx === 0 ? "🥈" : podiumIdx === 1 ? "🏆" : "🥉";
              return (
                <div key={s.id} className="space-y-1">
                  <div className={podiumIdx === 1 ? "text-lg" : "text-base"}>{emoji}</div>
                  <div className="font-semibold text-neutral-100 line-clamp-2 text-[11px]">{s.name}</div>
                  <div className="flex items-center justify-center gap-1">
                    <GenBadge gen={s.generation ?? 1} protected={s.protected ?? false} />
                  </div>
                  <div className={`font-bold tabular ${s.total_return_pct >= 0 ? "text-fog-lime" : "text-fog-loss"}`}>
                    {fmtPct2(s.total_return_pct)}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Tab switcher */}
      <div className="flex gap-0 border-b border-ink-5">
        {(["ranking", "insights", "evolutie"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors -mb-px ${
              activeTab === t
                ? "border-fog-lime text-fog-lime"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {t === "ranking" ? "Ranglijst" : t === "insights" ? "Inzichten" : `Evolutie${evolution.cycles > 0 ? ` (${evolution.cycles})` : ""}`}
          </button>
        ))}
      </div>

      {activeTab === "ranking" && <SimRankingTable strategies={sim.strategies} />}
      {activeTab === "insights" && <SimInsightsSection sim={sim} />}
      {activeTab === "evolutie" && (
        <div className="space-y-4">
          <EvolutionPanel evo={evolution} isAdmin={isAdmin} />
          <RetiredSection retired={evolution.retired} />
        </div>
      )}
    </section>
  );
}
