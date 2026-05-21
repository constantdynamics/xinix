import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchXinixPortfolio,
  fetchSimResults,
  fetchScanResults,
  fetchKnowledgeExports,
  triggerJob,
  triggerEvolve,
  triggerKnowledgeExport,
  knowledgeExportDownloadUrl,
  getToken,
  type XinixPortfolio,
  type XinixOpenPosition,
  type XinixClosedPosition,
  type SimResults,
  type SimStrategy,
  type SimEvolution,
  type SimPosDetail,
  type SimStrategyConfig,
  type KnowledgeExportSummary,
  type PhoenixRankEntry,
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
import { useMarks } from "../hooks/useMarks";
import {
  HeartCell,
  HeartHeader,
  SeenCell,
  SeenHeader,
  ShowSeenToggle,
  MarkAllSeenButton,
  HideFavoritesToggle,
  NotYetReviewedTile,
  StarCell,
  StarHeader,
} from "../components/MarkCells";

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
  // Rond eerst af en bepaal pas dán het teken — anders toont bv. -0,3 als "-$0".
  const factor = 10 ** decimals;
  const rounded = Math.round(v * factor) / factor;
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
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
  const [mainTab, setMainTab] = useState<"portfolio" | "sim" | "families">("portfolio");
  const [data, setData] = useState<XinixPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchXinixPortfolio()
      .then((d) => { setData(d); setLoading(false); setError(null); })
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false); });
  }
  useEffect(() => { load(); }, []);


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
        {([["portfolio", "📈 Basisportefeuille"], ["sim", "🔬 200 Strategieën"], ["families", "🧬 Families"]] as const).map(([key, label]) => (
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
      {mainTab === "families" && <FamiliesView />}
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
        </div>
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
          Xinix heeft nog geen posities ingenomen. De volgende run is dagelijks om 22:05 UTC (na US close).
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

function stratDescBullets(s: SimStrategy): [string, string, string] {
  if (!s.config) return [
    "Configuratie nog niet beschikbaar.",
    "Deze strategie is gegenereerd door het evolutieproces.",
    "Meer details beschikbaar na de volgende simulatierun.",
  ];
  const cfg = s.config;
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

  // Bullet 3: risicobeheer + echte performance als die beschikbaar is
  const stopDesc = cfg.stop != null ? `stop-loss op -${Math.round(Math.abs(cfg.stop) * 100)}%` : "geen stop-loss";
  const tpDesc = cfg.tp != null ? `take-profit op +${Math.round(cfg.tp * 100)}%` : "geen take-profit";

  let b3: string;
  if (s.closed_count >= 3) {
    const hitPct = Math.round(s.win_rate * 100);
    const tone = s.total_return_pct >= 0 ? "positief" : "negatief";
    b3 = `${stopDesc}, ${tpDesc}. Prestaties tot nu: ${s.closed_count} trades, ${hitPct}% hitrate, gem. ${s.avg_return_pct >= 0 ? "+" : ""}${s.avg_return_pct.toFixed(1)}% per trade — ${tone} begin.`;
  } else {
    b3 = `${stopDesc}, ${tpDesc} — ${cfg.tp == null ? "laat winnaars doorlopen tot het tijdvenster sluit" : "neemt winst definitief mee"}.`;
  }

  return [b1, b2, b3];
}

function stratUniqueBullets(s: SimStrategy, all: SimStrategy[]): [string, string, string] {
  if (all.length < 2 || !s.config) return [
    "Originele configuratie — eerste generatie.",
    "Parameters zorgvuldig gekozen voor maximale diversiteit.",
    `Behoort tot groep "${groupLabel(s.grp)}".`,
  ];

  function med(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  const cfg = s.config;
  const valid = all.filter(x => x.config != null);
  const candidates: Array<{ score: number; text: string }> = [];

  // holdDays
  const medHold = med(valid.map(x => x.config.holdDays));
  const zHold = Math.abs(cfg.holdDays - medHold) / (medHold || 1);
  if (zHold > 0.25) {
    candidates.push({ score: zHold, text: cfg.holdDays > medHold
      ? `Bovengemiddeld lange houdperiode van ${cfg.holdDays} dagen (mediaan: ${medHold}d) — richt zich op langetermijnontwikkelingen die kortetermijnstrategieën missen.`
      : `Korte houdperiode van ${cfg.holdDays} dagen (mediaan: ${medHold}d) — roteert sneller en pakt korte koersbewegingen.` });
  }

  // minScore
  const medScore = med(valid.map(x => x.config.minScore));
  const zScr = Math.abs(cfg.minScore - medScore) / (medScore || 1);
  if (zScr > 0.04) {
    candidates.push({ score: zScr * 2.5, text: cfg.minScore > medScore
      ? `Hoge score-drempel van ≥${cfg.minScore} (mediaan: ≥${medScore}) — koopt enkel bij sterke signalen, maximaliseert kwaliteitszekerheid per trade.`
      : `Lage score-drempel van ≥${cfg.minScore} (mediaan: ≥${medScore}) — bredere selectie, hogere activiteitsgraad bij iets zwakkere signalen.` });
  }

  // sector
  if (cfg.sector !== "all") {
    const pct = Math.round(valid.filter(x => x.config.sector === cfg.sector).length / valid.length * 100);
    candidates.push({ score: 2.5, text: `Pure ${cfg.sector === "biotech" ? "biotech" : "mijnbouw"}-specialist (${pct}% van strategieën richt zich op dezelfde sector) — diep gespecialiseerd in één markt.` });
  }

  // stop
  const stopCount = valid.filter(x => x.config.stop != null).length;
  const stopPct = Math.round(stopCount / valid.length * 100);
  if (cfg.stop == null && stopPct > 55) {
    candidates.push({ score: 1.5, text: `Geen stop-loss (${100 - stopPct}% van strategieën ook niet) — accepteert grotere interimdaling, laat het tijdvenster als enige exitregel werken.` });
  } else if (cfg.stop != null) {
    const allStops = valid.filter(x => x.config.stop != null).map(x => Math.abs(x.config.stop!));
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
  const tpCount = valid.filter(x => x.config.tp != null).length;
  const tpPct = Math.round(tpCount / valid.length * 100);
  if (cfg.tp != null && tpPct < 40) {
    candidates.push({ score: 1.6, text: `Take-profit op +${Math.round(cfg.tp * 100)}% (slechts ${tpPct}% van strategieën hanteert een TP) — neemt winst definitief mee, voorkomt terugval.` });
  } else if (cfg.tp == null && tpPct > 55) {
    candidates.push({ score: 1.2, text: `Geen take-profit (${100 - tpPct}% ook niet) — trend-following aanpak, laat winnaars zo lang mogelijk doorlopen.` });
  }

  // maxPos
  const medMaxPos = med(valid.map(x => x.config.maxPos));
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
    candidates.push({ score: 1.3, text: `Eén goud-medaille als minimumeis (${Math.round(valid.filter(x => x.config.minGold >= 1).length / valid.length * 100)}% ook) — extra kwaliteitsfilter bovenop de score.` });
  }

  // redReq
  if (cfg.redReq) {
    candidates.push({ score: 1.4, text: `Rood-signaal verplicht bij entry (${Math.round(valid.filter(x => x.config.redReq).length / valid.length * 100)}% van strategieën) — vereist bewijs van kortetermijndruk als bevestiging.` });
  }

  // limitBuf
  if (cfg.limitBuf != null) {
    candidates.push({ score: 1.3, text: `Koopt via limietorder ${Math.round(cfg.limitBuf * 100)}% boven actuele koers (${Math.round(valid.filter(x => x.config.limitBuf != null).length / valid.length * 100)}% van strategieën) — disciplines entry-prijs.` });
  }

  // posSize
  const medSize = med(valid.map(x => x.config.posSize));
  const zSize = Math.abs(cfg.posSize - medSize) / (medSize || 1);
  if (zSize > 0.2) {
    candidates.push({ score: zSize + 0.4, text: cfg.posSize > medSize
      ? `Grote positiegrootte van $${cfg.posSize} per trade (mediaan: $${medSize}) — hogere absolute blootstelling per aandeel.`
      : `Kleine positiegrootte van $${cfg.posSize} per trade (mediaan: $${medSize}) — conservatief kapitaalsgebruik, lagere blootstelling.` });
  }

  candidates.sort((a, b) => b.score - a.score);
  const fallbacks = [
    `Behoort tot groep "${groupLabel(s.grp)}" — geoptimaliseerd voor die specifieke configuratie-dimensie.`,
    "Gebalanceerde combinatie van parameters, zonder extreme uitschieters t.o.v. het gemiddelde van de 200 strategieën.",
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
  if (!s.config) return ["Algoritmisch", "Kwantitatief", "Paper portefeuille", "Evolutie-generatie"];
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

  // Performance-labels (data-gedreven, optioneel)
  if (s.closed_count >= 5) {
    if (s.win_rate >= 0.70) labels.push("Hoge hitrate (≥70%)");
    else if (s.win_rate <= 0.35) labels.push("Lage hitrate (≤35%)");
  }
  if (s.closed_count >= 10) labels.push("Actief handelend (≥10 trades)");
  if (s.open_count === 0 && s.closed_count === 0) labels.push("Wacht op entry");
  if (s.rank <= 10) labels.push("🏆 Top-10 performer");
  else if (s.rank <= 30) labels.push("Top-30");
  if (s.total_return_pct >= 20) labels.push("Uitzonderlijk rendement (>+20%)");
  else if (s.total_return_pct >= 10) labels.push("Sterk rendement (>+10%)");

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
  const descBullets = stratDescBullets(s);
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
        {/* Tactische markeringen bij 60d en 120d — alleen bij een geldige
            cycluslengte, anders deelt d/totalDays door 0 → left: Infinity%. */}
        {totalDays > 0 && tacticalMarks.map((d) => {
          const left = Math.min(100, Math.max(0, Math.round((d / totalDays) * 100)));
          return (
            <div
              key={d}
              className="absolute top-0 bottom-0 w-px bg-ink-5/80"
              style={{ left: `${left}%` }}
              title={`${d} dagen`}
            />
          );
        })}
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

// ── KnowledgeExportSection ────────────────────────────────────────────────────

function KnowledgeExportSection({ isAdmin }: { isAdmin: boolean }) {
  const [exports, setExports] = useState<KnowledgeExportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState<number | null>(null);

  useEffect(() => {
    fetchKnowledgeExports()
      .then(r => setExports(r.exports))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function doExport() {
    setExporting(true);
    setExportMsg(null);
    try {
      const r = await triggerKnowledgeExport();
      setExportMsg(`✅ Export #${r.export_id ?? "?"} aangemaakt — ${r.strategy_count} strategieën, ${r.ticker_count} tickers, ${r.closed_positions_count} gesloten trades. Herlaad om te downloaden.`);
      // Herlaad lijst
      const updated = await fetchKnowledgeExports();
      setExports(updated.exports);
    } catch (e) {
      setExportMsg(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  // Volgende geplande export (1e van de volgende maand)
  const nextExport = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 1);
    d.setHours(6, 0, 0, 0);
    return d;
  }, []);
  const daysUntilNext = Math.ceil((nextExport.getTime() - Date.now()) / 86400000);

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card className="p-4 border-fog-watch/20 bg-fog-watch/[0.02]">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-1">
              Kenniscumulatie & export
            </div>
            <div className="text-sm font-semibold text-neutral-100">
              Maandelijkse snapshot van alle strategie-kennis
            </div>
          </div>
          <div className="text-center text-[11px] shrink-0">
            <div className="text-2xl font-bold tabular text-neutral-100">{exports.length}</div>
            <div className="text-neutral-500">snapshots</div>
          </div>
        </div>

        <p className="text-xs text-neutral-400 leading-relaxed mb-3">
          Elke <strong className="text-neutral-200">1e van de maand</strong> wordt automatisch een volledige snapshot opgeslagen: alle 200 strategieën met hun config + performance, de volledige watchlist met buy-limieten en medailles, alle gesloten posities uitgesplitst per signaaltype + sector, en configuratie-inzichten.
          Op de <strong className="text-neutral-200">25e</strong> ontvang je een herinnering om de stand ook handmatig door te nemen.
        </p>

        <div className="text-[11px] text-neutral-500 mb-3">
          Volgende automatische export: <strong className="text-neutral-300">{nextExport.toLocaleDateString("nl-NL", { day: "2-digit", month: "long", year: "numeric" })}</strong>
          {" "}(<span className={daysUntilNext <= 7 ? "text-fog-warn" : ""}>{daysUntilNext} dag{daysUntilNext === 1 ? "" : "en"}</span>)
        </div>

        {exportMsg && (
          <div className={`text-xs mb-3 p-2 rounded border ${exportMsg.startsWith("✅") ? "border-fog-lime/30 text-fog-lime" : "border-fog-loss/30 text-fog-loss"}`}>
            {exportMsg}
          </div>
        )}

        {isAdmin && (
          <Button size="sm" variant="secondary" disabled={exporting} onClick={doExport}>
            {exporting ? "Exporteren…" : "📦 Export nu"}
          </Button>
        )}
      </Card>

      {/* Export history */}
      {loading ? (
        <div className="text-xs text-neutral-500 py-2">Laden…</div>
      ) : exports.length === 0 ? (
        <Card className="p-6 text-center text-xs text-neutral-500 italic">
          Nog geen exports — de eerste automatische export verschijnt op de 1e van volgende maand, of klik "Export nu".
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="p-3 text-[10px] uppercase tracking-wider text-neutral-500 font-bold border-b border-ink-5">
            Export-archief ({exports.length})
          </div>
          <div className="divide-y divide-ink-5/40">
            {exports.map((ex) => (
              <div key={ex.id} className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-semibold text-neutral-200">
                        #{ex.id} — {new Date(ex.exported_at).toLocaleDateString("nl-NL", { day: "2-digit", month: "long", year: "numeric" })}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                        ex.type === "monthly_auto"
                          ? "bg-fog-lime/10 border-fog-lime/30 text-fog-lime"
                          : "bg-ink-3 border-ink-5 text-neutral-500"
                      }`}>
                        {ex.type === "monthly_auto" ? "auto" : "manueel"}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-1 text-[11px] text-neutral-500">
                      {ex.strategy_count != null && <span>{ex.strategy_count} strategieën</span>}
                      {ex.ticker_count != null && <span>{ex.ticker_count} tickers</span>}
                      {ex.closed_positions_count != null && <span>{ex.closed_positions_count} gesloten trades</span>}
                      {ex.strategies_in_profit != null && ex.strategy_count && (
                        <span className="text-fog-lime">{ex.strategies_in_profit}/{ex.strategy_count} in winst</span>
                      )}
                    </div>
                    {ex.best_strategy_name && (
                      <div className="text-[11px] text-neutral-400 mt-0.5">
                        Beste: <span className="text-fog-lime font-medium">{ex.best_strategy_name}</span>
                        {ex.best_strategy_return != null && (
                          <span className="text-fog-lime"> (+{ex.best_strategy_return.toFixed(2)}%)</span>
                        )}
                        {ex.worst_strategy_name && ex.worst_strategy_return != null && (
                          <span className="text-neutral-500"> · slechtste: {ex.worst_strategy_name} ({ex.worst_strategy_return.toFixed(2)}%)</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <a
                      href={knowledgeExportDownloadUrl(ex.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2 py-1 rounded text-[11px] border border-ink-5 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 transition-colors"
                    >
                      ⬇ JSON
                    </a>
                    {ex.summary && (
                      <button
                        onClick={() => setShowSummary(showSummary === ex.id ? null : ex.id)}
                        className="px-2 py-1 rounded text-[11px] border border-ink-5 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 transition-colors"
                      >
                        {showSummary === ex.id ? "▲ Verberg" : "▼ Samenvatting"}
                      </button>
                    )}
                  </div>
                </div>
                {showSummary === ex.id && ex.summary && (
                  <pre className="text-[10px] text-neutral-400 bg-ink-3/40 rounded p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed border border-ink-5/40">
                    {ex.summary}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
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
        title="200 Strategieën — simulatie-ranglijst"
        subtitle={
          meta.last_run_at
            ? `Laatste run: ${new Date(meta.last_run_at).toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
            : "Nog niet gerund"
        }
        aside={undefined}
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
          <KnowledgeExportSection isAdmin={isAdmin} />
        </div>
      )}
    </section>
  );
}

// ── PhoenixView ───────────────────────────────────────────────────────────────

type PhoenixSortKey =
  | "above_limit_pct"
  | "phoenix_50x_date"
  | "phoenix_incident_count"
  | "phoenix_median_date"
  | "phoenix_max_growth_180d_pct"
  | "phoenix_days_to_50x";

type SortDir = "asc" | "desc";

interface PhoenixColumn {
  key: PhoenixSortKey;
  label: string;
  short: string;
  defaultDir: SortDir;
  hint: string;
}

const PHOENIX_COLUMNS: PhoenixColumn[] = [
  { key: "above_limit_pct", label: "Afstand tot aankooplimiet", short: "Limit %", defaultDir: "asc", hint: "Hoe dichter bij 0 (of negatief), hoe dichter bij de aankooplimiet" },
  { key: "phoenix_incident_count", label: "Aantal feniks-incidenten", short: "# 50×", defaultDir: "desc", hint: "Aantal afzonderlijke 50×-runs in de afgelopen 10 jaar" },
  { key: "phoenix_median_date", label: "Mediaan datum (dagen geleden)", short: "Mediaan dagen", defaultDir: "asc", hint: "Hoeveel dagen geleden de mediaan-50× plaatsvond" },
  { key: "phoenix_max_growth_180d_pct", label: "Max groei in 180 dagen", short: "Max 180d %", defaultDir: "desc", hint: "Hoogste groei vanaf baseline binnen 180 dagen" },
  { key: "phoenix_days_to_50x", label: "Dagen tot 50×", short: "Dagen → 50×", defaultDir: "asc", hint: "Mediaan aantal dagen tussen baseline en 50×-piek" },
  { key: "phoenix_50x_date", label: "Laatste 50× datum", short: "Laatste 50×", defaultDir: "desc", hint: "Datum van het meest recente 50×-incident" },
];

function daysAgo(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 86400000);
}

function getSortValue(p: PhoenixRankEntry, key: PhoenixSortKey): number | null {
  switch (key) {
    case "above_limit_pct": return p.above_limit_pct;
    case "phoenix_incident_count": return p.phoenix_incident_count;
    case "phoenix_median_date": return daysAgo(p.phoenix_median_date);
    case "phoenix_max_growth_180d_pct": return p.phoenix_max_growth_180d_pct;
    case "phoenix_days_to_50x": return p.phoenix_days_to_50x;
    case "phoenix_50x_date": {
      const t = p.phoenix_50x_date ? new Date(p.phoenix_50x_date).getTime() : null;
      return t != null && Number.isFinite(t) ? t : null;
    }
  }
}

// Facet-bucket: één checkbox-keuze binnen een criterium-groep.
// Match krijgt de feniks-entry én de afgeleide numerieke waarde (zoals
// daysAgo voor datums); een rij valt in deze bucket als match true is.
interface FacetBucket {
  id: string;
  label: string;
  match: (p: PhoenixRankEntry) => boolean;
}

interface FacetGroup {
  key: PhoenixSortKey;
  label: string;
  buckets: FacetBucket[];
}

const FACET_GROUPS: FacetGroup[] = [
  {
    key: "phoenix_incident_count",
    label: "Aantal feniks-incidenten",
    buckets: [
      { id: "1", label: "1 incident", match: (p) => p.phoenix_incident_count === 1 },
      { id: "2", label: "2 incidenten", match: (p) => p.phoenix_incident_count === 2 },
      { id: "3plus", label: "3 of meer", match: (p) => (p.phoenix_incident_count ?? 0) >= 3 },
    ],
  },
  {
    key: "phoenix_median_date",
    label: "Mediaan datum (hoe lang geleden)",
    buckets: [
      { id: "lt1y", label: "< 1 jaar geleden", match: (p) => { const d = daysAgo(p.phoenix_median_date); return d != null && d < 365; } },
      { id: "1to3y", label: "1 – 3 jaar geleden", match: (p) => { const d = daysAgo(p.phoenix_median_date); return d != null && d >= 365 && d < 3 * 365; } },
      { id: "3to5y", label: "3 – 5 jaar geleden", match: (p) => { const d = daysAgo(p.phoenix_median_date); return d != null && d >= 3 * 365 && d < 5 * 365; } },
      { id: "gt5y", label: "Ouder dan 5 jaar", match: (p) => { const d = daysAgo(p.phoenix_median_date); return d != null && d >= 5 * 365; } },
    ],
  },
  {
    key: "phoenix_max_growth_180d_pct",
    label: "Max groei in 180 dagen",
    buckets: [
      { id: "lt5k", label: "< 5.000%", match: (p) => p.phoenix_max_growth_180d_pct != null && p.phoenix_max_growth_180d_pct < 5000 },
      { id: "5kto10k", label: "5.000 – 10.000%", match: (p) => p.phoenix_max_growth_180d_pct != null && p.phoenix_max_growth_180d_pct >= 5000 && p.phoenix_max_growth_180d_pct < 10000 },
      { id: "10kto25k", label: "10.000 – 25.000%", match: (p) => p.phoenix_max_growth_180d_pct != null && p.phoenix_max_growth_180d_pct >= 10000 && p.phoenix_max_growth_180d_pct < 25000 },
      { id: "gt25k", label: "Meer dan 25.000%", match: (p) => p.phoenix_max_growth_180d_pct != null && p.phoenix_max_growth_180d_pct >= 25000 },
    ],
  },
  {
    key: "phoenix_days_to_50x",
    label: "Dagen tot 50×",
    buckets: [
      { id: "le90", label: "≤ 90 dagen (zeer snel)", match: (p) => p.phoenix_days_to_50x != null && p.phoenix_days_to_50x <= 90 },
      { id: "91to365", label: "91 – 365 dagen", match: (p) => p.phoenix_days_to_50x != null && p.phoenix_days_to_50x > 90 && p.phoenix_days_to_50x <= 365 },
      { id: "1to3y", label: "1 – 3 jaar", match: (p) => p.phoenix_days_to_50x != null && p.phoenix_days_to_50x > 365 && p.phoenix_days_to_50x <= 3 * 365 },
      { id: "gt3y", label: "Meer dan 3 jaar", match: (p) => p.phoenix_days_to_50x != null && p.phoenix_days_to_50x > 3 * 365 },
    ],
  },
  {
    key: "above_limit_pct",
    label: "Afstand tot aankooplimiet",
    buckets: [
      { id: "below", label: "Onder limiet", match: (p) => p.above_limit_pct != null && p.above_limit_pct <= 0 },
      { id: "0to10", label: "0 – 10% boven limiet", match: (p) => p.above_limit_pct != null && p.above_limit_pct > 0 && p.above_limit_pct <= 10 },
      { id: "10to25", label: "10 – 25% boven limiet", match: (p) => p.above_limit_pct != null && p.above_limit_pct > 10 && p.above_limit_pct <= 25 },
      { id: "25to50", label: "25 – 50% boven limiet", match: (p) => p.above_limit_pct != null && p.above_limit_pct > 25 && p.above_limit_pct <= 50 },
      { id: "gt50", label: "Meer dan 50% boven limiet", match: (p) => p.above_limit_pct != null && p.above_limit_pct > 50 },
    ],
  },
  {
    key: "phoenix_50x_date",
    label: "Laatste 50× datum",
    buckets: [
      { id: "lt1y", label: "Laatste jaar", match: (p) => { const d = daysAgo(p.phoenix_50x_date); return d != null && d < 365; } },
      { id: "1to3y", label: "1 – 3 jaar geleden", match: (p) => { const d = daysAgo(p.phoenix_50x_date); return d != null && d >= 365 && d < 3 * 365; } },
      { id: "3to5y", label: "3 – 5 jaar geleden", match: (p) => { const d = daysAgo(p.phoenix_50x_date); return d != null && d >= 3 * 365 && d < 5 * 365; } },
      { id: "gt5y", label: "Ouder dan 5 jaar", match: (p) => { const d = daysAgo(p.phoenix_50x_date); return d != null && d >= 5 * 365; } },
    ],
  },
];

export function PhoenixView() {
  const [ranking, setRanking] = useState<PhoenixRankEntry[]>([]);
  const [phoenixCount, setPhoenixCount] = useState(0);
  const [unscanned, setUnscanned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<PhoenixSortKey>("above_limit_pct");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [visibleCols, setVisibleCols] = useState<Set<PhoenixSortKey>>(
    () => new Set(PHOENIX_COLUMNS.map((c) => c.key)),
  );
  // Per facet-groep een set van geselecteerde bucket-ids. Lege set = geen
  // filter op die groep. Binnen 1 groep = OR, tussen groepen = AND.
  const [selectedBuckets, setSelectedBuckets] = useState<Record<PhoenixSortKey, Set<string>>>(() => {
    const init = {} as Record<PhoenixSortKey, Set<string>>;
    for (const g of FACET_GROUPS) init[g.key] = new Set();
    return init;
  });
  const [fullScanRunning, setFullScanRunning] = useState(false);
  const [fullScanBatch, setFullScanBatch] = useState(0);
  const fullScanStopRef = useRef(false);
  const [showSeen, setShowSeen] = useState(false);
  const [hideFavorites, setHideFavorites] = useState(false);
  const marks = useMarks();
  const isAdmin = !!getToken();

  async function refreshData() {
    const r = await fetchScanResults();
    setRanking(r.phoenix_ranking ?? []);
    setPhoenixCount(r.phoenix_count ?? 0);
    setUnscanned(r.phoenix_unscanned ?? 0);
    return r.phoenix_unscanned ?? 0;
  }

  useEffect(() => {
    refreshData()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function runScan() {
    setScanning(true);
    setScanMsg(null);
    try {
      await triggerJob("compute-phoenix-background");
      setScanMsg("Scan gestart — resultaten verschijnen na de volgende herlaad (~2-3 minuten).");
    } catch (e) {
      setScanMsg(`Fout: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning(false);
    }
  }

  async function runFullScan() {
    if (fullScanRunning) return;
    fullScanStopRef.current = false;
    setFullScanRunning(true);
    setFullScanBatch(0);
    setScanMsg(null);
    const MAX_BATCHES = 60;
    const BATCH_WAIT_MS = 95_000;
    try {
      let batch = 0;
      while (!fullScanStopRef.current && batch < MAX_BATCHES) {
        const remaining = await refreshData();
        if (remaining === 0) { setScanMsg(`Volledige scan klaar — geen ongezicende tickers meer.`); break; }
        try { await triggerJob("compute-phoenix-background"); } catch (e) { setScanMsg(`Fout bij batch ${batch + 1}: ${e instanceof Error ? e.message : String(e)}`); break; }
        batch++;
        setFullScanBatch(batch);
        for (let waited = 0; waited < BATCH_WAIT_MS && !fullScanStopRef.current; waited += 1000) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      await refreshData();
    } finally {
      setFullScanRunning(false);
    }
  }
  function stopFullScan() { fullScanStopRef.current = true; }

  function toggleSort(key: PhoenixSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      const col = PHOENIX_COLUMNS.find((c) => c.key === key);
      setSortDir(col?.defaultDir ?? "asc");
    }
  }

  function toggleCol(key: PhoenixSortKey) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleBucket(groupKey: PhoenixSortKey, bucketId: string) {
    setSelectedBuckets((prev) => {
      const nextSet = new Set(prev[groupKey]);
      if (nextSet.has(bucketId)) nextSet.delete(bucketId); else nextSet.add(bucketId);
      return { ...prev, [groupKey]: nextSet };
    });
  }

  function clearAllFilters() {
    const cleared = {} as Record<PhoenixSortKey, Set<string>>;
    for (const g of FACET_GROUPS) cleared[g.key] = new Set();
    setSelectedBuckets(cleared);
  }

  // Filter: voor elke groep met ≥1 geselecteerde bucket moet de rij in
  // tenminste 1 van die buckets vallen (OR binnen groep). Groepen worden
  // gecombineerd met AND. Per bucket berekenen we ook live counts gebaseerd
  // op de overige actieve filters (zoals bol.com — toont hoeveel resultaten
  // er overblijven als je deze bucket erbij aanvinkt).
  const filteredRanking = useMemo(() => {
    const filtered = ranking.filter((p) => {
      if (!showSeen && marks.isSeen(p.ticker)) return false;
      if (hideFavorites && marks.isFavorite(p.ticker)) return false;
      for (const g of FACET_GROUPS) {
        const sel = selectedBuckets[g.key];
        if (sel.size === 0) continue;
        let match = false;
        for (const bid of sel) {
          const bucket = g.buckets.find((b) => b.id === bid);
          if (bucket && bucket.match(p)) { match = true; break; }
        }
        if (!match) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "asc" ? av - bv : bv - av;
    });

    return sorted;
  }, [ranking, sortKey, sortDir, selectedBuckets, showSeen, hideFavorites, marks]);

  // Live count per bucket: hoeveel rijen vallen erin als je ALLE andere
  // facet-groepen toepast (de eigen groep wordt genegeerd, zoals bol.com).
  const bucketCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of FACET_GROUPS) {
      const baseFiltered = ranking.filter((p) => {
        for (const og of FACET_GROUPS) {
          if (og.key === g.key) continue;
          const sel = selectedBuckets[og.key];
          if (sel.size === 0) continue;
          let match = false;
          for (const bid of sel) {
            const bucket = og.buckets.find((b) => b.id === bid);
            if (bucket && bucket.match(p)) { match = true; break; }
          }
          if (!match) return false;
        }
        return true;
      });
      for (const b of g.buckets) {
        counts[`${g.key}::${b.id}`] = baseFiltered.filter((p) => b.match(p)).length;
      }
    }
    return counts;
  }, [ranking, selectedBuckets]);

  const activeFilterCount = Object.values(selectedBuckets).reduce((s, set) => s + set.size, 0);

  if (loading) return <Card className="p-10 text-center text-sm text-neutral-500">Laden…</Card>;
  if (error) return <Card className="p-4 text-sm text-fog-loss border-fog-loss/30">{error}</Card>;

  const sortArrow = (key: PhoenixSortKey) => sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "";

  return (
    <div className="space-y-6">
      {/* Uitlegkaart */}
      <Card className="p-4 border-fog-watch/20 bg-fog-watch/[0.03]">
        <div className="flex items-start gap-3">
          <Dot tone="watch" />
          <div className="flex-1">
            <div className="font-bold text-neutral-100">Feniks-aandelen</div>
            <div className="text-xs text-neutral-400 mt-1 leading-relaxed">
              Aandelen die ooit in de afgelopen 10 jaar minimaal <strong className="text-neutral-200">50×</strong> zijn gegaan en nu laag staan.
              Klik op een kolomkop om te sorteren. Vink kolommen aan/uit met de checkboxes,
              of activeer een filter om alleen aandelen te tonen waarvan het criterium bekend is.
            </div>
          </div>
        </div>
      </Card>

      {/* Stats + trigger */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-end">
        <Stat
          label="Feniks-aandelen"
          value={phoenixCount}
          hint="is_phoenix = true in watchlist"
        />
        <Stat
          label="Nog te scannen"
          value={unscanned}
          hint={unscanned > 0 ? "watchlist-aandelen zonder feniks-check" : "volledig gescand"}
        />
        {isAdmin && (
          <div className="space-y-2">
            <Button size="sm" variant="secondary" disabled={scanning || fullScanRunning} onClick={runScan}>
              {scanning ? "Scannen…" : "🔍 Scan 1×"}
            </Button>
            {!fullScanRunning ? (
              <Button size="sm" disabled={scanning || unscanned === 0} onClick={runFullScan}>
                🦅 Scan hele watchlist
              </Button>
            ) : (
              <>
                <span className="text-xs text-orange-400 font-semibold">
                  Batch {fullScanBatch} · {unscanned} resterend
                </span>
                <Button size="sm" variant="secondary" onClick={stopFullScan}>Stop</Button>
              </>
            )}
            {scanMsg && <div className="text-[11px] text-neutral-400 leading-snug">{scanMsg}</div>}
          </div>
        )}
      </div>

      {/* Layout: links facet-filters, rechts tabel */}
      {ranking.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          {/* Facet-filters */}
          <Card className="p-4 space-y-5 lg:sticky lg:top-3 lg:self-start lg:max-h-[calc(100vh-1rem)] lg:overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-bold">
                Filters {activeFilterCount > 0 && <span className="text-fog-pink">({activeFilterCount})</span>}
              </div>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearAllFilters}
                  className="text-[11px] text-fog-lime hover:underline"
                >
                  wissen
                </button>
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <ShowSeenToggle showSeen={showSeen} onChange={setShowSeen} />
                <HideFavoritesToggle hideFavorites={hideFavorites} onChange={setHideFavorites} />
                <MarkAllSeenButton tickers={filteredRanking.map((p) => p.ticker)} />
              </div>
              <div className="mt-2">
                <NotYetReviewedTile
                  tickers={ranking.map((p) => p.ticker)}
                  onActivate={() => { setShowSeen(false); setHideFavorites(true); }}
                />
              </div>
              <div className="mt-1 text-[10px] text-neutral-500">
                {marks.seen.size} gezien · standaard verborgen
              </div>
            </div>

            {FACET_GROUPS.map((g) => (
              <div key={g.key}>
                <div className="text-[11px] font-bold text-neutral-200 mb-1.5">{g.label}</div>
                <div className="space-y-1">
                  {g.buckets.map((b) => {
                    const count = bucketCounts[`${g.key}::${b.id}`] ?? 0;
                    const checked = selectedBuckets[g.key].has(b.id);
                    const disabled = count === 0 && !checked;
                    return (
                      <label
                        key={b.id}
                        className={`flex items-center gap-2 text-[11px] ${disabled ? "text-neutral-600 cursor-not-allowed" : "text-neutral-300 cursor-pointer hover:text-neutral-100"}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleBucket(g.key, b.id)}
                          className="accent-fog-pink"
                        />
                        <span className="flex-1">{b.label}</span>
                        <span className="text-[10px] text-neutral-500 font-mono tabular-nums">{count}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="pt-3 border-t border-ink-5/40">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-2">
                Kolommen tonen
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {PHOENIX_COLUMNS.map((c) => (
                  <label key={c.key} className="flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleCols.has(c.key)}
                      onChange={() => toggleCol(c.key)}
                      className="accent-fog-lime"
                    />
                    <span>{c.short}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t border-ink-5/40 text-[11px] text-neutral-500">
              {filteredRanking.length} van {ranking.length} getoond
            </div>
          </Card>

          {/* Tabel */}
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-ink-5 bg-ink-3/40 text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                    <SeenHeader />
                    <HeartHeader />
                    <StarHeader />
                    <th className="px-3 py-2 text-left w-10">#</th>
                    <th className="px-3 py-2 text-left">Ticker</th>
                    {PHOENIX_COLUMNS.map((c) => visibleCols.has(c.key) ? (
                      <th
                        key={c.key}
                        className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none"
                        onClick={() => toggleSort(c.key)}
                        title={c.hint}
                      >
                        <span className="inline-flex items-center gap-1">
                          {c.short}
                          <span className="text-fog-lime text-[9px]">{sortArrow(c.key)}</span>
                        </span>
                      </th>
                    ) : null)}
                    <th className="px-3 py-2 text-right">Koers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-5/40">
                  {filteredRanking.map((p, i) => {
                    const atOrBelow = p.buy_limit != null && p.last_close != null && p.last_close <= p.buy_limit;
                    const near = p.above_limit_pct != null && p.above_limit_pct <= 10 && !atOrBelow;
                    const seen = marks.isSeen(p.ticker);
                    return (
                      <tr key={p.ticker} className={(atOrBelow ? "bg-fog-lime/[0.05] " : "") + (seen ? "opacity-50" : "")}>
                        <SeenCell ticker={p.ticker} />
                        <HeartCell ticker={p.ticker} />
                        <td className="px-3 py-2 text-[11px] text-neutral-500 font-mono tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <a
                              href={googleFinanceUrl(p.ticker, p.exchange)}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-sm font-semibold text-fog-lime hover:underline"
                            >
                              {p.ticker}
                            </a>
                            {p.company && (
                              <span className="text-xs text-neutral-400 truncate max-w-[140px]">{p.company}</span>
                            )}
                            {p.sector && <Pill>{p.sector}</Pill>}
                          </div>
                          <div className="mt-0.5 text-[10px] text-neutral-500 flex items-center gap-1.5">
                            {(p.medal_gold ?? 0) > 0 && <span>🏆{p.medal_gold}</span>}
                            {(p.medal_silver ?? 0) > 0 && <span>🥈{p.medal_silver}</span>}
                            {(p.medal_bronze ?? 0) > 0 && <span>🥉{p.medal_bronze}</span>}
                          </div>
                        </td>
                        {visibleCols.has("above_limit_pct") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {p.above_limit_pct != null ? (
                              <span className={atOrBelow ? "text-fog-lime font-semibold" : near ? "text-fog-warn" : "text-neutral-300"}>
                                {atOrBelow ? "✓ onder" : `+${p.above_limit_pct.toFixed(1)}%`}
                              </span>
                            ) : (
                              <span className="text-neutral-600">—</span>
                            )}
                          </td>
                        )}
                        {visibleCols.has("phoenix_incident_count") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                            {p.phoenix_incident_count ?? <span className="text-neutral-600">—</span>}
                          </td>
                        )}
                        {visibleCols.has("phoenix_median_date") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                            {(() => {
                              const d = daysAgo(p.phoenix_median_date);
                              return d != null ? `${d}d` : <span className="text-neutral-600">—</span>;
                            })()}
                          </td>
                        )}
                        {visibleCols.has("phoenix_max_growth_180d_pct") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                            {p.phoenix_max_growth_180d_pct != null
                              ? `+${p.phoenix_max_growth_180d_pct.toFixed(0)}%`
                              : <span className="text-neutral-600">—</span>}
                          </td>
                        )}
                        {visibleCols.has("phoenix_days_to_50x") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                            {p.phoenix_days_to_50x != null
                              ? `${p.phoenix_days_to_50x}d`
                              : <span className="text-neutral-600">—</span>}
                          </td>
                        )}
                        {visibleCols.has("phoenix_50x_date") && (
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-fog-pink/80">
                            {p.phoenix_50x_date ? fmtDate(p.phoenix_50x_date) : <span className="text-neutral-600">—</span>}
                          </td>
                        )}
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {p.last_close != null && <div className="text-neutral-200">{fmtPrice(p.last_close)}</div>}
                          {p.buy_limit != null && <div className="text-[10px] text-neutral-500">lim {fmtPrice(p.buy_limit)}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Tabel */}
      {ranking.length === 0 ? (
        <Card className="p-10 text-center space-y-3">
          <div className="text-4xl">🦅</div>
          <div className="text-sm font-semibold text-neutral-300">Nog geen feniks-aandelen gevonden</div>
          <div className="text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
            {unscanned > 0
              ? `Er zijn nog ${unscanned} watchlist-aandelen die niet gescand zijn. Klik "Scan watchlist" om te beginnen (verwerkt ~100 per keer).`
              : "De dagelijkse scanners (scan-bottoms, scan-losers) voegen automatisch nieuwe feniks-aandelen toe zodra ze worden gevonden."}
          </div>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-ink-5 bg-ink-3/40 text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                  <SeenHeader />
                  <HeartHeader />
                  <th className="px-3 py-2 text-left w-10">#</th>
                  <th className="px-3 py-2 text-left">Ticker</th>
                  {PHOENIX_COLUMNS.map((c) => visibleCols.has(c.key) ? (
                    <th
                      key={c.key}
                      className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none"
                      onClick={() => toggleSort(c.key)}
                      title={c.hint}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.short}
                        <span className="text-fog-lime text-[9px]">{sortArrow(c.key)}</span>
                      </span>
                    </th>
                  ) : null)}
                  <th className="px-3 py-2 text-right">Koers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-5/40">
                {filteredRanking.map((p, i) => {
                  const atOrBelow = p.buy_limit != null && p.last_close != null && p.last_close <= p.buy_limit;
                  const near = p.above_limit_pct != null && p.above_limit_pct <= 10 && !atOrBelow;
                  const seen = marks.isSeen(p.ticker);
                  return (
                    <tr key={p.ticker} className={(atOrBelow ? "bg-fog-lime/[0.05] " : "") + (seen ? "opacity-50" : "")}>
                      <SeenCell ticker={p.ticker} />
                      <HeartCell ticker={p.ticker} />
                      <StarCell ticker={p.ticker} />
                      <td className="px-3 py-2 text-[11px] text-neutral-500 font-mono tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <a
                            href={googleFinanceUrl(p.ticker, p.exchange)}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-sm font-semibold text-fog-lime hover:underline"
                          >
                            {p.ticker}
                          </a>
                          {p.company && (
                            <span className="text-xs text-neutral-400 truncate max-w-[140px]">{p.company}</span>
                          )}
                          {p.sector && <Pill>{p.sector}</Pill>}
                        </div>
                        <div className="mt-0.5 text-[10px] text-neutral-500">
                          🥇{p.medal_gold ?? 0} 🥈{p.medal_silver ?? 0} 🥉{p.medal_bronze ?? 0}
                        </div>
                      </td>
                      {visibleCols.has("above_limit_pct") && (
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {p.above_limit_pct != null ? (
                            <span className={atOrBelow ? "text-fog-lime font-semibold" : near ? "text-fog-warn" : "text-neutral-300"}>
                              {atOrBelow ? "✓ onder" : `+${p.above_limit_pct.toFixed(1)}%`}
                            </span>
                          ) : (
                            <span className="text-neutral-600">—</span>
                          )}
                        </td>
                      )}
                      {visibleCols.has("phoenix_incident_count") && (
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                          {p.phoenix_incident_count ?? <span className="text-neutral-600">—</span>}
                        </td>
                      )}
                      {visibleCols.has("phoenix_median_date") && (
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                          {(() => {
                            const d = daysAgo(p.phoenix_median_date);
                            return d != null ? `${d}d` : <span className="text-neutral-600">—</span>;
                          })()}
                        </td>
                      )}
                      {visibleCols.has("phoenix_max_growth_180d_pct") && (
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                          {p.phoenix_max_growth_180d_pct != null
                            ? `+${p.phoenix_max_growth_180d_pct.toFixed(0)}%`
                            : <span className="text-neutral-600">—</span>}
                        </td>
                      )}
                      {visibleCols.has("phoenix_days_to_50x") && (
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                          {p.phoenix_days_to_50x != null
                            ? `${p.phoenix_days_to_50x}d`
                            : <span className="text-neutral-600">—</span>}
                        </td>
                      )}
                      {visibleCols.has("phoenix_50x_date") && (
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-fog-pink/80">
                          {p.phoenix_50x_date ? fmtDate(p.phoenix_50x_date) : <span className="text-neutral-600">—</span>}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {p.last_close != null && <div className="text-neutral-200">{fmtPrice(p.last_close)}</div>}
                        {p.buy_limit != null && <div className="text-[10px] text-neutral-500">lim {fmtPrice(p.buy_limit)}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── FamiliesView ────────────────────────────────────────────────────────────
// Per-groep gemiddelde return + tijd-lijngrafiek. Twee views: ploegen (familie-
// gemiddelden) en individueel (alle 200 strategieën). Grafiek en tabel hebben
// elk een eigen toggle — vergelijkbaar met het wiel­rennen-klassement.
function FamiliesView() {
  const [data, setData] = useState<SimResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [familySortBy, setFamilySortBy] = useState<"avg" | "n" | "best" | "worst" | "grp">("avg");
  const [indivSortBy, setIndivSortBy] = useState<"return" | "equity" | "winrate" | "closed">("return");
  const [chartView, setChartView] = useState<"ploegen" | "individueel">("ploegen");
  const [tableView, setTableView] = useState<"ploegen" | "individueel">("ploegen");

  useEffect(() => {
    setLoading(true);
    fetchSimResults()
      .then((r) => { setData(r); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false); });
  }, []);

  if (loading) return <Card className="p-10 text-center text-sm text-neutral-500">Laden…</Card>;
  if (error) return <Card className="p-4 text-sm text-fog-loss border-fog-loss/30">{error}</Card>;
  if (!data?.families) return <Card className="p-6 text-sm text-neutral-500">Nog geen familie-data beschikbaar. Wacht tot de eerstvolgende sim-run (22:30 UTC).</Card>;

  const { groups, dates } = data.families;

  const groupColorMap = new Map<string, string>(
    groups.map((g, idx) => [g.grp, `hsl(${Math.round((idx * 360) / Math.max(groups.length, 1))} 70% 55%)`])
  );
  const colorFor = (grp: string) => groupColorMap.get(grp) ?? "#9ca3af";

  const familySorted = [...groups].sort((a, b) => {
    switch (familySortBy) {
      case "n": return b.n - a.n;
      case "best": return (b.best_return_pct ?? -Infinity) - (a.best_return_pct ?? -Infinity);
      case "worst": return (a.worst_return_pct ?? Infinity) - (b.worst_return_pct ?? Infinity);
      case "grp": return a.grp.localeCompare(b.grp);
      default: return b.avg_return_pct - a.avg_return_pct;
    }
  });

  const allStrategies = data.strategies ?? [];
  const indivSorted = [...allStrategies].sort((a, b) => {
    switch (indivSortBy) {
      case "equity": return (b.total_equity ?? 0) - (a.total_equity ?? 0);
      case "winrate": return (b.win_rate ?? 0) - (a.win_rate ?? 0);
      case "closed": return (b.closed_count ?? 0) - (a.closed_count ?? 0);
      default: return (b.total_return_pct ?? -Infinity) - (a.total_return_pct ?? -Infinity);
    }
  });

  // ── Ploegen-grafiek (lijnen per familie) ───────────────────────────────────
  const W = 900, H = 360;
  const PAD = { l: 50, r: 20, t: 16, b: 36 };
  const cw = W - PAD.l - PAD.r;
  const ch = H - PAD.t - PAD.b;
  const visibleGroups = groups.filter((g) => !hiddenGroups.has(g.grp));
  let yMin = 0, yMax = 0;
  for (const g of visibleGroups) {
    for (const p of g.series) {
      if (p.avg_return_pct == null) continue;
      if (p.avg_return_pct < yMin) yMin = p.avg_return_pct;
      if (p.avg_return_pct > yMax) yMax = p.avg_return_pct;
    }
  }
  const pad = Math.max(0.5, (yMax - yMin) * 0.1);
  yMin -= pad; yMax += pad;
  if (yMin > 0) yMin = 0;
  if (yMax < 0) yMax = 0.5;
  const xLine = (i: number) => PAD.l + (dates.length <= 1 ? cw / 2 : (i * cw) / (dates.length - 1));
  const yScale = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * ch;
  const yZero = yScale(0);
  const range = yMax - yMin;
  const tickStep = range >= 50 ? 10 : range >= 10 ? 5 : range >= 2 ? 1 : 0.5;
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / tickStep) * tickStep; v <= yMax; v += tickStep) yTicks.push(v);

  // ── Individueel-grafiek (staafdiagram) ─────────────────────────────────────
  const BAR_W = 900, BAR_H = 360;
  const BPAD = { l: 50, r: 20, t: 16, b: 36 };
  const bcw = BAR_W - BPAD.l - BPAD.r;
  const bch = BAR_H - BPAD.t - BPAD.b;
  const barStrategies = [...allStrategies].sort((a, b) => (b.total_return_pct ?? -Infinity) - (a.total_return_pct ?? -Infinity));
  let byMin = 0, byMax = 0;
  for (const s of barStrategies) {
    const v = s.total_return_pct ?? 0;
    if (v < byMin) byMin = v;
    if (v > byMax) byMax = v;
  }
  const bpad = Math.max(0.5, (byMax - byMin) * 0.1);
  byMin -= bpad; byMax += bpad;
  if (byMin > 0) byMin = 0;
  if (byMax < 0) byMax = 0.5;
  const byScale = (v: number) => BPAD.t + (1 - (v - byMin) / (byMax - byMin)) * bch;
  const byZero = byScale(0);
  const bRange = byMax - byMin;
  const bTickStep = bRange >= 50 ? 10 : bRange >= 10 ? 5 : bRange >= 2 ? 1 : 0.5;
  const byTicks: number[] = [];
  for (let v = Math.ceil(byMin / bTickStep) * bTickStep; v <= byMax; v += bTickStep) byTicks.push(v);
  const barGap = barStrategies.length > 0 ? bcw / barStrategies.length : 5;
  const barWidth = Math.max(1, barGap * 0.85);

  function toggleGroup(grp: string) {
    setHiddenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(grp)) next.delete(grp); else next.add(grp);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <Card className="p-4 border-emerald-500/30 bg-emerald-500/[0.04]">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🧬</span>
          <div className="flex-1">
            <div className="font-semibold text-emerald-300 mb-1">Strategie-families</div>
            <p className="text-sm text-neutral-300 leading-relaxed">
              Gemiddeld rendement per familie (strategie-groep). Elke groep test één dimensie:
              A-Score = score-drempel sweep · K-Profiel = agressieve profielen · X-Hikkertjes =
              momentum-plays op explosieve dagstijgers · Y-Zwitserleven = high-yield fallen angels
              (incl. dividend). Gebruik de knoppen om te schakelen tussen ploegengemiddelden en
              individuele strategieën.
            </p>
          </div>
        </div>
      </Card>

      {/* Chart */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setChartView("ploegen")}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              chartView === "ploegen"
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                : "border-ink-5 text-neutral-400 hover:text-neutral-200"
            }`}
          >
            🏆 Ploegengemiddelden
          </button>
          <button
            onClick={() => setChartView("individueel")}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              chartView === "individueel"
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                : "border-ink-5 text-neutral-400 hover:text-neutral-200"
            }`}
          >
            🚴 Individueel
          </button>
          <span className="text-xs text-neutral-500 ml-2">
            {chartView === "ploegen"
              ? `Gemiddelde return% per familie over ${dates.length} dagen (${dates.length > 0 ? `${dates[0]} → ${dates[dates.length - 1]}` : "—"})`
              : `${barStrategies.length} strategieën gesorteerd op return%`}
          </span>
        </div>

        {chartView === "ploegen" ? (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
              {yTicks.map((v, i) => (
                <g key={i}>
                  <line x1={PAD.l} x2={W - PAD.r} y1={yScale(v)} y2={yScale(v)} stroke="#374151" strokeWidth="0.5" strokeDasharray={v === 0 ? "" : "2,3"} />
                  <text x={PAD.l - 6} y={yScale(v) + 3} textAnchor="end" fill="#9ca3af" fontSize="10">{v.toFixed(range >= 10 ? 0 : 1)}%</text>
                </g>
              ))}
              <line x1={PAD.l} x2={W - PAD.r} y1={yZero} y2={yZero} stroke="#6b7280" strokeWidth="1" />
              {dates.length > 0 && (
                <>
                  <text x={PAD.l} y={H - PAD.b + 16} textAnchor="start" fill="#9ca3af" fontSize="10">{dates[0]}</text>
                  {dates.length > 2 && (
                    <text x={W / 2} y={H - PAD.b + 16} textAnchor="middle" fill="#9ca3af" fontSize="10">
                      {dates[Math.floor(dates.length / 2)]}
                    </text>
                  )}
                  <text x={W - PAD.r} y={H - PAD.b + 16} textAnchor="end" fill="#9ca3af" fontSize="10">{dates[dates.length - 1]}</text>
                </>
              )}
              {groups.map((g) => {
                if (hiddenGroups.has(g.grp)) return null;
                const pts: Array<[number, number]> = [];
                g.series.forEach((p, i) => {
                  if (p.avg_return_pct != null) pts.push([xLine(i), yScale(p.avg_return_pct)]);
                });
                if (pts.length === 0) return null;
                const d = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
                return (
                  <g key={g.grp}>
                    <path d={d} fill="none" stroke={colorFor(g.grp)} strokeWidth="1.5" strokeLinejoin="round" />
                    {pts.length === 1 && <circle cx={pts[0][0]} cy={pts[0][1]} r="2" fill={colorFor(g.grp)} />}
                  </g>
                );
              })}
            </svg>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {groups.map((g) => {
                const hidden = hiddenGroups.has(g.grp);
                return (
                  <button
                    key={g.grp}
                    onClick={() => toggleGroup(g.grp)}
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono border transition-all ${
                      hidden ? "opacity-30 border-ink-5" : "border-ink-5/60 hover:border-ink-5"
                    }`}
                    title={hidden ? "Toon" : "Verberg"}
                  >
                    <span className="w-3 h-1.5 rounded-sm" style={{ backgroundColor: colorFor(g.grp) }} />
                    <span>{g.grp}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <svg viewBox={`0 0 ${BAR_W} ${BAR_H}`} className="w-full h-auto">
              {byTicks.map((v, i) => (
                <g key={i}>
                  <line x1={BPAD.l} x2={BAR_W - BPAD.r} y1={byScale(v)} y2={byScale(v)} stroke="#374151" strokeWidth="0.5" strokeDasharray={v === 0 ? "" : "2,3"} />
                  <text x={BPAD.l - 6} y={byScale(v) + 3} textAnchor="end" fill="#9ca3af" fontSize="10">{v.toFixed(bRange >= 10 ? 0 : 1)}%</text>
                </g>
              ))}
              <line x1={BPAD.l} x2={BAR_W - BPAD.r} y1={byZero} y2={byZero} stroke="#6b7280" strokeWidth="1" />
              {barStrategies.map((s, i) => {
                const v = s.total_return_pct ?? 0;
                const bx = BPAD.l + i * barGap + barGap / 2 - barWidth / 2;
                const barTop = v >= 0 ? byScale(v) : byZero;
                const barH = Math.abs(byScale(v) - byZero);
                return (
                  <rect key={s.slug} x={bx} y={barTop} width={barWidth} height={Math.max(barH, 0.5)} fill={colorFor(s.grp)} opacity="0.85">
                    <title>{s.name ?? s.slug}: {v >= 0 ? "+" : ""}{v.toFixed(2)}%</title>
                  </rect>
                );
              })}
            </svg>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {groups.map((g) => (
                <div key={g.grp} className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono border border-ink-5/60">
                  <span className="w-3 h-1.5 rounded-sm" style={{ backgroundColor: colorFor(g.grp) }} />
                  <span>{g.grp}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Tabel */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-ink-5 flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setTableView("ploegen")}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
              tableView === "ploegen"
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                : "border-ink-5 text-neutral-400 hover:text-neutral-200"
            }`}
          >
            🏆 Ploegenklassement
          </button>
          <button
            onClick={() => setTableView("individueel")}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
              tableView === "individueel"
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                : "border-ink-5 text-neutral-400 hover:text-neutral-200"
            }`}
          >
            🚴 Individueel klassement
          </button>
          <span className="text-xs text-neutral-500 ml-auto">
            {tableView === "ploegen"
              ? `${groups.length} families · klik kolomkop om te sorteren`
              : `${indivSorted.length} strategieën · klik kolomkop om te sorteren`}
          </span>
        </div>

        {tableView === "ploegen" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-5 bg-ink-2/40">
                <tr>
                  {([
                    ["grp",   "Familie"],
                    ["n",     "Strategieën"],
                    ["avg",   "Gem. return"],
                    ["best",  "Beste"],
                    ["worst", "Slechtste"],
                  ] as const).map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => setFamilySortBy(key)}
                      className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide cursor-pointer hover:text-neutral-200 select-none"
                    >
                      {label}{familySortBy === key ? " ▼" : " ·"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-5">
                {familySorted.map((g, idx) => (
                  <tr key={g.grp} className="hover:bg-ink-3/30">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: colorFor(g.grp) }} />
                        <span className="font-mono text-xs text-neutral-200">{g.grp}</span>
                        <span className="text-[10px] text-neutral-600 tabular w-6 text-right">#{idx + 1}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular text-xs text-neutral-300">{g.n}</td>
                    <td className="px-3 py-2 tabular font-mono text-sm">
                      <span className={g.avg_return_pct >= 0 ? "text-emerald-400" : "text-fog-loss"}>
                        {g.avg_return_pct >= 0 ? "+" : ""}{g.avg_return_pct.toFixed(2)}%
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular text-xs">
                      {g.best_return_pct != null ? (
                        <>
                          <span className={g.best_return_pct >= 0 ? "text-emerald-400" : "text-fog-loss"}>
                            {g.best_return_pct >= 0 ? "+" : ""}{g.best_return_pct.toFixed(2)}%
                          </span>
                          {g.best_slug && <span className="text-[10px] text-neutral-500 font-mono ml-1">{g.best_slug}</span>}
                        </>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 tabular text-xs">
                      {g.worst_return_pct != null ? (
                        <>
                          <span className={g.worst_return_pct >= 0 ? "text-emerald-400" : "text-fog-loss"}>
                            {g.worst_return_pct >= 0 ? "+" : ""}{g.worst_return_pct.toFixed(2)}%
                          </span>
                          {g.worst_slug && <span className="text-[10px] text-neutral-500 font-mono ml-1">{g.worst_slug}</span>}
                        </>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-5 bg-ink-2/40">
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide w-8">#</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Strategie</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Familie</th>
                  {([
                    ["return",  "Return%"],
                    ["equity",  "Equity"],
                    ["winrate", "Hit-rate"],
                    ["closed",  "Trades"],
                  ] as const).map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => setIndivSortBy(key)}
                      className="px-3 py-2 text-right text-[11px] font-semibold text-neutral-400 uppercase tracking-wide cursor-pointer hover:text-neutral-200 select-none"
                    >
                      {label}{indivSortBy === key ? " ▼" : " ·"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-5">
                {indivSorted.map((s, idx) => (
                  <tr key={s.slug} className="hover:bg-ink-3/30">
                    <td className="px-3 py-2 text-[10px] text-neutral-600 tabular">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs text-neutral-200">{s.slug}</div>
                      {s.name && <div className="text-[10px] text-neutral-500">{s.name}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorFor(s.grp) }} />
                        <span className="text-[10px] font-mono text-neutral-400">{s.grp}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular font-mono text-sm">
                      <span className={(s.total_return_pct ?? 0) >= 0 ? "text-emerald-400" : "text-fog-loss"}>
                        {(s.total_return_pct ?? 0) >= 0 ? "+" : ""}{(s.total_return_pct ?? 0).toFixed(2)}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular text-xs text-neutral-300">
                      ${(s.total_equity ?? 0).toFixed(0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-xs text-neutral-300">
                      {s.win_rate != null ? `${(s.win_rate * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-xs text-neutral-400">
                      {s.closed_count ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
