import { useCallback, useEffect, useMemo, useState } from "react";
import { cryptoAdopt, fetchCrypto, getToken, type CryptoCat, type CryptoResponse, type CryptoRow } from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, CollapsibleIntro, ago, toast } from "../components/ui";
import { useMarks } from "../hooks/useMarks";
import { HeartIcon, SeenInline, ShowSeenToggle } from "../components/MarkCells";
import { CRYPTO_CAT_LABEL, CRYPTO_CAT_UITLEG } from "../components/CryptoBadge";

// Favorieten → 🪙 Crypto: de wekelijkse crypto-scan (xinix-crypto) met een
// eigen formule die los staat van de 5-sterren-scanner. Keuzes van de
// gebruiker op 2026-10-07: alle soorten crypto-aandelen met een eigen label,
// alle DEGIRO-beurzen zonder OTC, minstens één keer +400% binnen een maand,
// nieuws over een cryptostrategie weegt het zwaarst, beurswaarde ≥ $20 mln en
// omzet ≥ $1 mln per dag. Hartje = favoriet en op de watchlist, maar niet in
// het Potje en het Dagadvies; gezien = weg uit deze lijst.

const CAT_TONE: Record<CryptoCat, string> = {
  miner: "border-amber-400/50 bg-amber-400/10 text-amber-300",
  treasury: "border-violet-400/50 bg-violet-400/10 text-violet-300",
  exchange: "border-sky-400/50 bg-sky-400/10 text-sky-300",
  tech: "border-emerald-400/50 bg-emerald-400/10 text-emerald-300",
};
const CAT_FILTER: Record<CryptoCat, string> = { miner: "Miners", treasury: "Schatkist", exchange: "Beurzen", tech: "Techniek" };

const PHASE: Record<string, { label: string; tone: string; uitleg: string }> = {
  groot: { label: "Grote stijger", tone: "text-fog-lime", uitleg: "minstens +100% in de afgelopen maand" },
  uitbraak: { label: "Uitbraak", tone: "text-fog-lime", uitleg: "binnen 3% van de 52-weekstop en minstens +15% in een maand" },
  vroeg: { label: "Vroeg", tone: "text-emerald-300", uitleg: "minstens +30% in de afgelopen maand" },
  comeback: {
    label: "Comeback",
    tone: "text-sky-300",
    uitleg: "nog minstens de helft onder de 5-jaarstop, maar al 1,5× de 52-weekbodem en +30% in drie maanden",
  },
  na_piek: { label: "Na de piek", tone: "text-amber-300", uitleg: "explosie in de laatste vier maanden, nu dalend" },
  rustig: { label: "Rustig", tone: "text-neutral-400", uitleg: "geen van de andere fases" },
};
const NEWS_KIND: Record<string, string> = {
  aankoop: "koopt crypto",
  schatkist: "crypto-schatkist",
  financiering: "geld voor crypto",
  stablecoin: "stablecoin",
  token: "token of staking",
  mining: "mining",
};
const MARKET_NL: Record<string, string> = {
  america: "VS", canada: "Canada", uk: "Londen", germany: "Duitsland", france: "Parijs", netherlands: "Amsterdam",
  belgium: "Brussel", italy: "Milaan", spain: "Madrid", portugal: "Lissabon", poland: "Warschau", switzerland: "Zwitserland",
  sweden: "Stockholm", norway: "Oslo", denmark: "Kopenhagen", finland: "Helsinki", australia: "Australië",
  hongkong: "Hongkong", japan: "Tokio", singapore: "Singapore",
};

type SortKey = "score" | "perf_1m" | "best" | "mcap";

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}
function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return v < 0 ? `−${Math.abs(v).toFixed(0)}%` : `+${v.toFixed(0)}%`;
}
function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)} mrd`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)} mln`;
  return `$${Math.round(v / 1e3)}k`;
}
function fmtMonth(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("nl-NL", { month: "short", year: "numeric" });
}
function pctTone(v: number | null): string {
  if (v == null) return "text-neutral-500";
  return v >= 0 ? "text-fog-lime" : "text-fog-loss";
}
function isNew(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 8 * 24 * 60 * 60 * 1000;
}

function CatChip({ cat }: { cat: CryptoCat | null }) {
  if (!cat) return null;
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${CAT_TONE[cat]}`}
      title={CRYPTO_CAT_UITLEG[cat]}
    >
      {CRYPTO_CAT_LABEL[cat]}
    </span>
  );
}

export function CryptoView() {
  const marks = useMarks();
  const [data, setData] = useState<CryptoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<CryptoCat | null>(null);
  const [showSeen, setShowSeen] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [sort, setSort] = useState<SortKey>("score");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await fetchCrypto());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const unseen = rows.filter((r) => showSeen || !marks.isSeen(r.ticker));
  const counts = new Map<CryptoCat, number>();
  for (const r of unseen) if (r.category) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const hiddenSeen = rows.length - rows.filter((r) => !marks.isSeen(r.ticker)).length;

  const shown = unseen
    .filter((r) => !cat || r.category === cat)
    .sort((a, b) => {
      const by = (f: (r: CryptoRow) => number | null) => (f(b) ?? -Infinity) - (f(a) ?? -Infinity);
      if (sort === "perf_1m") return by((r) => r.perf_1m);
      if (sort === "best") return by((r) => r.best_month_pct);
      if (sort === "mcap") return by((r) => r.mcap_usd);
      return by((r) => r.score) || by((r) => r.perf_1m);
    });

  // Hartje = favoriet, en dan ook op de watchlist (maar niet in het Potje en het Dagadvies).
  async function heart(r: CryptoRow) {
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
      const res = await cryptoAdopt(r.ticker);
      await marks.toggle("favorite", r.ticker);
      setData((prev) => prev && { ...prev, rows: prev.rows.map((x) => (x.ticker === r.ticker ? { ...x, in_watchlist: true, no_sim: true } : x)) });
      toast(res.added ? `${r.ticker} staat nu op de watchlist en bij je favorieten` : `${r.ticker} is favoriet`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const th = (key: SortKey | null, label: string, title?: string, right = true) => (
    <th
      onClick={key ? () => setSort(key) : undefined}
      title={title}
      className={`px-3 py-2 font-bold whitespace-nowrap ${right ? "text-right" : "text-left"} ${
        key ? "cursor-pointer select-none" : ""
      } ${key && sort === key ? "text-neutral-100" : "text-neutral-500"} ${key ? "hover:text-neutral-300" : ""}`}
    >
      {label}
      {key && sort === key ? " ▾" : ""}
    </th>
  );

  const run = data?.last_run;
  return (
    <div className="space-y-4">
      <CollapsibleIntro title="Crypto-aandelen met groeipotentie" icon={<span aria-hidden>🪙</span>}>
        <p className="leading-relaxed">
          Elke zaterdag zoekt Xinix op alle DEGIRO-beurzen (VS, Canada, Europa, Japan, Hongkong en Australië, geen OTC)
          naar crypto-aandelen: <b>miners</b> (ook die naar AI-datacenters zijn omgeschakeld), <b>schatkistbedrijven</b>{" "}
          die bitcoin, ether of een andere munt aanhouden, <b>beurzen</b>, brokers en wallets, en <b>techniek</b>{" "}
          (blockchain, stablecoins, tokenisatie, mininghardware).
        </p>
        <p className="leading-relaxed mt-2">
          Een aandeel staat hier alleen als het in tien jaar dagkoersen <b>minstens één keer +400% binnen een maand</b>{" "}
          steeg, een beurswaarde van minstens $20 mln en een omzet van minstens $1 mln per dag heeft, en geen SPAC zonder
          eigen bedrijf is. Wat afvalt staat onderaan met de reden.
        </p>
        <p className="leading-relaxed mt-2">
          <b>Score (max 100)</b>, een eigen formule los van de 5-sterren-scanner:
        </p>
        <ul className="list-disc pl-5 mt-1 space-y-0.5">
          <li>
            <b>Nieuws over een cryptostrategie, max 50</b>: koopt munten, richt een crypto-schatkist op, haalt daar geld
            voor op, stablecoin, token of staking, mining. Het zwaarste bericht telt voor 30, het tweede voor 12, het
            derde voor 8; nieuws van deze week telt volledig, van een maand oud nog half.
          </li>
          <li>
            <b>Fase, max 25</b>: grote stijger 25, uitbraak 22, vroeg 18, comeback 16, na de piek 6, rustig 3.
          </li>
          <li>
            <b>Explosies, max 15</b>: hoe recent de laatste +400%-maand was (12 binnen 3 maanden, 9 binnen een jaar, 6
            binnen 3 jaar, anders 4), plus 2 of 3 als het vaker gebeurde.
          </li>
          <li>
            <b>Omzet, max 10</b>: 10 vanaf $50 mln per dag, 8 vanaf $10 mln, 6 vanaf $3 mln, anders 4.
          </li>
        </ul>
        <p className="leading-relaxed mt-2">
          <b>Hartje</b>: favoriet en op de watchlist, met het rode CRYPTO-label, maar het aandeel doet <b>niet</b> mee in
          het Potje en het Dagadvies. <b>Gezien</b> (verrekijker): weg uit deze lijst. Komt er een nieuwe kandidaat met
          score 80 of hoger bij, dan krijg je een pushmelding (niet voor favorieten, gezien of gedempte aandelen).
        </p>
      </CollapsibleIntro>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setCat(null)}
          className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
            cat == null ? "border-fog-pink text-neutral-50" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Alle {unseen.length}
        </button>
        {(Object.keys(CAT_FILTER) as CryptoCat[])
          .filter((c) => counts.get(c))
          .map((c) => (
            <button
              key={c}
              onClick={() => setCat(cat === c ? null : c)}
              title={CRYPTO_CAT_UITLEG[c]}
              className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                cat === c ? "border-fog-pink text-neutral-50" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {CAT_FILTER[c]} {counts.get(c)}
            </button>
          ))}
        <span className="ml-auto flex items-center gap-2">
          {hiddenSeen > 0 || showSeen ? <ShowSeenToggle showSeen={showSeen} onChange={setShowSeen} /> : null}
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            Vernieuw
          </Button>
        </span>
      </div>

      {run ? (
        <div className="text-[11px] text-neutral-500">
          Laatste scan {ago(run.finished_at ?? run.started_at)}
          {run.ok === false ? <span className="text-fog-loss"> · mislukt</span> : null}
          {run.message ? <span> · {run.message}</span> : null}
        </div>
      ) : null}

      {error ? <Card className="p-4 text-sm text-fog-loss">{error}</Card> : null}
      {data == null && !error ? <Card className="p-4 text-sm text-neutral-500">Laden…</Card> : null}
      {data != null && shown.length === 0 ? (
        <Card className="p-4 text-sm text-neutral-500">
          {rows.length ? "Niets te tonen met deze filters." : "Nog geen kandidaten: de eerste scan draait zaterdag."}
        </Card>
      ) : null}

      {shown.length ? (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-5/60 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-2 py-2 w-8" title="Favoriet: ook op de watchlist, maar niet in het Potje en het Dagadvies" />
                <th className="px-2 py-2 w-8" title="Gezien: weg uit deze lijst">
                  <span aria-hidden>🔭</span>
                </th>
                {th(null, "Aandeel", undefined, false)}
                {th("score", "Score", "Nieuws (50) + fase (25) + explosies (15) + omzet (10)")}
                {th(null, "Fase", undefined, false)}
                {th(null, "Nieuws over crypto", "Laatste 30 dagen", false)}
                {th("best", "Beste maand", "Grootste stijging binnen 21 handelsdagen in tien jaar")}
                {th("perf_1m", "1M")}
                {th(null, "1W")}
                {th("mcap", "Beurswaarde")}
                {th(null, "Omzet/dag")}
                {th(null, "Koers")}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const fav = marks.isFavorite(r.ticker);
                const c = r.components;
                const phase = r.phase ? PHASE[r.phase] : null;
                const news = r.news ?? [];
                const top = news[0];
                return (
                  <tr
                    key={r.ticker}
                    className={`border-t border-ink-5/40 align-top ${i % 2 ? "bg-white/[0.022]" : ""} ${
                      marks.isSeen(r.ticker) ? "opacity-50" : ""
                    }`}
                  >
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        disabled={busy === r.ticker}
                        onClick={() => void heart(r)}
                        className={`text-base leading-none transition-colors disabled:opacity-40 ${
                          fav ? "text-[#8855ff] hover:text-[#aa77ff]" : "text-[#2a1a4a] hover:text-[#4a2a7a]"
                        }`}
                        title={
                          fav
                            ? "Favoriet — klik om te verwijderen"
                            : "Favoriet maken: ook op de watchlist, maar niet in het Potje en het Dagadvies"
                        }
                        aria-label={`Markeer ${r.ticker} als favoriet`}
                        aria-pressed={fav}
                      >
                        <HeartIcon />
                      </button>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <SeenInline ticker={r.ticker} />
                    </td>
                    <td className="px-3 py-2 min-w-[12rem]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <a
                          href={googleFinanceUrl(r.ticker, r.exchange)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono font-bold text-neutral-100 hover:text-fog-pink"
                        >
                          {r.ticker}
                        </a>
                        <CatChip cat={r.category} />
                        {isNew(r.first_seen_at) ? (
                          <span className="px-1 py-0.5 rounded bg-fog-lime/15 text-fog-lime text-[9px] font-bold">NIEUW</span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-neutral-500 truncate max-w-[16rem]" title={r.name ?? ""}>
                        {r.name ?? ""}
                      </div>
                      <div className="text-[10px] text-neutral-600">
                        {MARKET_NL[r.market] ?? r.market}
                        {r.in_watchlist ? <span className="text-fog-lime"> · op de watchlist</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div
                        className={`text-lg font-extrabold tabular-nums ${
                          (r.score ?? 0) >= 80 ? "text-fog-lime" : (r.score ?? 0) >= 50 ? "text-neutral-100" : "text-neutral-400"
                        }`}
                      >
                        {r.score ?? "—"}
                      </div>
                      {c ? (
                        <div
                          className="text-[10px] text-neutral-500 tabular-nums"
                          title={`Nieuws ${c.nieuws}/50 · fase ${c.fase}/25 · explosies ${c.explosie}/15 · omzet ${c.omzet}/10`}
                        >
                          {c.nieuws}·{c.fase}·{c.explosie}·{c.omzet}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {phase ? (
                        <span className={`text-xs font-bold ${phase.tone}`} title={phase.uitleg}>
                          {phase.label}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 min-w-[14rem] max-w-[22rem]">
                      {top ? (
                        <>
                          <a
                            href={top.url ?? undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-neutral-200 hover:text-fog-pink line-clamp-2"
                            title={news.map((n) => `${n.title} (${NEWS_KIND[n.kind] ?? n.kind})`).join("\n")}
                          >
                            {top.title}
                          </a>
                          <div className="text-[10px] text-neutral-500">
                            {NEWS_KIND[top.kind] ?? top.kind} · {ago(top.at)}
                            {news.length > 1 ? ` · +${news.length - 1}` : ""}
                          </div>
                        </>
                      ) : (
                        <span className="text-[11px] text-neutral-600">geen cryptonieuws</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div className="font-bold tabular-nums text-fog-lime">{fmtPct(r.best_month_pct)}</div>
                      <div
                        className="text-[10px] text-neutral-500"
                        title={`${r.months_400 ?? 0}× minstens +400% binnen een maand; laatste keer ${fmtMonth(r.last_400_end)}`}
                      >
                        {fmtMonth(r.best_month_end)}
                        {(r.months_400 ?? 0) > 1 ? ` · ${r.months_400}×` : ""}
                      </div>
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${pctTone(r.perf_1m)}`}>{fmtPct(r.perf_1m)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${pctTone(r.perf_w)}`}>{fmtPct(r.perf_w)}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-neutral-300">{fmtUsd(r.mcap_usd)}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-neutral-300">{fmtUsd(r.dollar_vol_usd)}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-neutral-300">
                      {fmtPrice(r.close)}
                      <span className="ml-1 text-[10px] text-neutral-600">{r.currency ?? ""}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}

      {data?.excluded.length ? (
        <div>
          <button
            type="button"
            onClick={() => setShowExcluded((v) => !v)}
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            {showExcluded ? "▾" : "▸"} Afgevallen ({data.excluded.length}): crypto-aandelen die niet aan de eisen voldoen
          </button>
          {showExcluded ? (
            <Card className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-ink-5/60 text-[10px] uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-3 py-1.5 text-left">Aandeel</th>
                    <th className="px-3 py-1.5 text-left">Soort</th>
                    <th className="px-3 py-1.5 text-left">Markt</th>
                    <th className="px-3 py-1.5 text-left">Waarom niet</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.excluded]
                    .sort((a, b) => (b.best_month_pct ?? -1) - (a.best_month_pct ?? -1) || a.ticker.localeCompare(b.ticker))
                    .map((r) => (
                      <tr key={r.ticker} className="border-t border-ink-5/40">
                        <td className="px-3 py-1">
                          <span className="font-mono font-bold text-neutral-200">{r.ticker}</span>
                          <span className="ml-2 text-neutral-500">{r.name ?? ""}</span>
                        </td>
                        <td className="px-3 py-1">
                          <CatChip cat={r.category} />
                        </td>
                        <td className="px-3 py-1 text-neutral-500">{MARKET_NL[r.market] ?? r.market}</td>
                        <td className="px-3 py-1 text-neutral-400">{r.reason ?? "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
