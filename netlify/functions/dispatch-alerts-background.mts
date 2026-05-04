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
}

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
  severity: Severity
): Promise<{ ok: boolean; error?: string }> {
  const priority =
    severity === "red" ? "5" : severity === "orange" ? "4" : "3";
  const tags =
    severity === "red"
      ? "rotating_light"
      : severity === "orange"
      ? "warning"
      : "bell";
  const res = await fetch(`${server.replace(/\/$/, "")}/${topic}`, {
    method: "POST",
    headers: {
      Title: encodeURIComponent(title),
      Priority: priority,
      Tags: tags,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `ntfy ${res.status}: ${text}` };
  }
  return { ok: true };
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

    let sentEmail = 0;
    let sentNtfy = 0;
    const errors: string[] = [];

    for (const sig of signals) {
      const sigSev = sig.severity as Severity;
      const sigRank = SEVERITY_RANK[sigSev];

      const emailOk =
        s.email && sigRank >= SEVERITY_RANK[s.alert_email_threshold];
      const ntfyOk =
        s.ntfy_topic && sigRank >= SEVERITY_RANK[s.alert_ntfy_threshold];

      const subject = `[${sigSev.toUpperCase()}] ${sig.title}`;
      const body = `${sig.title}\n\n${sig.detail ?? ""}\n\nTicker: ${sig.ticker}\nType: ${sig.signal_type}\nDetected: ${sig.detected_at}`;

      if (emailOk) {
        const r = await sendEmail(s.email!, subject, body);
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
          sig.title,
          sig.detail ?? sig.title,
          sigSev
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
      message: `email: ${sentEmail}, ntfy: ${sentNtfy}` +
        (errors.length ? `; errors: ${errors.slice(0, 3).join("; ")}` : ""),
      metrics: {
        email: sentEmail,
        ntfy: sentNtfy,
        errors: errors.length,
        total_signals: signals.length,
      },
    };
  });
};

export const config: Config = {
  schedule: "*/15 * * * *", // every 15 min
};
