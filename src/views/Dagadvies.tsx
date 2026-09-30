import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAdvice, adviceRaiseLimit, adviceSetNotify, triggerAdviceWatch, getToken,
  type AdviceResponse, type AdviceBook, type AdviceEvent, type AdviceOrder, type AdvicePosition,
} from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, Badge, Sparkline, CollapsibleIntro, EmptyState, toast, ago, useTickingNow } from "../components/ui";

// Dagadvies: een papieren portefeuille van €10.000 bij DEGIRO. De backend
// (xinix-advice) rekent elke werkdagavond de kandidaten door, zet orders klaar
// en controleert elk kwartier vullingen, stops en nieuws. Dit tabblad laat zien
// wat er bij DEGIRO hoort te staan en hoe de bronnen het doen.

const CUR_SIGN: Record<string, string> = {
  USD: "$", EUR: "€", CAD: "C$", AUD: "A$", HKD: "HK$", SGD: "S$", JPY: "¥",
  CHF: "CHF ", SEK: "SEK ", NOK: "NOK ", DKK: "DKK ", PLN: "PLN ",
};
const EX_LABEL: Record<string, string> = {
  NASDAQ: "Nasdaq", NYSE: "NYSE", AMEX: "NYSE American", TSX: "TSX", TSXV: "TSX Venture", CSE: "CSE", NEO: "Cboe Canada",
  LSE: "Londen", XETR: "Xetra", FWB: "Frankfurt", EURONEXT: "Euronext", MIL: "Milaan", BME: "Madrid", GPW: "Warschau",
  SIX: "Zwitserland", OMXSTO: "Stockholm", OSL: "Oslo", OMXCOP: "Kopenhagen", OMXHEX: "Helsinki", ASX: "Australië",
  TSE: "Tokio", SGX: "Singapore",
};
const KIND_ICON: Record<string, string> = {
  order_new: "🟢", order_cancel: "⛔", fill: "✅", stop_raise: "⬆️", stop_hit: "🛑", sell_advice: "🔴",
  sell_done: "💶", source_switch: "🔀", source_keep: "📊", limit_hint: "💡", limit_set: "✏️",
};

// De backend zet zelf een icoon voor elk bericht; hier staat het al in de kantlijn.
const LEADING_EMOJI = /^\p{Extended_Pictographic}\uFE0F?\s*/u;

const nl = (x: number, dec: number, maxDec = dec) =>
  x.toLocaleString("nl-NL", { minimumFractionDigits: dec, maximumFractionDigits: maxDec });
function fmtPrice(p: number | null | undefined, cur: string): string {
  if (p == null) return "—";
  const s = p >= 1 ? nl(p, 2) : nl(p, 2, 4);
  if (cur === "GBp" || cur === "GBX") return `${s}p`;
  return `${CUR_SIGN[cur] ?? `${cur} `}${s}`;
}
const fmtEur = (x: number | null | undefined, dec = 0) => (x == null ? "—" : `€${nl(x, dec)}`);
function fmtPct(x: number | null | undefined): string {
  if (x == null) return "—";
  return `${x >= 0 ? "+" : "−"}${nl(Math.abs(x), 1)}%`;
}
const pnlTone = (x: number | null | undefined) => (x == null || x === 0 ? "text-neutral-300" : x > 0 ? "text-fog-gain" : "text-fog-loss");
const exLabel = (ex: string) => EX_LABEL[ex] ?? ex;
function whenNl(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", ...opts });
}

function TickerLink({ ticker, exchange, company }: { ticker: string; exchange: string; company: string | null }) {
  return (
    <div className="min-w-0">
      <a
        href={googleFinanceUrl(ticker, exchange)}
        target="_blank"
        rel="noreferrer"
        className="font-bold text-neutral-100 hover:text-fog-pink"
      >
        {ticker}
      </a>
      <div className="text-[11px] text-neutral-500 truncate max-w-[16rem]" title={company ?? undefined}>
        {company ?? "—"} · {exLabel(exchange)}
      </div>
    </div>
  );
}

function OrdersTable({ orders, now }: { orders: AdviceOrder[]; now: number }) {
  if (!orders.length) {
    return <div className="px-4 py-3 text-sm text-neutral-500">Geen openstaande kooporders.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-neutral-500">
          <tr className="border-b border-ink-5">
            <th className="px-3 py-2 text-left">Aandeel</th>
            <th className="px-3 py-2 text-left">Wat bij DEGIRO</th>
            <th className="px-3 py-2 text-right">Limiet (GTC)</th>
            <th className="px-3 py-2 text-right">Koers</th>
            <th className="px-3 py-2 text-right">≈ Bedrag</th>
            <th className="px-3 py-2 text-left">Waarom</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const pending = Date.parse(o.valid_from) > now;
            const dist = o.last_close ? (o.last_close / o.limit_price - 1) * 100 : null;
            return (
              <tr key={o.id} className="border-b border-ink-5/60 align-top">
                <td className="px-3 py-2"><TickerLink ticker={o.ticker} exchange={o.exchange} company={o.company} /></td>
                <td className="px-3 py-2">
                  <div className="font-semibold text-fog-lime whitespace-nowrap">Koop {nl(o.qty, 0)} stuks</div>
                  <div className="text-[11px] text-neutral-500">
                    {pending
                      ? `plaatsen vóór de opening (${whenNl(o.valid_from, { weekday: "long", hour: "2-digit", minute: "2-digit" })})`
                      : `staat sinds ${whenNl(o.created_at, { day: "numeric", month: "short" })}`}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular font-semibold">{fmtPrice(o.limit_price, o.currency)}</td>
                <td className="px-3 py-2 text-right tabular">
                  {fmtPrice(o.last_close ?? o.close_at, o.currency)}
                  {dist != null && (
                    <div className="text-[11px] text-neutral-500">
                      {dist >= 0 ? `${nl(dist, 1)}% erboven` : `al ${nl(-dist, 1)}% onder je limiet`}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular">
                  {fmtEur(o.reserved_eur)}
                  <div className="text-[11px] text-neutral-500">incl. kosten</div>
                </td>
                <td className="px-3 py-2 text-xs text-neutral-400 max-w-[28rem]">
                  {o.conviction != null && <Badge tone="lime" className="mr-1">{Math.round(o.conviction * 100)}%</Badge>}
                  {o.reason}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PositionsTable({ positions }: { positions: AdvicePosition[] }) {
  if (!positions.length) {
    return <div className="px-4 py-3 text-sm text-neutral-500">Nog geen posities.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-neutral-500">
          <tr className="border-b border-ink-5">
            <th className="px-3 py-2 text-left">Aandeel</th>
            <th className="px-3 py-2 text-right">Aantal</th>
            <th className="px-3 py-2 text-right">Instap</th>
            <th className="px-3 py-2 text-right">Koers</th>
            <th className="px-3 py-2 text-right">Stop-loss (GTC)</th>
            <th className="px-3 py-2 text-right">Resultaat</th>
            <th className="px-3 py-2 text-right">Dagen</th>
            <th className="px-3 py-2 text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.id} className="border-b border-ink-5/60 align-top">
              <td className="px-3 py-2"><TickerLink ticker={p.ticker} exchange={p.exchange} company={p.company} /></td>
              <td className="px-3 py-2 text-right tabular">{nl(p.qty, 0)}</td>
              <td className="px-3 py-2 text-right tabular">{fmtPrice(p.entry_price, p.currency)}</td>
              <td className="px-3 py-2 text-right tabular">{fmtPrice(p.price, p.currency)}</td>
              <td className="px-3 py-2 text-right tabular font-semibold">
                {fmtPrice(p.stop_price, p.currency)}
                {p.stop_pct != null && <div className="text-[11px] text-neutral-500">{fmtPct(p.stop_pct)} t.o.v. instap</div>}
              </td>
              <td className={`px-3 py-2 text-right tabular font-semibold ${pnlTone(p.pnl_eur)}`}>
                {p.pnl_eur >= 0 ? "+" : "−"}{fmtEur(Math.abs(p.pnl_eur), 2)}
                <div className="text-[11px]">{fmtPct(p.pnl_pct)}</div>
              </td>
              <td className="px-3 py-2 text-right tabular">{p.days}</td>
              <td className="px-3 py-2 text-xs">
                {p.exit_pending
                  ? <span className="text-fog-loss font-semibold">Verkopen: {p.exit_pending}</span>
                  : <span className="text-neutral-400">Houden, stop staat</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BooksTable({ books, activeSource, open, onToggle }: {
  books: AdviceBook[]; activeSource: string; open: string | null; onToggle: (b: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-neutral-500">
          <tr className="border-b border-ink-5">
            <th className="px-3 py-2 text-left">Bron</th>
            <th className="px-3 py-2 text-right">Waarde</th>
            <th className="px-3 py-2 text-right">Sinds start</th>
            <th className="px-3 py-2 text-right">Deze maand</th>
            <th className="px-3 py-2 text-right">Trades</th>
            <th className="px-3 py-2 text-right">Raak</th>
            <th className="px-3 py-2 text-right">Open</th>
            <th className="px-3 py-2 text-right">Kosten</th>
          </tr>
        </thead>
        <tbody>
          {books.map((b) => (
            <tr
              key={b.book}
              onClick={() => onToggle(b.book)}
              className={`border-b border-ink-5/60 cursor-pointer hover:bg-ink-3 ${open === b.book ? "bg-ink-3" : ""}`}
            >
              <td className="px-3 py-2">
                <span className="font-semibold">{b.label}</span>
                {b.book === activeSource && <Badge tone="lime" className="ml-2">volgt jouw advies</Badge>}
              </td>
              <td className="px-3 py-2 text-right tabular">{fmtEur(b.equity_eur)}</td>
              <td className={`px-3 py-2 text-right tabular font-semibold ${pnlTone(b.return_pct)}`}>{fmtPct(b.return_pct)}</td>
              <td className={`px-3 py-2 text-right tabular ${pnlTone(b.month_return_pct)}`}>{fmtPct(b.month_return_pct)}</td>
              <td className="px-3 py-2 text-right tabular">{b.closed_trades}</td>
              <td className="px-3 py-2 text-right tabular">{b.closed_trades ? `${Math.round((b.wins / b.closed_trades) * 100)}%` : "—"}</td>
              <td className="px-3 py-2 text-right tabular">{b.positions} pos · {b.open_orders} ord</td>
              <td className="px-3 py-2 text-right tabular text-neutral-400">{fmtEur(b.costs_eur, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventLine({ e, now }: { e: AdviceEvent; now: number }) {
  return (
    <li className="flex gap-3 px-4 py-2 border-b border-ink-5/50 last:border-0">
      <span className="shrink-0 w-5 text-center">{KIND_ICON[e.kind] ?? "•"}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-neutral-200 leading-snug">{e.message.replace(LEADING_EMOJI, "")}</div>
        <div className="text-[11px] text-neutral-500 mt-0.5">
          {whenNl(e.at, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {ago(e.at, now)}
          {e.urgent && <span className="ml-2 text-fog-warn">direct gemeld</span>}
        </div>
      </div>
    </li>
  );
}

export function DagadviesView() {
  const [data, setData] = useState<AdviceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openBook, setOpenBook] = useState<string | null>(null);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const now = useTickingNow();
  const hasToken = !!getToken();

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await fetchAdvice());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const live = data?.books.find((b) => b.book === "live") ?? null;
  const shadowBooks = useMemo(() => (data?.books ?? []).filter((b) => b.book !== "live")
    .sort((a, b) => b.return_pct - a.return_pct), [data]);
  const liveOrders = useMemo(() => (data?.orders ?? []).filter((o) => o.book === "live"), [data]);
  const livePositions = useMemo(() => (data?.positions ?? []).filter((p) => p.book === "live"), [data]);
  const liveClosed = useMemo(() => (data?.closed ?? []).filter((c) => c.book === "live"), [data]);
  const liveEvents = useMemo(() => (data?.events ?? []).filter((e) => e.book === "live" && e.kind !== "limit_hint"), [data]);
  const hints = useMemo(() => {
    const seen = new Set<string>();
    return (data?.events ?? [])
      .filter((e) => e.book === "live" && e.kind === "limit_hint" && now - Date.parse(e.at) < 14 * 86_400_000)
      .filter((e) => (e.ticker && !seen.has(e.ticker) ? (seen.add(e.ticker), true) : false));
  }, [data, now]);
  const equityValues = useMemo(() => (data?.equity.live ?? []).map((r) => r.equity_eur), [data]);
  const sourceLabel = (key: string) => data?.sources.find((s) => s.key === key)?.label ?? key;

  async function raiseLimit(e: AdviceEvent) {
    const ticker = e.ticker;
    const suggest = Number(e.payload?.suggest);
    if (!ticker || !(suggest > 0)) return;
    setBusy(`hint-${ticker}`);
    try {
      await adviceRaiseLimit(ticker, suggest);
      toast(`Aankooplimiet ${ticker} staat op ${suggest}; vanavond rekent het advies ermee`);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }
  async function toggleNotify() {
    if (!data) return;
    setBusy("notify");
    try {
      await adviceSetNotify(!data.settings.advice_notify);
      toast(data.settings.advice_notify ? "Dagadvies-meldingen uit" : "Dagadvies-meldingen aan");
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }
  async function checkNow() {
    setBusy("watch");
    try {
      const r = await triggerAdviceWatch();
      toast(r.message ?? "Gecontroleerd");
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return <Card className="p-4 text-sm text-fog-loss">Dagadvies laden mislukt: {error}</Card>;
  }
  if (!data || !live) {
    return <Card className="p-4 text-sm text-neutral-400">Dagadvies laden…</Card>;
  }

  const free = live.cash_eur - live.reserved_eur;
  const r = data.rules;
  const events = showAllEvents ? liveEvents : liveEvents.slice(0, 12);
  const openShadow = openBook ? data.books.find((b) => b.book === openBook) : null;

  return (
    <div className="space-y-5">
      <CollapsibleIntro title="💼 Dagadvies: je €10.000 bij DEGIRO">
        <p>
          Elke werkdagavond na de Amerikaanse slotbel rekent Xinix de kandidaten door en zet kooporders klaar. Om {r.digest_hour_utc}:00 UTC
          krijg je één melding met wat je die dag bij DEGIRO moet plaatsen. Tijdens de handelsdag wordt elk kwartier gecontroleerd of
          een limiet geraakt is, een stop omhoog moet of er slecht nieuws is; dan krijg je meteen een melding. Dit is een
          papieren portefeuille: hij gaat ervan uit dat je elk advies opvolgt, jij houdt DEGIRO zelf bij.
        </p>
        <p className="mt-2">
          Vijf bronnen draaien elk een eigen schaduwportefeuille met exact dezelfde regels en kosten: <b>Mix</b> (hoe meer bronnen
          hetzelfde aandeel aanwijzen, hoe groter de positie), <b>Potje-toppers</b> (wat de tien beste strategieën van de laatste
          60 dagen net kochten), <b>Hippos</b>, <b>Sprinters</b> (≥4★) en <b>Signalen</b> (score + positieve signalen rond de
          aankooplimiet). Je advies begint op Mix; elke maand kiest de data de bron met het beste track record (minstens 20
          handelsdagen, 3 afgesloten trades en 2 procentpunt beter dan de huidige). Lopende posities en orders lopen gewoon af.
        </p>
      </CollapsibleIntro>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Waarde</div>
          <div className="mt-1 flex items-baseline gap-2">
            <div className="text-2xl font-bold tabular">{fmtEur(live.equity_eur)}</div>
            <div className={`text-xs font-semibold tabular ${pnlTone(live.return_pct)}`}>{fmtPct(live.return_pct)}</div>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
            sinds {whenNl(live.started_at, { day: "numeric", month: "long" })}
            <Sparkline values={equityValues} width={70} height={16} tone={live.return_pct < 0 ? "loss" : "lime"} />
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Cash</div>
          <div className="mt-1 text-2xl font-bold tabular">{fmtEur(live.cash_eur)}</div>
          <div className="mt-1 text-xs text-neutral-500">
            {fmtEur(live.reserved_eur)} vast in orders · vrij {fmtEur(free)} (min. {r.cash_floor_pct}% blijft cash)
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Belegd</div>
          <div className="mt-1 text-2xl font-bold tabular">{fmtEur(live.invested_eur)}</div>
          <div className="mt-1 text-xs text-neutral-500">
            {live.positions} posities · {live.open_orders} orders · kosten tot nu {fmtEur(live.costs_eur, 2)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Bron van je advies</div>
          <div className="mt-1 text-lg font-bold">{sourceLabel(live.source)}</div>
          <div className="mt-1 text-xs text-neutral-500">
            sinds {whenNl(live.source_since, { day: "numeric", month: "long" })} · volgende keuze begin volgende maand
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void load()}>↻ Ververs</Button>
        {hasToken && (
          <Button size="sm" variant="secondary" disabled={busy === "watch"} onClick={() => void checkNow()}>
            {busy === "watch" ? "Controleren…" : "Koersen nu controleren"}
          </Button>
        )}
        {hasToken && (
          <Button size="sm" variant={data.settings.advice_notify ? "secondary" : "ghost"} disabled={busy === "notify"} onClick={() => void toggleNotify()}>
            {data.settings.advice_notify ? "🔔 Meldingen aan" : "🔕 Meldingen uit"}
          </Button>
        )}
        {!data.settings.ntfy_configured && (
          <span className="text-xs text-fog-warn">Er is geen ntfy-topic ingesteld (Instellingen), dus meldingen gaan nergens heen.</span>
        )}
        <span className="text-[11px] text-neutral-500 ml-auto">
          Laatste dagrun {live.last_daily_at ? ago(live.last_daily_at, now) : "nog niet"} · wisselkoersen ECB {data.fx.as_of ?? "—"}
          {data.fx.rates.USD ? ` · €1 = $${nl(data.fx.rates.USD, 4)}` : ""}
        </span>
      </div>

      <Card>
        <div className="px-4 pt-3 pb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <h3 className="font-bold">Kooporders die bij DEGIRO horen te staan</h3>
          <span className="text-[11px] text-neutral-500">GTC-limietorders; vervallen na {r.order_days} handelsdagen zonder vulling</span>
        </div>
        <OrdersTable orders={liveOrders} now={now} />
      </Card>

      <Card>
        <div className="px-4 pt-3 pb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <h3 className="font-bold">Posities</h3>
          <span className="text-[11px] text-neutral-500">
            direct na aankoop een GTC stop-loss op −{r.stop_pct}%; vanaf +{r.trail_from_pct}% gaat hij mee omhoog
          </span>
        </div>
        <PositionsTable positions={livePositions} />
      </Card>

      {hints.length > 0 && (
        <Card>
          <div className="px-4 pt-3 pb-1">
            <h3 className="font-bold">💡 Limiet verhogen?</h3>
            <div className="text-[11px] text-neutral-500">
              Kansrijk volgens de bron, maar je aankooplimiet ligt meer dan {r.max_limit_gap_pct}% onder de koers, dus er komt geen order.
              Jij beslist: verhoog je de limiet, dan rekent de volgende dagrun ermee.
            </div>
          </div>
          <ul>
            {hints.map((e) => {
              const suggest = Number(e.payload?.suggest);
              const cur = String(e.payload?.currency ?? "USD");
              return (
                <li key={e.id} className="flex items-start gap-3 px-4 py-2 border-t border-ink-5/50">
                  <div className="flex-1 text-sm text-neutral-300">{e.message}</div>
                  {hasToken && e.ticker && suggest > 0 && (
                    <Button size="sm" variant="secondary" disabled={busy === `hint-${e.ticker}`} onClick={() => void raiseLimit(e)}>
                      Limiet → {fmtPrice(suggest, cur)}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card>
        <div className="px-4 pt-3 pb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <h3 className="font-bold">Logboek</h3>
          <span className="text-[11px] text-neutral-500">
            wat het advies deed en meldde{data.settings.quiet_hours_start != null ? ` · stille uren ${data.settings.quiet_hours_start}–${data.settings.quiet_hours_end} UTC` : ""}
          </span>
        </div>
        {events.length ? (
          <ul>{events.map((e) => <EventLine key={e.id} e={e} now={now} />)}</ul>
        ) : (
          <div className="px-4 py-3 text-sm text-neutral-500">Nog niets gebeurd.</div>
        )}
        {liveEvents.length > 12 && (
          <div className="px-4 py-2">
            <Button size="sm" variant="ghost" onClick={() => setShowAllEvents((v) => !v)}>
              {showAllEvents ? "Minder tonen" : `Alle ${liveEvents.length} tonen`}
            </Button>
          </div>
        )}
      </Card>

      {liveClosed.length > 0 && (
        <Card>
          <div className="px-4 pt-3 pb-1"><h3 className="font-bold">Afgesloten trades</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-neutral-500">
                <tr className="border-b border-ink-5">
                  <th className="px-3 py-2 text-left">Aandeel</th>
                  <th className="px-3 py-2 text-right">Instap</th>
                  <th className="px-3 py-2 text-right">Uitstap</th>
                  <th className="px-3 py-2 text-right">Resultaat</th>
                  <th className="px-3 py-2 text-left">Reden</th>
                  <th className="px-3 py-2 text-right">Gesloten</th>
                </tr>
              </thead>
              <tbody>
                {liveClosed.map((c, i) => (
                  <tr key={`${c.ticker}-${c.closed_at}-${i}`} className="border-b border-ink-5/60">
                    <td className="px-3 py-2"><TickerLink ticker={c.ticker} exchange={c.exchange} company={c.company} /></td>
                    <td className="px-3 py-2 text-right tabular">{fmtPrice(c.entry_price, c.currency)}</td>
                    <td className="px-3 py-2 text-right tabular">{fmtPrice(c.exit_price, c.currency)}</td>
                    <td className={`px-3 py-2 text-right tabular font-semibold ${pnlTone(c.pnl_eur)}`}>
                      {c.pnl_eur == null ? "—" : `${c.pnl_eur >= 0 ? "+" : "−"}${fmtEur(Math.abs(c.pnl_eur), 2)}`}
                      <div className="text-[11px]">{fmtPct(c.pnl_pct)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-400">{c.exit_reason ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-xs text-neutral-400">{whenNl(c.closed_at, { day: "numeric", month: "short" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <div className="px-4 pt-3 pb-1">
          <h3 className="font-bold">Track record per bron</h3>
          <div className="text-[11px] text-neutral-500">
            Elke bron speelt met €10.000 volgens dezelfde regels. Klik een bron voor zijn orders en posities.
          </div>
        </div>
        <BooksTable books={shadowBooks} activeSource={live.source} open={openBook} onToggle={(b) => setOpenBook((cur) => (cur === b ? null : b))} />
        {openShadow && (
          <div className="border-t border-ink-5 bg-ink-1/40">
            <div className="px-4 pt-3 text-xs font-bold uppercase tracking-wide text-neutral-500">{openShadow.label}: orders</div>
            <OrdersTable orders={data.orders.filter((o) => o.book === openShadow.book)} now={now} />
            <div className="px-4 pt-3 text-xs font-bold uppercase tracking-wide text-neutral-500">{openShadow.label}: posities</div>
            <PositionsTable positions={data.positions.filter((p) => p.book === openShadow.book)} />
          </div>
        )}
      </Card>

      <CollapsibleIntro title="Regels en kosten">
        <ul className="list-disc pl-5 space-y-1">
          <li>Alleen aandelen uit de actieve watchlist op beurzen die DEGIRO aanbiedt (geen OTC; Hongkong niet omdat de lotgroottes onbekend zijn), met minstens ${nl(r.min_dollar_volume / 1000, 0)}k omzet per dag.</li>
          <li>Kooplimiet = je watchlist-limiet, maar minstens {r.limit_below_close_pct}% onder de slotkoers. Ligt die meer dan {r.max_limit_gap_pct}% onder de koers, dan komt er geen order maar een tip.</li>
          <li>Positiegrootte naar overtuiging: 10, 15 of {r.max_weight_pct}% van de portefeuille, nooit meer dan {r.max_weight_pct}% per aandeel en altijd minstens {r.cash_floor_pct}% cash. Orders kleiner dan €{r.min_order_eur} lonen niet met vaste kosten.</li>
          <li>Een aankoop telt pas als de koers de limiet echt raakt in een sessie nadat je de order kon plaatsen; opent het aandeel lager, dan tegen de openingskoers.</li>
          <li>Direct na aankoop een GTC stop-loss op −{r.stop_pct}%. Vanaf +{r.trail_from_pct}% naar break-even en daarna mee: 20% onder de top, vanaf +50% 15%, vanaf +100% 12%. Je krijgt een melding als je hem moet verhogen.</li>
          <li>Na {r.time_exit_days} handelsdagen verkopen als hij niet minstens +{r.time_exit_min_gain_pct}% staat, na {r.max_hold_days} handelsdagen hoe dan ook. Bij slecht nieuws (aandelenuitgifte, faillissement, mislukte studie, delisting) meteen.</li>
          <li>DEGIRO-kosten: VS en Canada €2 per order, Europa, Londen en Azië €4,90, Australië €5; AutoFX {nl(r.autofx_pct, 2)}% bij elke omwisseling (heen en terug); €{nl(r.connect_eur, 2)} aansluitkosten per beurs per jaar; zegelrecht Londen 0,5% bij aankoop.</li>
          <li>Wisselkoersen: ECB-referentiekoersen, dagelijks bijgewerkt. Waarde en resultaat staan in euro, na aftrek van de verkoopkosten.</li>
        </ul>
      </CollapsibleIntro>

      {!liveOrders.length && !livePositions.length && !liveEvents.length && (
        <EmptyState icon="💼" title="Nog geen advies" description="De eerste dagrun draait op werkdagen om 23:10 UTC." />
      )}
    </div>
  );
}
