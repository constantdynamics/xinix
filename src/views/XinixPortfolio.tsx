import { useEffect, useMemo, useState } from "react";
import {
  fetchXinixPortfolio,
  triggerJob,
  getToken,
  type XinixPortfolio,
  type XinixOpenPosition,
  type XinixClosedPosition,
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
    <div className="space-y-8">
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
