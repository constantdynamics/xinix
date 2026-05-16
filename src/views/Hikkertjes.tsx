import { useEffect, useState } from "react";
import {
  fetchScanResults,
  triggerJob,
  getToken,
  type HikkertjeRankEntry,
} from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, Pill, Stat } from "../components/ui";

function fmtPrice(v: number): string {
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}

function MedalPips({ g, s, b }: { g: number | null; s: number | null; b: number | null }) {
  const parts: string[] = [];
  if (g) for (let i = 0; i < Math.min(g, 5); i++) parts.push("🏆");
  if (s) for (let i = 0; i < Math.min(s, 5); i++) parts.push("🥈");
  if (b) for (let i = 0; i < Math.min(b, 5); i++) parts.push("🥉");
  if (!parts.length) return null;
  return <span className="text-xs">{parts.join("")}</span>;
}

export function HikkertjesView() {
  const [ranking, setRanking] = useState<HikkertjeRankEntry[]>([]);
  const [hikkertjeCount, setHikkertjeCount] = useState(0);
  const [unscanned, setUnscanned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchScanResults()
      .then((r) => {
        setRanking(r.hikkertje_ranking ?? []);
        setHikkertjeCount(r.hikkertje_count ?? 0);
        setUnscanned(r.hikkertje_unscanned ?? 0);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, []);

  async function runScan() {
    setScanning(true);
    setScanMsg(null);
    try {
      await triggerJob("compute-hikkertjes-background");
      setScanMsg("Scan gestart — ververs over ~2 min.");
    } catch (e) {
      setScanMsg(`Fout: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning(false);
    }
  }

  const isAdmin = !!getToken();

  if (loading) {
    return <Card className="p-10 text-center text-sm text-neutral-500">Laden…</Card>;
  }
  if (error) {
    return <Card className="p-4 text-sm text-fog-loss border-fog-loss/30">{error}</Card>;
  }

  return (
    <div className="space-y-6">
      {/* Uitleg */}
      <Card className="p-4 border-yellow-500/30 bg-yellow-500/[0.04]">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚡</span>
          <div className="flex-1">
            <div className="font-semibold text-yellow-400 mb-1">Hikkertjes</div>
            <p className="text-sm text-neutral-300 leading-relaxed">
              Aandelen die in het afgelopen jaar minimaal <strong>2×</strong> op één dag <strong>≥50%</strong> gestegen zijn
              en die stijging minimaal <strong>3 handelsdagen</strong> vasthielden. Dit patroon duidt op extreme
              volatiliteit en explosief koerspotentieel — maar ook hoog risico.
            </p>
          </div>
        </div>
      </Card>

      {/* Stats + trigger */}
      <div className="flex flex-wrap items-center gap-4">
        <Stat label="Hikkertjes gevonden" value={hikkertjeCount} />
        <Stat label="Nog te scannen" value={unscanned} />
        {isAdmin && (
          <div className="flex items-center gap-2 ml-auto">
            {scanMsg && <span className="text-xs text-neutral-400">{scanMsg}</span>}
            <Button size="sm" variant="secondary" onClick={runScan} disabled={scanning}>
              {scanning ? "…" : "⚡ Scan starten"}
            </Button>
          </div>
        )}
      </div>

      {/* Ranking */}
      {ranking.length === 0 ? (
        <Card className="p-10 text-center text-sm text-neutral-500">
          <div className="text-3xl mb-3">⚡</div>
          <div>Nog geen hikkertjes gevonden.</div>
          <div className="mt-1 text-neutral-600">
            {unscanned > 0
              ? `${unscanned} tickers wachten op scan — gebruik de knop hierboven (admin).`
              : "Alle tickers zijn gescand."}
          </div>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-5 flex items-center justify-between">
            <div className="font-semibold text-sm">
              Top {ranking.length} hikkertjes
            </div>
            <div className="text-xs text-neutral-500">gesorteerd op meeste spikes, daarna aankooplimiet</div>
          </div>
          <div className="divide-y divide-ink-5">
            {ranking.map((h, idx) => {
              const gfUrl = googleFinanceUrl(h.ticker, h.exchange);
              const belowLimit = h.above_limit_pct != null && h.above_limit_pct <= 0;
              const nearLimit = h.above_limit_pct != null && h.above_limit_pct > 0 && h.above_limit_pct <= 10;

              return (
                <div
                  key={h.ticker}
                  className={`px-4 py-3 flex items-center gap-3 text-sm ${belowLimit ? "bg-yellow-500/[0.06]" : ""}`}
                >
                  <span className="text-neutral-600 w-6 text-right tabular shrink-0">{idx + 1}</span>

                  <div className="w-24 shrink-0">
                    <a
                      href={gfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono font-semibold text-yellow-400 hover:underline"
                    >
                      {h.ticker}
                    </a>
                    <div className="mt-0.5">
                      <MedalPips g={h.medal_gold} s={h.medal_silver} b={h.medal_bronze} />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="truncate text-neutral-200">{h.company ?? "—"}</div>
                    {h.sector && (
                      <div className="mt-0.5">
                        <Pill>{h.sector}</Pill>
                      </div>
                    )}
                  </div>

                  {/* Spikes */}
                  <div className="shrink-0 text-center w-14">
                    <div className="font-semibold text-yellow-400 tabular">{h.hikkertje_spikes ?? "—"}×</div>
                    <div className="text-[10px] text-neutral-500">spikes</div>
                  </div>

                  {/* Koers */}
                  <div className="shrink-0 text-right w-16">
                    <div className="tabular font-mono text-neutral-200">
                      {h.last_close != null ? `$${fmtPrice(h.last_close)}` : "—"}
                    </div>
                    <div className="text-[10px] text-neutral-500">koers</div>
                  </div>

                  {/* Limiet + afstand */}
                  <div className="shrink-0 text-right w-20">
                    {h.buy_limit != null ? (
                      <>
                        <div className="tabular font-mono text-neutral-400">${fmtPrice(h.buy_limit)}</div>
                        {h.above_limit_pct != null && (
                          <div className={`text-[10px] tabular font-semibold ${
                            belowLimit ? "text-yellow-400" : nearLimit ? "text-yellow-600" : "text-neutral-500"
                          }`}>
                            {h.above_limit_pct >= 0 ? "+" : ""}{h.above_limit_pct.toFixed(1)}%
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-neutral-600 text-xs">geen limiet</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
