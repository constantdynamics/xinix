// Tijdelijke hulpfunctie voor het onderzoek naar SEC-berichten (15 november 2026).
//
// Vanuit een Claude-sessie is sec.gov niet bereikbaar, de SEC vraagt een afzender met contactgegevens, en de
// sleutel voor de Claude API mag alleen in Supabase staan. Deze functie draait daarom in Supabase en doet twee
// dingen, zonder iets in de database te schrijven:
//
// 1. Stukken bij de SEC ophalen, met de afzender die daar al staat voor poll-edgar-background (SEC_USER_AGENT):
//    GET  ?what=tickers                          de koppeling ticker → CIK
//    POST { ciks, since }                        per CIK de lijst van stukken (datum, soort, onderdelen, ontvangst)
//    POST { op: "lijst", ciks, since }           hetzelfde voor de stukken met tekst (8-K, 6-K, prospectus,
//                                                registratie), met het nummer waaronder ze zijn ingediend
//    POST { op: "docs", items: [{cik, acc, form}] }   de tekst van een stuk: bij een 8-K of 6-K het stuk zelf en
//                                                de eerste twee persberichten (bij een 8-K bijlage 99, bij een 6-K
//                                                de eerste twee bijlagen), bij een prospectus of registratie het
//                                                begin van het stuk. Ingekort; `cut` zegt of er meer was.
//    POST { op: "facts", ciks, concepts, since } cijfers uit de jaar- en kwartaalverslagen (XBRL), per begrip
//
// 2. Leesopdrachten doorgeven aan de Claude API (sleutel: ANTHROPIC_API_KEY in Supabase):
//    GET  ?op=status                             staan de sleutel en de afzender ingesteld? (alleen ja of nee)
//    POST { op: "count", items: [params] }       tokens tellen (gratis)
//    POST { op: "message", params }              één opdracht direct, om de vraagstelling te proberen
//    POST { op: "batch_create", requests }       opdrachten in bulk (de helft van de prijs)
//    GET  ?op=batch_get&id=…   ?op=batch_results&id=…   ?op=batch_list   ?op=batch_cancel&id=…
//    Begrensd: alleen de drie modellen hieronder, geen hulpmiddelen (dus geen zoekkosten), hoogstens 8.000
//    tokens antwoord per opdracht, hoogstens 500 opdrachten per keer en MAX_TOTAAL opdrachten in totaal.
//
// Uitrollen onder de naam xinix-ss-sec-onderzoek met verify_jwt uit, en SLEUTEL hieronder vervangen door een
// eigen willekeurige waarde (niet in de repository zetten). Na het onderzoek vervangen door een lege functie.
// Tempo bij de SEC: hoogstens ±7 verzoeken per seconde (de SEC staat 10 toe).
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";

const SLEUTEL = "ZET-HIER-EEN-EIGEN-SLEUTEL";
// Dezelfde afzender als poll-edgar-background: de waarde uit Supabase als die er staat, anders de standaardwaarde
// van die functie. (Op 15 november 2026 stond SEC_USER_AGENT niet ingesteld; de SEC vraagt een echt contactadres.)
const UA = Deno.env.get("SEC_USER_AGENT") ?? "SignalEdgarBot contact@example.com";
const KEEP = /^(S-1|S-3|S-11|F-1|F-3|F-10|424B|EFFECT|POS AM|RW|8-K|6-K|10-Q|10-K|20-F|40-F|NT 10|NT 20|25|15-|SC 13|SCHEDULE 13|D$|D\/A|4$|4\/A|144|DEF 14A|PRE 14A|S-8|FWP)/;
const TEKST = /^(8-K|6-K|424B|S-1|S-3|F-1|F-3)/;
const MODELLEN = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const VELDEN = ["model", "max_tokens", "system", "messages", "output_config", "thinking"];
const MAX_TOTAAL = 30000;                 // opdrachten in bulk, opgeteld over alle keren (noodrem; het budget bewaakt het script)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function sec(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  await sleep(140);
  return res;
}

// ── 1. SEC ───────────────────────────────────────────────────────────────────
type Recent = { form: string[]; filingDate: string[]; items?: string[]; acceptanceDateTime?: string[]; accessionNumber?: string[]; primaryDocument?: string[]; size?: number[] };
function take(r: Recent, since: string, out: unknown[][], tekst: boolean): string {
  let oldest = "9999";
  for (let i = 0; i < r.form.length; i++) {
    const d = r.filingDate[i];
    if (d < oldest) oldest = d;
    if (d < since || !(tekst ? TEKST : KEEP).test(r.form[i])) continue;
    const row: unknown[] = [d, r.form[i], r.items?.[i] ?? "", (r.acceptanceDateTime?.[i] ?? "").slice(0, 16)];
    if (tekst) row.push(r.accessionNumber?.[i] ?? "", r.primaryDocument?.[i] ?? "", r.size?.[i] ?? 0);
    out.push(row);
  }
  return oldest;
}

async function lists(ciks: number[], since: string, tekst: boolean) {
  const out: Record<string, unknown> = {};
  for (const cik of ciks.slice(0, 40)) {
    try {
      const res = await sec(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`);
      if (!res.ok) { out[cik] = { error: `SEC ${res.status}` }; continue; }
      // deno-lint-ignore no-explicit-any
      const j = (await res.json()) as any;
      const rows: unknown[][] = [];
      let oldest = take(j.filings.recent as Recent, since, rows, tekst);
      // Oudere stukken staan in aparte bestanden; alleen ophalen als de recente lijst niet ver genoeg teruggaat.
      let extra = 0;
      for (const f of (j.filings.files ?? []) as Array<{ name: string; filingFrom: string; filingTo: string }>) {
        if (oldest <= since || extra >= 4) break;
        if (f.filingTo < since) continue;
        const r2 = await sec(`https://data.sec.gov/submissions/${f.name}`);
        if (!r2.ok) break;
        oldest = take((await r2.json()) as Recent, since, rows, tekst);
        extra++;
      }
      out[cik] = tekst
        ? { oldest, extra, f: rows }
        : { name: j.name, sic: j.sic, sicd: j.sicDescription, cat: j.category, tickers: j.tickers, ex: j.exchanges, inc: j.stateOfIncorporation, fye: j.fiscalYearEnd, oldest, extra, f: rows };
    } catch (e) { out[cik] = { error: String(e).slice(0, 150) }; }
  }
  return out;
}

async function readCapped(res: Response, cap: number): Promise<{ text: string; complete: boolean }> {
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0, complete = true;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); n += value.length;
    if (n >= cap) { complete = false; await reader.cancel(); break; }
  }
  const buf = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(buf), complete };
}

const NAMED: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: "-", mdash: "-", bull: "•", reg: "®", trade: "™", copy: "©", sect: "§", middot: "·", hellip: "…", euro: "€", pound: "£", yen: "¥", cent: "¢", frac12: "½", frac14: "¼", frac34: "¾", deg: "°", times: "×" };
function htmlToText(html: string): string {
  let s = html.replace(/<(script|style|head|ix:header)\b[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|table|center|title)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<\/t[dh]>/gi, "\t");
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/&#(\d+);/g, (_, d) => { const c = Number(d); return c === 160 ? " " : c > 31 && c < 0x10ffff ? String.fromCodePoint(c) : " "; })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { const c = parseInt(h, 16); return c === 160 ? " " : c > 31 && c < 0x10ffff ? String.fromCodePoint(c) : " "; })
    .replace(/&([a-z0-9]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
  s = s.replace(/[     ​]+/g, " ").replace(/( ?\t ?)+/g, " | ").replace(/ ?\n ?/g, "\n").replace(/(\| )+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

const BINAIR = /\.(jpg|jpeg|gif|png|pdf|zip|xls|xlsx|xml|xsd|js|css|json)$/i;
async function docs(items: Array<{ cik: number; acc: string; form: string }>) {
  const out: unknown[] = [];
  for (const it of items.slice(0, 10)) {
    try {
      const nieuws = /^(8-K|6-K)/.test(it.form);
      const res = await sec(`https://www.sec.gov/Archives/edgar/data/${it.cik}/${it.acc.replace(/-/g, "")}/${it.acc}.txt`);
      if (!res.ok) { out.push({ cik: it.cik, acc: it.acc, error: `SEC ${res.status}` }); await res.body?.cancel(); continue; }
      const { text: raw, complete } = await readCapped(res, nieuws ? 1_600_000 : 900_000);
      const parts = raw.split("<DOCUMENT>");
      const found: Array<{ type: string; file: string; chars: number; cut: boolean; text: string }> = [];
      let ex = 0;
      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        const type = (/<TYPE>([^\n\r]*)/.exec(p)?.[1] ?? "").trim();
        const file = (/<FILENAME>([^\n\r]*)/.exec(p)?.[1] ?? "").trim();
        const hoofd = i === 1;
        // Bij een 8-K is het persbericht bijlage 99. Buitenlandse bedrijven (6-K) nummeren vrijer (99.1, 15.1, 1): daar
        // tellen de eerste twee bijlagen, wat hun nummer ook is.
        const bijlage = /^6-K/.test(it.form) ? /^EX-/i.test(type) && !/^EX-10[01]/i.test(type) : /^EX-99/i.test(type);
        if (!hoofd && !(nieuws && bijlage && ex < 2)) continue;
        if (BINAIR.test(file)) continue;
        const a = p.indexOf("<TEXT>");
        if (a < 0) continue;
        const b = p.indexOf("</TEXT>", a);
        const body = p.slice(a + 6, b < 0 ? undefined : b);
        if (/^\s*(begin \d{3} |<PDF>)/.test(body.slice(0, 200))) continue;
        const txt = htmlToText(body);
        const max = hoofd ? (nieuws ? 8000 : 28000) : ex === 0 ? 14000 : 6000;
        if (!hoofd) ex++;
        if (txt.length < 40) continue;
        found.push({ type, file, chars: txt.length, cut: txt.length > max || b < 0, text: txt.slice(0, max) });
      }
      out.push({ cik: it.cik, acc: it.acc, form: it.form, complete, docs: found });
    } catch (e) { out.push({ cik: it.cik, acc: it.acc, error: String(e).slice(0, 150) }); }
  }
  return out;
}

async function facts(ciks: number[], concepts: string[], since: string) {
  const out: Record<string, Record<string, unknown>> = {};
  for (const cik of ciks.slice(0, 12)) {
    out[cik] = {};
    for (const c of concepts.slice(0, 8)) {
      try {
        const res = await sec(`https://data.sec.gov/api/xbrl/companyconcept/CIK${String(cik).padStart(10, "0")}/${c}.json`);
        if (res.status === 404) { out[cik][c] = null; await res.body?.cancel(); continue; }
        if (!res.ok) { out[cik][c] = { error: `SEC ${res.status}` }; await res.body?.cancel(); continue; }
        // deno-lint-ignore no-explicit-any
        const j = (await res.json()) as any;
        const units: Record<string, unknown[][]> = {};
        for (const [u, rows] of Object.entries(j.units ?? {})) {
          // deno-lint-ignore no-explicit-any
          units[u] = (rows as any[]).filter((r) => (r.filed ?? "") >= since).map((r) => [r.start ?? null, r.end, r.val, r.fy, r.fp, r.form, r.filed]);
        }
        out[cik][c] = units;
      } catch (e) { out[cik][c] = { error: String(e).slice(0, 120) }; }
    }
  }
  return out;
}

// ── 2. Claude API ────────────────────────────────────────────────────────────
function client(): Anthropic {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY ontbreekt");
  return new Anthropic({ apiKey: key });
}
// Alleen de velden en modellen die het onderzoek nodig heeft; geen hulpmiddelen, dus ook geen zoekkosten.
function check(params: Record<string, unknown>): Anthropic.MessageCreateParamsNonStreaming {
  for (const k of Object.keys(params)) if (!VELDEN.includes(k)) throw new Error(`veld niet toegestaan: ${k}`);
  if (!MODELLEN.includes(String(params.model))) throw new Error(`model niet toegestaan: ${params.model}`);
  const mt = Number(params.max_tokens);
  if (!(mt >= 1 && mt <= 8000)) throw new Error("max_tokens moet tussen 1 en 8000 liggen");
  return params as unknown as Anthropic.MessageCreateParamsNonStreaming;
}
function apiError(e: unknown): Response {
  if (e instanceof Anthropic.AuthenticationError) return json({ error: "sleutel geweigerd door de Claude API", status: e.status }, 502);
  if (e instanceof Anthropic.RateLimitError) return json({ error: "tempo- of tegoedlimiet", status: e.status, message: e.message.slice(0, 300) }, 429);
  if (e instanceof Anthropic.BadRequestError) return json({ error: "verzoek afgewezen", status: e.status, message: e.message.slice(0, 600) }, 400);
  if (e instanceof Anthropic.APIError) return json({ error: "fout bij de Claude API", status: e.status, message: e.message.slice(0, 300) }, 502);
  return json({ error: String(e).slice(0, 300) }, 500);
}
const text = (m: Anthropic.Message) => m.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");

Deno.serve(async (req) => {
  if (req.headers.get("x-onderzoek") !== SLEUTEL || SLEUTEL.startsWith("ZET-")) return json({ error: "geen toegang" }, 401);
  const url = new URL(req.url);
  const q = url.searchParams;
  try {
    if (req.method === "GET") {
      if (q.get("what") === "tickers") {
        const res = await sec("https://www.sec.gov/files/company_tickers.json");
        if (!res.ok) return json({ error: `SEC ${res.status}` }, 502);
        return new Response(await res.text(), { headers: { "content-type": "application/json" } });
      }
      const op = q.get("op");
      if (op === "status") return json({ anthropic: !!Deno.env.get("ANTHROPIC_API_KEY"), sec_agent: !!Deno.env.get("SEC_USER_AGENT") });
      try {
        const c = client();
        const id = q.get("id") ?? "";
        if (op === "batch_get") return json(await c.messages.batches.retrieve(id));
        if (op === "batch_cancel") return json(await c.messages.batches.cancel(id));
        if (op === "batch_list") {
          const rows: unknown[] = [];
          for await (const b of c.messages.batches.list({ limit: 100 })) {
            rows.push({ id: b.id, status: b.processing_status, counts: b.request_counts, created_at: b.created_at, ended_at: b.ended_at });
            if (rows.length >= 400) break;
          }
          return json(rows);
        }
        if (op === "batch_results") {
          const lines: string[] = [];
          for await (const r of await c.messages.batches.results(id)) {
            if (r.result.type === "succeeded") {
              const m = r.result.message;
              lines.push(JSON.stringify({ id: r.custom_id, ok: true, text: text(m), stop: m.stop_reason, model: m.model, usage: m.usage }));
            } else {
              lines.push(JSON.stringify({ id: r.custom_id, ok: false, type: r.result.type, error: r.result.type === "errored" ? r.result.error : null }));
            }
          }
          return new Response(lines.join("\n"), { headers: { "content-type": "application/x-ndjson" } });
        }
      } catch (e) { return apiError(e); }
      return json({ error: "onbekende opdracht" }, 400);
    }
    // deno-lint-ignore no-explicit-any
    const body = (await req.json()) as any;
    const since = body.since ?? "2018-06-01";
    if (!body.op) return json(await lists(body.ciks ?? [], since, false));
    if (body.op === "lijst") return json(await lists(body.ciks ?? [], since, true));
    if (body.op === "docs") return json(await docs(body.items ?? []));
    if (body.op === "facts") return json(await facts(body.ciks ?? [], body.concepts ?? [], since));
    try {
      const c = client();
      if (body.op === "count") {
        const out: unknown[] = [];
        for (const p of (body.items ?? []).slice(0, 25)) {
          const { max_tokens: _mt, ...rest } = check({ max_tokens: 1, ...p }) as unknown as Record<string, unknown>;
          out.push((await c.messages.countTokens(rest as unknown as Anthropic.MessageCountTokensParams)).input_tokens);
        }
        return json(out);
      }
      if (body.op === "message") {
        // Direct, tegen de gewone prijs. Weigert het model op veiligheidsgronden, dan probeert de API het zelf op een
        // ander model (fallbacks); in bulk kan dat niet en komt een weigering als zodanig terug.
        const m = await c.beta.messages.create({ ...(check(body.params) as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming), betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
        const t = m.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
        return json({ text: t, stop: m.stop_reason, model: m.model, usage: m.usage });
      }
      if (body.op === "batch_create") {
        const reqs = (body.requests ?? []) as Array<{ custom_id: string; params: Record<string, unknown> }>;
        if (!reqs.length || reqs.length > 500) return json({ error: "1 tot 500 opdrachten per keer" }, 400);
        let total = 0;
        for await (const b of c.messages.batches.list({ limit: 100 })) {
          const n = b.request_counts;
          total += n.processing + n.succeeded + n.errored + n.canceled + n.expired;
          if (total > MAX_TOTAAL) break;
        }
        if (total + reqs.length > MAX_TOTAAL) return json({ error: `noodrem: al ${total} opdrachten verstuurd, plafond ${MAX_TOTAAL}` }, 429);
        const b = await c.messages.batches.create({ requests: reqs.map((r) => ({ custom_id: String(r.custom_id), params: check(r.params) })) });
        return json({ id: b.id, status: b.processing_status, counts: b.request_counts, eerder: total });
      }
    } catch (e) { return apiError(e); }
    return json({ error: "onbekende opdracht" }, 400);
  } catch (e) {
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
