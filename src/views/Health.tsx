import { useEffect, useMemo, useState } from "react";
import { fetchHealth } from "../api";
import type { Health, HealthJob } from "../types";
import { Card, Button, SectionHeader, Dot } from "../components/ui";

// Bekende doorlopende jobs: label, verwacht interval in minuten, korte uitleg.
// Onbekende jobs (niet in deze map) worden generiek getoond.
const JOB_META: Record<string, { label: string; intervalMin: number; desc: string }> = {
  "poll-prices": { label: "Koersen ophalen (Yahoo)", intervalMin: 10, desc: "Round-robin door de hele watchlist; vult koers, dividend en buy-limit-signalen." },
  "dispatch-alerts": { label: "Notificaties versturen", intervalMin: 15, desc: "Stuurt de ntfy/e-mail pushmeldingen voor de signalen die er doorheen mogen." },
  "compute-scores": { label: "Scores herberekenen", intervalMin: 30, desc: "De algoritmische Structureel×Catalyst×Timing-score per ticker." },
  "compute-extremes": { label: "1y/5y-extremes + medailles", intervalMin: 30, desc: "5y weekkoersen → 1y/5y high/low en het medailleklassement." },
  "compute-signals": { label: "Signalen herberekenen", intervalMin: 1440, desc: "Leidt afgeleide signalen af uit catalysts, macro, etc." },
  "poll-edgar": { label: "SEC-filings (8-K e.d.)", intervalMin: 30, desc: "Materiële agreements / events uit EDGAR." },
  "poll-fda": { label: "FDA-kalender", intervalMin: 360, desc: "PDUFA-data en FDA-beslissingen." },
  "poll-trials": { label: "ClinicalTrials.gov", intervalMin: 1440, desc: "Trial-status en readout-data." },
  "poll-biotech-news": { label: "Biotech-nieuws", intervalMin: 120, desc: "Yahoo-nieuws gescand op biotech-catalysts." },
  "poll-mining-news": { label: "Mining-nieuws", intervalMin: 120, desc: "Yahoo-nieuws gescand op mining-events (bonanza grades, resource updates, …)." },
  "poll-fundamentals": { label: "Fundamentals ophalen (Yahoo)", intervalMin: 360, desc: "Round-robin door de watchlist; vult market cap, shares, insider%, jurisdiction, cash runway." },
  "poll-metals": { label: "Grondstofprijzen", intervalMin: 4320, desc: "Goud/zilver/koper/lithium/… — alleen op beursdagen." },
  "forward-returns": { label: "Forward returns meten", intervalMin: 1440, desc: "Werkelijke 7/14/30/90d returns na signalen (voor Track record)." },
  "losers-digest": { label: "Wekelijkse/maandelijkse losers-digest", intervalMin: 1440, desc: "Samenvatting van de slechtst-presterende tickers in je watchlist." },
  "scan-losers": { label: "TradingView: grootste dalers → ≥1× goud + ≥1× zilver", intervalMin: 1440, desc: "1×/dag (~23:00 UTC) de biggest losers per markt; medailles ≥1g+1s → toevoegen + melding." },
  "scan-bottoms": { label: "TradingView: bij 5y-bodem → ≥3× goud", intervalMin: 1440, desc: "1×/dag (~04:00 UTC), roterend door de Saxo-beurzen; binnen 10% van 5y-low + ≥3 goud → toevoegen + melding." },
};

type Status = "ok" | "warn" | "bad" | "stale";
const STATUS_DOT: Record<Status, "lime" | "watch" | "loss" | "neutral"> = {
  ok: "lime", warn: "watch", bad: "loss", stale: "neutral",
};
const STATUS_LABEL: Record<Status, string> = {
  ok: "Draait", warn: "Te laat / let op", bad: "Fout", stale: "Lang niet gedraaid",
};

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "zojuist";
  if (m < 60) return `${m} min geleden`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} uur geleden`;
  const d = Math.floor(h / 24);
  return `${d} dag${d > 1 ? "en" : ""} geleden`;
}
function fmtInterval(min: number): string {
  if (min <= 0) return "—";
  if (min < 60) return `~elke ${min} min`;
  if (min < 1440) return `~elke ${Math.round(min / 60)} u`;
  if (min <= 1440) return "~1×/dag";
  return `~1×/${Math.round(min / 1440)} dgn`;
}

function statusOf(j: HealthJob): Status {
  const meta = JOB_META[j.job];
  const intervalMin = meta?.intervalMin ?? 0;
  const ageMin = (Date.now() - new Date(j.last_started_at).getTime()) / 60000;
  if (intervalMin > 0 && ageMin > intervalMin * 6) return "stale";
  if (j.last_ok === false) return "bad";
  if (intervalMin > 0 && ageMin > intervalMin * 2.5) return "warn";
  return "ok";
}

export function HealthView() {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setLoading(true);
      setData(await fetchHealth());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  const jobs = useMemo(() => {
    const list = data?.jobs ?? [];
    const seen = new Set(list.map((j) => j.job));
    // jobs die we kennen maar (nog) niet in de data zitten -> tonen als "nog niet gedraaid"
    const missing: HealthJob[] = Object.keys(JOB_META)
      .filter((j) => !seen.has(j))
      .map((j) => ({ job: j, last_started_at: "", last_finished_at: null, last_ok: null, last_message: "nog niet gedraaid sinds deze status-pagina kijkt", last_metrics: null, runs_24h: 0, ok_24h: 0, recent: [] }));
    const all = [...list, ...missing];
    const order: Record<Status, number> = { bad: 0, stale: 1, warn: 2, ok: 3 };
    return all
      .map((j) => ({ j, s: j.last_started_at ? statusOf(j) : ("stale" as Status) }))
      .sort((a, b) => order[a.s] - order[b.s] || a.j.job.localeCompare(b.j.job));
  }, [data]);

  const counts = useMemo(() => {
    const c = { ok: 0, warn: 0, bad: 0, stale: 0 };
    for (const { s } of jobs) c[s]++;
    return c;
  }, [jobs]);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Status"
        title="Achtergrond-jobs"
        subtitle={
          data
            ? `${counts.ok} draaien goed · ${counts.warn} let op · ${counts.bad} fout · ${counts.stale} stil · bijgewerkt ${ago(data.generated_at)}`
            : loading ? "laden…" : "—"
        }
        aside={
          <Button size="sm" variant="secondary" onClick={load} disabled={loading} title="Vernieuw">
            {loading ? "…" : "↻"}<span className="hidden sm:inline">vernieuw</span>
          </Button>
        }
      />
      {error && (
        <Card className="p-3 text-sm text-fog-loss border border-fog-loss/40 bg-fog-loss/10">
          Status ophalen mislukt: {error}
        </Card>
      )}

      <div className="space-y-2">
        {jobs.map(({ j, s }) => {
          const meta = JOB_META[j.job];
          return (
            <Card key={j.job} className={`p-4 ${s === "bad" ? "ring-1 ring-fog-loss/30" : s === "warn" ? "ring-1 ring-fog-watch/25" : ""}`}>
              <div className="flex items-start gap-3">
                <div className="pt-1">
                  <Dot tone={STATUS_DOT[s]} pulse={s === "bad"} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-bold text-neutral-50">{meta?.label ?? j.job}</span>
                    <span className="font-mono text-[10px] text-neutral-500">{j.job}</span>
                    <span
                      className={`text-[10px] uppercase tracking-wider font-bold ${
                        s === "ok" ? "text-fog-lime" : s === "warn" ? "text-fog-watch" : s === "bad" ? "text-fog-loss" : "text-neutral-500"
                      }`}
                    >
                      {STATUS_LABEL[s]}
                    </span>
                  </div>
                  {meta && <div className="text-[11px] text-neutral-400 mt-0.5">{meta.desc}</div>}
                  <div className="text-xs text-neutral-300 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {j.last_started_at ? (
                      <>
                        <span className="tabular text-neutral-400">
                          laatst: {ago(j.last_started_at)}
                          {j.last_finished_at == null && " (loopt nog)"}
                        </span>
                        {meta && <span className="text-neutral-500">{fmtInterval(meta.intervalMin)}</span>}
                        <span className="text-neutral-500 tabular">
                          {j.ok_24h}/{j.runs_24h} ok laatste 24u
                        </span>
                      </>
                    ) : (
                      <span className="text-neutral-500 italic">nog niet gezien</span>
                    )}
                  </div>
                  {j.last_message && (
                    <div className={`text-[11px] mt-1 break-words ${j.last_ok === false ? "text-fog-loss" : "text-neutral-400"}`}>
                      {j.last_message}
                    </div>
                  )}
                  {j.recent.length > 0 && (
                    <div className="flex gap-0.5 mt-2 flex-wrap" title="Laatste runs (links = oudst)">
                      {[...j.recent].reverse().map((r, i) => (
                        <span
                          key={i}
                          className={`inline-block w-2.5 h-3.5 rounded-[2px] ${
                            r.ok === true ? "bg-fog-lime/70" : r.ok === false ? "bg-fog-loss/80" : "bg-neutral-600"
                          }`}
                          title={`${new Date(r.started_at).toLocaleString("nl-NL")}\n${r.ok === true ? "ok" : r.ok === false ? "FOUT" : "onbekend"}${r.message ? `\n${r.message}` : ""}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
        {jobs.length === 0 && !loading && (
          <Card className="p-6 text-center text-neutral-400 text-sm">Nog geen run-data.</Card>
        )}
      </div>
    </div>
  );
}
