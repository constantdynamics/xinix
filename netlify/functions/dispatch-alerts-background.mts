import type { Config } from "@netlify/functions";
import { getServiceClient, logRun } from "./_lib/supabase.mts";
import { SEVERITY_RANK, type Severity } from "./_lib/signals.mts";

interface Settings {
  email: string | null;
  ntfy_topic: string | null;
  ntfy_server: string;
  alert_email_threshold: Severity;
  alert_ntfy_threshold: Severity;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  alert_only_goud_events: boolean;
}

// Whitelist of signal_types where a *red-severity* signal historically aligns
// with the user's bar: ≥100% in 1 day OR ≥250% in 1 week. Any other type, or
// any orange/yellow signal, stays on the dashboard but does not alert.
//
// Calibration notes per type:
//   bonanza_au/ag/cu  red tier = ≥100 g/t Au, ≥3000 g/t Ag, ≥8% Cu
//                     (lower bonanza tiers fire orange, no alert)
//   discovery_announcement   PR-language for new high-grade zone
//   permit            kept despite lower hit-rate; Pebble/Skouries-style
//                     wins after multi-year sagas do hit 100%/day
//   takeover_bid      direct cash bid or definitive acquisition agreement
//   fda_approval      conditional or full approval
//   topline_positive  primary endpoint met / topline data positive
//                     (the #1 biotech 100%/day driver — VKTX/KRYS/AKRO style)
//   phase_success     "Phase 2/3 trial successful" PR
//   licensing_deal    major upfront / exclusive worldwide license
//   buyout_definitive cash tender or definitive M&A agreement
//   trial_failed      red because the move can be -50%+ in a day; still
//                     critical to alert on (defensive)
//   8k_material       red 8-K only (item 1.01/2.01/1.03)
//   price_spike_up    red only (≥30% intraday + 3× volume) — safety net
//
// Excluded (orange or below): dfs, first_pour, trial_status_change,
//                             resource_update, pea, pfs, jv_strategic,
//                             step_out_drill, financing, macro_tide,
//                             near_90d_low, volume_spike, pre_catalyst_*
const GOUD_EVENT_TYPES = new Set<string>([
  "bonanza_au",
  "bonanza_ag",
  "bonanza_cu",
  "discovery_announcement",
  "permit",
  "takeover_bid",
  "fda_approval",
  "topline_positive",
  "phase_success",
  "breakthrough_designation",
  "licensing_deal",
  "buyout_definitive",
  "trial_failed",
  "8k_material",
  "price_spike_up",
]);

function inQuietHours(s: Settings): boolean {
  if (s.quiet_hours_start == null || s.quiet_hours_end == null) return false;
  const h = new Date().getUTCHours();
  const start = s.quiet_hours_start;
  const end = s.quiet_hours_end;
  if (start === end) return false;
  if (start < end) return h >= start && h < end;
  return h >= start || h < end; // wraps midnight
}

async function sendEmail(
  to: string,
  subject: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const key = Netlify.env.get("RESEND_API_KEY");
  const from =
    Netlify.env.get("RESEND_FROM") ?? "Biotech Signal <onboarding@resend.dev>";
  if (!key) return { ok: false, error: "RESEND_API_KEY missing" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `Resend ${res.status}: ${body}` };
  }
  return { ok: true };
}

async function sendNtfy(
  server: string,
  topic: string,
  title: string,
  body: string,
  severity: Severity,
  clickUrl: string | null
): Promise<{ ok: boolean; error?: string }> {
  const priority =
    severity === "red" ? "5" : severity === "orange" ? "4" : "3";
  const tags =
    severity === "red"
      ? "rotating_light"
      : severity === "orange"
      ? "warning"
      : "bell";
  const headers: Record<string, string> = {
    Title: encodeURIComponent(title),
    Priority: priority,
    Tags: tags,
  };
  if (clickUrl) headers.Click = clickUrl;
  const res = await fetch(`${server.replace(/\/$/, "")}/${topic}`, {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `ntfy ${res.status}: ${text}` };
  }
  return { ok: true };
}

// Mapt Yahoo-style suffixen naar Google Finance exchange codes — zelfde
// tabel als de UI in src/tickerLinks.ts, maar dupliceerd hier omdat
// netlify/functions geen src/ kan importeren.
const SUFFIX_TO_EXCHANGE: Record<string, string> = {
  V: "CVE",
  TO: "TSE",
  CN: "CNSX",
  AX: "ASX",
  L: "LON",
  HK: "HKG",
  T: "TYO",
  PA: "EPA",
  DE: "ETR",
  AS: "AMS",
  BR: "EBR",
  MI: "BIT",
  MC: "BME",
  ST: "STO",
  HE: "HEL",
  SW: "SWX",
};

function googleFinanceUrl(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  const dot = t.indexOf(".");
  if (dot === -1) return `https://www.google.com/finance/quote/${encodeURIComponent(t)}`;
  const base = t.slice(0, dot);
  const exch = SUFFIX_TO_EXCHANGE[t.slice(dot + 1)];
  if (!exch) return `https://www.google.com/finance/quote/${encodeURIComponent(t)}`;
  return `https://www.google.com/finance/quote/${encodeURIComponent(base)}:${exch}`;
}

interface ScoreSnapshot {
  action: string;
  final_score: number;
  expected_outcome: {
    catalystLabel?: string;
    peakReturnEst?: number;
    t90ReturnEst?: number;
    hitRateBaseline?: number;
    expectedPeakPrice?: number | null;
    expectedT90Price?: number | null;
    exitWindowDays?: number;
  } | null;
  components: {
    nearest_catalyst?: {
      type?: string;
      daysUntil?: number | null;
      date?: string | null;
    } | null;
  } | null;
  trade_setup: {
    entry?: number;
    target?: number;
    stop?: number;
    rr?: number;
  } | null;
}

const SEV_EMOJI: Record<Severity, string> = {
  red: "🔴",
  orange: "🟠",
  yellow: "🟡",
};

function pct(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "?";
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;
}

function fmtPrice(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "?";
  return `$${x.toFixed(x < 5 ? 3 : 2)}`;
}

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.slice(0, 10); // yyyy-mm-dd
}

interface AlertView {
  title: string;
  body: string;
}

function formatAlert(
  sig: { ticker: string; signal_type: string; severity: Severity; title: string; detail: string | null; detected_at: string },
  score: ScoreSnapshot | null,
  company: string | null
): AlertView {
  const sev = sig.severity;
  const emoji = SEV_EMOJI[sev];
  const exp = score?.expected_outcome ?? null;
  const cat = score?.components?.nearest_catalyst ?? null;
  const ts = score?.trade_setup ?? null;

  // --- Korte titel: het belangrijkste in één regel ---
  // Voorbeeld: "🔴 CDE STRONG_BUY · piek +150% · P3 readout 14d"
  const titleParts: string[] = [`${emoji} ${sig.ticker}`];
  if (score?.action) titleParts.push(score.action);
  if (exp?.peakReturnEst != null) {
    titleParts.push(`piek ${pct(exp.peakReturnEst)}`);
  }
  if (cat?.type && cat?.daysUntil != null) {
    const lbl = exp?.catalystLabel ?? cat.type;
    titleParts.push(`${lbl} ${cat.daysUntil}d`);
  } else if (!exp) {
    // Fallback naar oude titel als we geen verrijking hebben
    titleParts.push(sig.title);
  }
  const title = titleParts.join(" · ").slice(0, 120);

  // --- Body: leesbaar verhaal, niet cryptisch ---
  const lines: string[] = [];
  lines.push(`${sig.ticker}${company ? ` (${company})` : ""}`);
  if (score) {
    lines.push(
      `Actie: ${score.action} · score ${score.final_score.toFixed(2)}`
    );
  }
  lines.push("");

  if (exp && exp.peakReturnEst != null) {
    lines.push("📈 VERWACHTING (historische baseline)");
    const peakLine = `   Piek bij hit: ${pct(exp.peakReturnEst)}`;
    const peakPrice =
      ts?.entry != null && exp.expectedPeakPrice != null
        ? ` (${fmtPrice(ts.entry)} → ${fmtPrice(exp.expectedPeakPrice)})`
        : exp.expectedPeakPrice != null
        ? ` (→ ${fmtPrice(exp.expectedPeakPrice)})`
        : "";
    lines.push(peakLine + peakPrice);
    if (exp.t90ReturnEst != null) {
      const t90Price =
        exp.expectedT90Price != null ? ` (${fmtPrice(exp.expectedT90Price)})` : "";
      lines.push(`   T+90 mediaan: ${pct(exp.t90ReturnEst)}${t90Price}`);
    }
    if (exp.hitRateBaseline != null) {
      lines.push(
        `   Kans op hit: ${(exp.hitRateBaseline * 100).toFixed(0)}% (N≈20-50, wide CI)`
      );
    }
    lines.push("");
  }

  if (cat?.type) {
    lines.push("⏱ TIMING");
    const lbl = exp?.catalystLabel ?? cat.type;
    const days =
      cat.daysUntil != null ? `over ${cat.daysUntil}d` : "datum onbekend";
    const date = fmtDate(cat.date);
    lines.push(`   Catalyst: ${lbl} ${days}${date ? ` (~${date})` : ""}`);
    if (exp?.exitWindowDays != null) {
      lines.push(`   Exit window: tot dag ${exp.exitWindowDays} (catalyst + 30d cushion)`);
    }
    lines.push("");
  }

  if (ts?.entry != null && ts?.target != null && ts?.stop != null) {
    lines.push("🎯 TRADE SETUP");
    lines.push(`   Entry ${fmtPrice(ts.entry)} · Target ${fmtPrice(ts.target)} · Stop ${fmtPrice(ts.stop)}`);
    if (ts.rr != null) lines.push(`   R:R ${ts.rr.toFixed(1)}`);
    lines.push("");
  }

  lines.push(`— signaal: ${sig.signal_type} (${sev})`);
  if (sig.detail) lines.push(sig.detail);

  if (!exp && !cat) {
    // Geen score gevonden — minstens nog de originele titel meegeven
    lines.unshift(sig.title, "");
  }

  return { title, body: lines.join("\n") };
}

export default async () => {
  await logRun("dispatch-alerts", async () => {
    const supabase = getServiceClient();
    const { data: settings } = await supabase
      .from("signal_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (!settings)
      return { ok: false, message: "settings row missing" };
    const s = settings as Settings;

    if (inQuietHours(s)) {
      return { ok: true, message: "quiet hours; skipping" };
    }

    // Fetch unalerted signals from last 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: signals } = await supabase
      .from("signal_events")
      .select("*")
      .eq("alerted", false)
      .gte("detected_at", since)
      .order("detected_at", { ascending: true });

    if (!signals || signals.length === 0) {
      return { ok: true, message: "no new signals" };
    }

    // Verzamel unieke tickers — pre-fetch laatste score + company in één
    // ronde i.p.v. per-signal queries. Houdt loop snel onder Netlify's
    // 15min budget zelfs bij signal storms.
    const tickers = Array.from(new Set(signals.map((x) => x.ticker as string)));
    const scoreByTicker = new Map<string, ScoreSnapshot>();
    if (tickers.length) {
      const { data: scores } = await supabase
        .from("signal_scores")
        .select(
          "ticker, scan_date, action, final_score, expected_outcome, components, trade_setup"
        )
        .in("ticker", tickers)
        .order("scan_date", { ascending: false });
      for (const row of scores ?? []) {
        const t = row.ticker as string;
        if (!scoreByTicker.has(t)) scoreByTicker.set(t, row as ScoreSnapshot);
      }
    }
    const companyByTicker = new Map<string, string>();
    if (tickers.length) {
      const { data: tks } = await supabase
        .from("tickers")
        .select("ticker, company")
        .in("ticker", tickers);
      for (const row of tks ?? []) {
        if (row.company) companyByTicker.set(row.ticker as string, row.company as string);
      }
    }

    let sentEmail = 0;
    let sentNtfy = 0;
    let suppressed = 0;
    const errors: string[] = [];

    for (const sig of signals) {
      const sigSev = sig.severity as Severity;
      const sigRank = SEVERITY_RANK[sigSev];

      // Hard filter: events-only mode skips proximity ("over X dagen…"),
      // volume blips, near-90d-low and macro tide noise.
      if (s.alert_only_goud_events && !GOUD_EVENT_TYPES.has(sig.signal_type)) {
        await supabase
          .from("signal_events")
          .update({ alerted: true })
          .eq("id", sig.id);
        suppressed++;
        continue;
      }

      const emailOk =
        s.email && sigRank >= SEVERITY_RANK[s.alert_email_threshold];
      const ntfyOk =
        s.ntfy_topic && sigRank >= SEVERITY_RANK[s.alert_ntfy_threshold];

      const score = scoreByTicker.get(sig.ticker) ?? null;
      const company = companyByTicker.get(sig.ticker) ?? null;
      const view = formatAlert(sig, score, company);
      const clickUrl = googleFinanceUrl(sig.ticker);

      if (emailOk) {
        const r = await sendEmail(
          s.email!,
          `[${sigSev.toUpperCase()}] ${view.title}`,
          `${view.body}\n\nGrafiek: ${clickUrl}\nDetected: ${sig.detected_at}`
        );
        await supabase.from("signal_alerts_sent").insert({
          signal_id: sig.id,
          channel: "email",
          success: r.ok,
          error: r.error ?? null,
        });
        if (r.ok) sentEmail++;
        else errors.push(`email ${sig.id}: ${r.error}`);
      }

      if (ntfyOk) {
        const r = await sendNtfy(
          s.ntfy_server,
          s.ntfy_topic!,
          view.title,
          view.body,
          sigSev,
          clickUrl
        );
        await supabase.from("signal_alerts_sent").insert({
          signal_id: sig.id,
          channel: "ntfy",
          success: r.ok,
          error: r.error ?? null,
        });
        if (r.ok) sentNtfy++;
        else errors.push(`ntfy ${sig.id}: ${r.error}`);
      }

      await supabase
        .from("signal_events")
        .update({ alerted: true })
        .eq("id", sig.id);
    }

    return {
      ok: errors.length === 0,
      message:
        `email: ${sentEmail}, ntfy: ${sentNtfy}, suppressed: ${suppressed}` +
        (errors.length ? `; errors: ${errors.slice(0, 3).join("; ")}` : ""),
      metrics: {
        email: sentEmail,
        ntfy: sentNtfy,
        suppressed,
        errors: errors.length,
        total_signals: signals.length,
      },
    };
  });
};

export const config: Config = {
  schedule: "*/15 * * * *", // every 15 min
};
