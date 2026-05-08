import { getServiceClient } from "../_shared/supabase.ts";
import { SEVERITY_RANK, type Severity } from "../_shared/signals.ts";
import { runBackground } from "../_shared/runner.ts";

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
  return h >= start || h < end;
}

async function sendEmail(
  to: string,
  subject: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from =
    Deno.env.get("RESEND_FROM") ?? "Xinix Signal <onboarding@resend.dev>";
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
  if (dot === -1)
    return `https://www.google.com/finance/quote/${encodeURIComponent(t)}`;
  const base = t.slice(0, dot);
  const exch = SUFFIX_TO_EXCHANGE[t.slice(dot + 1)];
  if (!exch)
    return `https://www.google.com/finance/quote/${encodeURIComponent(t)}`;
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
  return iso.slice(0, 10);
}

interface AlertView {
  title: string;
  body: string;
}

function formatAlert(
  sig: {
    ticker: string;
    signal_type: string;
    severity: Severity;
    title: string;
    detail: string | null;
    detected_at: string;
  },
  score: ScoreSnapshot | null,
  company: string | null
): AlertView {
  const sev = sig.severity;
  const emoji = SEV_EMOJI[sev];
  const exp = score?.expected_outcome ?? null;
  const cat = score?.components?.nearest_catalyst ?? null;
  const ts = score?.trade_setup ?? null;

  const titleParts: string[] = [`${emoji} ${sig.ticker}`];
  if (score?.action) titleParts.push(score.action);
  if (exp?.peakReturnEst != null) {
    titleParts.push(`piek ${pct(exp.peakReturnEst)}`);
  }
  if (cat?.type && cat?.daysUntil != null) {
    const lbl = exp?.catalystLabel ?? cat.type;
    titleParts.push(`${lbl} ${cat.daysUntil}d`);
  } else if (!exp) {
    titleParts.push(sig.title);
  }
  const title = titleParts.join(" · ").slice(0, 120);

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
        exp.expectedT90Price != null
          ? ` (${fmtPrice(exp.expectedT90Price)})`
          : "";
      lines.push(`   T+90 mediaan: ${pct(exp.t90ReturnEst)}${t90Price}`);
    }
    if (exp.hitRateBaseline != null) {
      lines.push(
        `   Kans op hit: ${(exp.hitRateBaseline * 100).toFixed(
          0
        )}% (N≈20-50, wide CI)`
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
      lines.push(
        `   Exit window: tot dag ${exp.exitWindowDays} (catalyst + 30d cushion)`
      );
    }
    lines.push("");
  }

  if (ts?.entry != null && ts?.target != null && ts?.stop != null) {
    lines.push("🎯 TRADE SETUP");
    lines.push(
      `   Entry ${fmtPrice(ts.entry)} · Target ${fmtPrice(
        ts.target
      )} · Stop ${fmtPrice(ts.stop)}`
    );
    if (ts.rr != null) lines.push(`   R:R ${ts.rr.toFixed(1)}`);
    lines.push("");
  }

  lines.push(`— signaal: ${sig.signal_type} (${sev})`);
  if (sig.detail) lines.push(sig.detail);

  if (!exp && !cat) {
    lines.unshift(sig.title, "");
  }

  return { title, body: lines.join("\n") };
}

Deno.serve(
  runBackground("dispatch-alerts", async () => {
    const supabase = getServiceClient();
    const { data: settings } = await supabase
      .from("signal_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (!settings) return { ok: false, message: "settings row missing" };
    const s = settings as Settings;

    if (inQuietHours(s)) {
      return { ok: true, message: "quiet hours; skipping" };
    }

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

    const tickers = Array.from(
      new Set(signals.map((x) => x.ticker as string))
    );
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
        .from("signal_tickers")
        .select("ticker, company")
        .in("ticker", tickers);
      for (const row of tks ?? []) {
        if (row.company)
          companyByTicker.set(row.ticker as string, row.company as string);
      }
    }

    let sentEmail = 0;
    let sentNtfy = 0;
    let suppressed = 0;
    const errors: string[] = [];

    for (const sig of signals) {
      const sigSev = sig.severity as Severity;
      const sigRank = SEVERITY_RANK[sigSev];

      if (
        s.alert_only_goud_events &&
        !GOUD_EVENT_TYPES.has(sig.signal_type)
      ) {
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
  })
);
