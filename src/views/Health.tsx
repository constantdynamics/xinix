import { useEffect, useMemo, useState } from "react";
import { fetchHealth, triggerJob } from "../api";
import type { Health, HealthJob, HealthRun } from "../types";
import { Card, Button, SectionHeader, Dot, Badge, Modal, Sparkline, useTickingNow, ago, EmptyState } from "../components/ui";

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
// Stil als warn-tone zodat het opvalt — was eerst neutral grijs wat te
// passief voelde voor jobs die mogelijk vastlopen.
const STATUS_DOT: Record<Status, "lime" | "watch" | "loss"> = {
  ok: "lime", warn: "watch", bad: "loss", stale: "watch",
};
const STATUS_LABEL: Record<Status, string> = {
  ok: "Draait", warn: "Te laat", bad: "Fout", stale: "Stil",
};

// Jobs die via /api/trigger handmatig kunnen worden gestart. De trigger
// endpoint accepteert alleen `<job>-background` namen die in zijn
// hard-coded toegestane lijst staan.
const TRIGGERABLE = new Set([
  "poll-prices", "poll-trials", "poll-edgar", "poll-fda",
  "poll-biotech-news", "poll-metals", "poll-mining-news",
  "compute-signals", "compute-scores", "dispatch-alerts",
  "forward-returns",
]);

function fmtInterval(min: number): string {
  if (min <= 0) return "—";
  if (min < 60) return `~elke ${min} min`;
  if (min < 1440) return `~elke ${Math.round(min / 60)} u`;
  if (min <= 1440) return "~1×/dag";
  return `~1×/${Math.round(min / 1440)} dgn`;
}

function statusOf(j: HealthJob, now: number): Status {
  const meta = JOB_META[j.job];
  const intervalMin = meta?.intervalMin ?? 0;
  const ageMin = (now - new Date(j.last_started_at).getTime()) / 60000;
  const staleThreshold = Math.max(intervalMin * 3, intervalMin + 360);
  if (intervalMin > 0 && ageMin > staleThreshold) return "stale";
  if (j.last_ok === false) return "bad";
  if (intervalMin > 0 && ageMin > intervalMin * 1.5) return "warn";
  return "ok";
}

// Foutmelding leesbaarder maken. Compute-extremes/poll-prices loggen
// vaak "X bijgewerkt, Y mislukt, …; TICKER: Yahoo HTTP 404; …" — voor
// een eindgebruiker zegt dat weinig.
function humanizeMessage(job: string, msg: string | null): string | null {
  if (!msg) return msg;
  // "0 bijgewerkt, 19 mislukt, 0 nog te doen; TSE: Yahoo TSE HTTP 404; …"
  const m = msg.match(/^(\d+)\s+bijgewerkt,\s+(\d+)\s+mislukt,\s+(\d+)\s+nog te doen(?:;\s*(.+))?$/);
  if (m) {
    const ok = parseInt(m[1], 10);
    const fail = parseInt(m[2], 10);
    const left = parseInt(m[3], 10);
    const tail = m[4] ?? "";
    const all404 = /HTTP 404/.test(tail) && !/HTTP [^4]/.test(tail);
    const parts: string[] = [];
    if (ok > 0) parts.push(`${ok} bijgewerkt`);
    if (fail > 0) parts.push(`${fail} mislukt${all404 ? " (Yahoo kent de ticker niet)" : ""}`);
    if (left > 0) parts.push(`${left} wachten op volgende run`);
    return parts.length ? parts.join(" · ") : msg;
  }
  return msg;
}

interface RunDetail {
  job: string;
  jobLabel: string;
  run: HealthRun;
}

export function HealthView() {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null);
  const [showNeverSeen, setShowNeverSeen] = useState(false);
  const now = useTickingNow(30_000);

  async function trigger(job: string) {
    setBusyJob(job);
    setTriggerMsg(null);
    try {
      await triggerJob(`${job}-background`);
      setTriggerMsg(`${job} getriggerd — de run verschijnt zo in de history`);
    } catch (e) {
      setTriggerMsg(`${job}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyJob(null);
    }
  }

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
  // Eenmalig laden bij openen. Geen auto-verversing meer (bespaart egress) —
  // gebruik de "vernieuw"-knop om de jobstatus handmatig bij te werken.
  useEffect(() => {
    load();
  }, []);

  // Splits "gewone" jobs (met run-history) van "nog nooit gezien" jobs;
  // die laatste cluster vouwen we standaard dicht in een aparte sectie.
  const { jobs, neverSeen } = useMemo(() => {
    const list = data?.jobs ?? [];
    const seenMap = new Map(list.map((j) => [j.job, j]));
    const seenJobs: Array<{ j: HealthJob; s: Status }> = [];
    const neverJobs: HealthJob[] = [];
    for (const j of list) {
      seenJobs.push({ j, s: statusOf(j, now) });
    }
    for (const jobName of Object.keys(JOB_META)) {
      if (!seenMap.has(jobName)) {
        neverJobs.push({
          job: jobName,
          last_started_at: "",
          last_finished_at: null,
          last_ok: null,
          last_message: null,
          last_metrics: null,
          runs_24h: 0,
          ok_24h: 0,
          recent: [],
        });
      }
    }
    const order: Record<Status, number> = { bad: 0, stale: 1, warn: 2, ok: 3 };
    seenJobs.sort((a, b) => order[a.s] - order[b.s] || a.j.job.localeCompare(b.j.job));
    return { jobs: seenJobs, neverSeen: neverJobs };
  }, [data, now]);

  const counts = useMemo(() => {
    const c = { ok: 0, warn: 0, bad: 0, stale: 0 };
    for (const { s } of jobs) c[s]++;
    return c;
  }, [jobs]);

  const filtered = useMemo(() => {
    if (!onlyProblems) return jobs;
    return jobs.filter(({ s }) => s !== "ok");
  }, [jobs, onlyProblems]);

  const hasProblems = counts.bad + counts.warn + counts.stale > 0;

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Status"
        title="Achtergrond-jobs"
        subtitle={
          data
            ? `Alle pollers die je dashboard voeden. Groen = ok. Bijgewerkt ${ago(data.generated_at, now)}.`
            : loading ? "laden…" : "—"
        }
        aside={
          <Button size="sm" variant="secondary" onClick={load} disabled={loading} title="Vernieuw">
            {loading ? "…" : "↻"}<span className="hidden sm:inline">vernieuw</span>
          </Button>
        }
      />

      {/* KPI strip — alleen niet-nul */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <CountTile label="Draaien goed" count={counts.ok} tone="lime" />
        {counts.warn > 0 && <CountTile label="Te laat" count={counts.warn} tone="watch" />}
        {counts.bad > 0 && <CountTile label="Fout" count={counts.bad} tone="loss" />}
        {counts.stale > 0 && <CountTile label="Lang stil" count={counts.stale} tone="neutral" />}
      </div>

      {error && (
        <Card className="p-3 text-sm text-fog-loss border border-fog-loss/40 bg-fog-loss/10">
          Status ophalen mislukt: {error}
        </Card>
      )}

      {triggerMsg && (
        <Card className="p-3 text-xs text-neutral-200 border border-fog-pink/40 bg-fog-pink/10">
          {triggerMsg}
        </Card>
      )}

      {hasProblems && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOnlyProblems((v) => !v)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors ${
              onlyProblems ? "bg-fog-loss/25 text-fog-loss" : "bg-ink-3 text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {onlyProblems ? "Alle jobs tonen" : "Alleen problemen"}
          </button>
          <span className="text-[11px] text-neutral-500">
            {onlyProblems ? `${filtered.length} jobs met problemen` : `${jobs.length} jobs totaal`}
          </span>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map(({ j, s }) => {
          const meta = JOB_META[j.job];
          const humanMsg = humanizeMessage(j.job, j.last_message);
          const ringCls = s === "bad" ? "ring-1 ring-fog-loss/40" : s === "warn" ? "ring-1 ring-fog-watch/30" : s === "stale" ? "ring-1 ring-neutral-700" : "";
          return (
            <Card key={j.job} className={`p-4 ${ringCls}`}>
              <div className="flex items-start gap-3">
                <div className="pt-1.5">
                  <Dot tone={STATUS_DOT[s]} pulse={s === "bad"} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-bold text-neutral-50">{meta?.label ?? j.job}</span>
                    <Badge tone={s === "ok" ? "lime" : s === "warn" ? "watch" : s === "bad" ? "loss" : "watch"}>
                      {STATUS_LABEL[s]}
                    </Badge>
                    <span className="font-mono text-[10px] text-neutral-600">{j.job}</span>
                    {TRIGGERABLE.has(j.job) && (
                      <button
                        onClick={() => trigger(j.job)}
                        disabled={busyJob === j.job}
                        className="ml-auto text-[10px] uppercase tracking-wider font-bold text-neutral-500 hover:text-fog-pink disabled:opacity-40 transition-colors px-2 py-0.5 rounded border border-ink-5 hover:border-fog-pink/40"
                        title="Start deze job nu handmatig"
                      >
                        {busyJob === j.job ? "…" : "▶ nu"}
                      </button>
                    )}
                  </div>
                  {meta && <div className="text-[11px] text-neutral-400 mt-1">{meta.desc}</div>}
                  <div className="text-xs text-neutral-300 mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {j.last_started_at ? (
                      <>
                        <span className="tabular text-neutral-400">
                          laatst: {ago(j.last_started_at, now)}
                          {j.last_finished_at == null && " (loopt nog)"}
                        </span>
                        {meta && <span className="text-neutral-600">·</span>}
                        {meta && <span className="text-neutral-500">{fmtInterval(meta.intervalMin)}</span>}
                        {j.runs_24h > 0 && (
                          <>
                            <span className="text-neutral-600">·</span>
                            <RunsRatio ok={j.ok_24h} total={j.runs_24h} />
                          </>
                        )}
                      </>
                    ) : (
                      <span className="text-neutral-500 italic">nog niet gezien</span>
                    )}
                  </div>
                  {humanMsg && (
                    <div className={`text-[11px] mt-2 break-words rounded-md px-2 py-1 ${
                      j.last_ok === false ? "text-fog-loss bg-fog-loss/10" : "text-neutral-400 bg-ink-1/40"
                    }`}>
                      {humanMsg}
                    </div>
                  )}
                  {j.recent.length > 0 && (
                    <div className="mt-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[10px] uppercase tracking-wider text-neutral-600">
                          laatste {j.recent.length} runs (klik voor details)
                        </div>
                        {/* Sparkline ok-rate per run (1 = ok, 0 = fail) */}
                        {j.recent.length >= 3 && (
                          <Sparkline
                            values={[...j.recent].reverse().map((r) => (r.ok === true ? 1 : r.ok === false ? 0 : 0.5))}
                            tone={j.recent.some((r) => r.ok === false) ? "loss" : "lime"}
                            width={80}
                            height={14}
                          />
                        )}
                      </div>
                      <div className="flex gap-0.5 flex-wrap">
                        {[...j.recent].reverse().map((r, i) => (
                          <button
                            key={i}
                            onClick={() => setRunDetail({ job: j.job, jobLabel: meta?.label ?? j.job, run: r })}
                            className={`inline-block w-3 h-4 rounded-[2px] hover:ring-1 hover:ring-fog-pink transition ${
                              r.ok === true ? "bg-fog-lime/70 hover:bg-fog-lime" : r.ok === false ? "bg-fog-loss/80 hover:bg-fog-loss" : "bg-neutral-600 hover:bg-neutral-500"
                            }`}
                            title={`${new Date(r.started_at).toLocaleString("nl-NL")} — klik voor details`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
        {filtered.length === 0 && !loading && jobs.length > 0 && (
          <EmptyState
            title="Geen problemen"
            description="Alle zichtbare jobs draaien zoals verwacht."
          />
        )}
        {jobs.length === 0 && !loading && (
          <EmptyState
            title="Nog geen run-data"
            description="Zodra een achtergrond-job draait verschijnt zijn status hier."
          />
        )}
      </div>

      {neverSeen.length > 0 && !onlyProblems && (
        <Card className="p-3">
          <button
            onClick={() => setShowNeverSeen((v) => !v)}
            className="flex items-center gap-2 text-xs font-bold text-neutral-400 hover:text-neutral-100 transition-colors w-full"
          >
            <span>{showNeverSeen ? "▾" : "▸"}</span>
            <span>
              {neverSeen.length} job{neverSeen.length > 1 ? "s" : ""} nog nooit gezien
            </span>
            <span className="text-[10px] uppercase tracking-wider text-neutral-600 ml-auto">
              klik om {showNeverSeen ? "te verbergen" : "te tonen"}
            </span>
          </button>
          {showNeverSeen && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {neverSeen.map((j) => {
                const meta = JOB_META[j.job];
                return (
                  <div key={j.job} className="rounded-lg border border-ink-5 bg-ink-1/40 p-2.5">
                    <div className="flex items-center gap-2">
                      <Dot tone="neutral" />
                      <span className="text-xs font-semibold text-neutral-300 truncate">
                        {meta?.label ?? j.job}
                      </span>
                      {TRIGGERABLE.has(j.job) && (
                        <button
                          onClick={() => trigger(j.job)}
                          disabled={busyJob === j.job}
                          className="ml-auto text-[10px] uppercase tracking-wider font-bold text-fog-pink hover:underline disabled:opacity-40"
                        >
                          {busyJob === j.job ? "…" : "▶ start"}
                        </button>
                      )}
                    </div>
                    <div className="text-[10px] text-neutral-500 mt-1 font-mono">{j.job}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <Modal
        open={runDetail != null}
        onClose={() => setRunDetail(null)}
        title={
          runDetail ? (
            <div className="flex items-center gap-2">
              <Dot tone={runDetail.run.ok === true ? "lime" : runDetail.run.ok === false ? "loss" : "neutral"} />
              <span>{runDetail.jobLabel}</span>
              <span className="font-mono text-[10px] text-neutral-500">{runDetail.job}</span>
            </div>
          ) : null
        }
      >
        {runDetail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">Gestart</div>
                <div className="tabular text-neutral-200 mt-0.5">
                  {new Date(runDetail.run.started_at).toLocaleString("nl-NL")}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">Geëindigd</div>
                <div className="tabular text-neutral-200 mt-0.5">
                  {runDetail.run.finished_at
                    ? new Date(runDetail.run.finished_at).toLocaleString("nl-NL")
                    : <span className="text-neutral-500 italic">loopt nog</span>}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">Resultaat</div>
                <div className="mt-0.5">
                  {runDetail.run.ok === true && <Badge tone="lime">OK</Badge>}
                  {runDetail.run.ok === false && <Badge tone="loss">FOUT</Badge>}
                  {runDetail.run.ok == null && <Badge tone="neutral">onbekend</Badge>}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">Duur</div>
                <div className="tabular text-neutral-200 mt-0.5">
                  {runDetail.run.finished_at
                    ? `${Math.round((new Date(runDetail.run.finished_at).getTime() - new Date(runDetail.run.started_at).getTime()) / 1000)}s`
                    : "—"}
                </div>
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Volledige bericht</div>
              <pre className={`text-[11px] font-mono whitespace-pre-wrap break-words rounded-md p-3 ${
                runDetail.run.ok === false ? "bg-fog-loss/10 text-fog-loss" : "bg-ink-1 text-neutral-300"
              }`}>
                {runDetail.run.message ?? "(geen bericht)"}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// Mini-progressbar voor de 24u ok-ratio. Lime bij 100%, watch onder 80%,
// loss onder 50%. Compacter dan losse tekst zoals "5/6 ok".
function RunsRatio({ ok, total }: { ok: number; total: number }) {
  if (total === 0) return null;
  const pct = ok / total;
  const tone = pct >= 0.99 ? "bg-fog-lime" : pct >= 0.8 ? "bg-fog-watch" : "bg-fog-loss";
  const text = pct >= 0.99 ? "text-neutral-500" : pct >= 0.8 ? "text-fog-watch" : "text-fog-loss";
  return (
    <span
      className="inline-flex items-center gap-1.5 tabular"
      title={`${ok} van ${total} runs succesvol in de laatste 24u`}
    >
      <span className="relative inline-block w-10 h-1.5 rounded-full bg-ink-1 overflow-hidden">
        <span className={`absolute inset-y-0 left-0 ${tone}`} style={{ width: `${pct * 100}%` }} />
      </span>
      <span className={text}>{ok}/{total}</span>
    </span>
  );
}

function CountTile({ label, count, tone }: { label: string; count: number; tone: "lime" | "watch" | "loss" | "neutral" }) {
  const colorCls = tone === "lime" ? "text-fog-lime" : tone === "watch" ? "text-fog-watch" : tone === "loss" ? "text-fog-loss" : "text-neutral-300";
  return (
    <Card className="p-3 flex items-center gap-3">
      <Dot tone={tone} className="w-3 h-3" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
        <div className={`text-xl font-bold tabular ${colorCls}`}>{count}</div>
      </div>
    </Card>
  );
}
