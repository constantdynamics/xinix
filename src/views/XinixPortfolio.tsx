import { useEffect, useMemo, useState } from "react";
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

function SimRankingTable({ strategies }: { strategies: SimStrategy[] }) {
  const [grpFilter, setGrpFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"rank" | "winrate" | "closed">("rank");

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
              <tr key={s.id} className={`border-t border-ink-5/40 hover:bg-ink-3/20 transition-colors ${s.protected ? "bg-fog-watch/[0.03]" : ""}`}>
                <td className="p-2 tabular text-neutral-400">{s.rank}</td>
                <td className="p-2 text-base leading-none">{s.medal ?? ""}</td>
                <td className="p-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-neutral-100">{s.name}</span>
                    <GenBadge gen={s.generation ?? 1} protected={s.protected ?? false} />
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
