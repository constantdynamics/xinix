// xinix-knowledge-reminder — Stuurt een herinnering (ntfy + email) om de
// maandelijkse kennisexport handmatig te controleren of te downloaden.
// Getriggerd door pg_cron op de 25e van elke maand.

const NTFY_TOPIC   = Deno.env.get("NTFY_TOPIC")     ?? "";
const NTFY_BASE    = "https://ntfy.sh";
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM  = "Xinix <noreply@constantdynamics.nl>";
const NOTIFY_EMAIL = Deno.env.get("NOTIFY_EMAIL")   ?? "";
const DASHBOARD_URL = "https://constantdynamics.github.io/xinix";

Deno.serve(async () => {
  const now = new Date();
  const monthName = now.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });

  const ntfyMsg = `De automatische export voor ${monthName} staat gepland op de 1e van volgende maand. Klik om nu al een handmatige export te doen vanuit het dashboard.`;

  // ntfy
  if (NTFY_TOPIC) {
    await fetch(`${NTFY_BASE}/${NTFY_TOPIC}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: NTFY_TOPIC,
        title: `⏰ Herinnering: Xinix kennisexport — ${monthName}`,
        message: ntfyMsg,
        priority: 2,
        tags: ["calendar"],
        click: DASHBOARD_URL,
        actions: [{ action: "view", label: "Open dashboard", url: DASHBOARD_URL, clear: false }],
      }),
    }).catch(() => {});
  }

  // email
  if (RESEND_KEY && NOTIFY_EMAIL) {
    const text = [
      `Herinnering: Xinix maandelijkse kennisexport`,
      ``,
      `De automatische export voor ${monthName} staat gepland op de 1e van volgende maand.`,
      ``,
      `Je kunt ook nu al een handmatige export uitvoeren via:`,
      `${DASHBOARD_URL}`,
      `→ 100 Strategieën → Evolutie → Kennis-export → Export nu`,
      ``,
      `De export bevat:`,
      `- Alle 100 strategieën met config + performance`,
      `- Alle gesloten posities (uitgesplitst per signaal + sector)`,
      `- Volledige watchlist met buy-limieten, medailles en notes`,
      `- Configuratie-inzichten (welke parameters presteren het best)`,
      `- Automatisch gegenereerde markdown-samenvatting`,
    ].join("\n");

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM, to: NOTIFY_EMAIL, subject: `⏰ Xinix kennisexport herinnering — ${monthName}`, text }),
    }).catch(() => {});
  }

  // Log
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  const u = Deno.env.get("SUPABASE_URL"); const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (u && k) {
    const db = createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
    await db.from("signal_runs").insert({ job: "xinix-knowledge-reminder", ok: true, message: `Herinnering verstuurd voor ${monthName}` });
  }

  return new Response(JSON.stringify({ ok: true, sent_for: monthName }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
