// Tijdelijke hulpfunctie voor het onderzoek naar SEC-berichten (15 november 2026).
//
// Vanuit een Claude-sessie is sec.gov niet bereikbaar, en de SEC vraagt een afzender met contactgegevens.
// Deze functie draait in Supabase, gebruikt de afzender die daar al staat voor poll-edgar-background
// (SEC_USER_AGENT) en geeft per aandeel de lijst van ingediende stukken terug: datum, soort, onderdelen
// (bij een 8-K) en het moment van ontvangst. Er wordt niets in de database geschreven.
//
//   GET  ?what=tickers            de koppeling ticker → CIK van de SEC
//   POST { ciks: [..], since }    per CIK de stukken vanaf `since` (JJJJ-MM-DD), hoogstens 40 per verzoek
//
// Uitrollen onder de naam xinix-ss-sec-onderzoek met verify_jwt uit, en SLEUTEL hieronder vervangen door
// een eigen willekeurige waarde (niet in de repository zetten). Na het onderzoek vervangen door een lege
// functie. Tempo: hoogstens ±7 verzoeken per seconde (de SEC staat 10 toe).
const SLEUTEL = "ZET-HIER-EEN-EIGEN-SLEUTEL";
// Dezelfde afzender als poll-edgar-background: de waarde uit Supabase als die er staat, anders de standaardwaarde
// van die functie. (Op 15 november 2026 stond SEC_USER_AGENT niet ingesteld; de SEC vraagt een echt contactadres.)
const UA = Deno.env.get("SEC_USER_AGENT") ?? "SignalEdgarBot contact@example.com";
const KEEP = /^(S-1|S-3|S-11|F-1|F-3|F-10|424B|EFFECT|POS AM|RW|8-K|6-K|10-Q|10-K|20-F|40-F|NT 10|NT 20|25|15-|SC 13|SCHEDULE 13|D$|D\/A|4$|4\/A|144|DEF 14A|PRE 14A|S-8|FWP)/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function sec(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  await sleep(140);
  return res;
}
type Recent = { form: string[]; filingDate: string[]; items?: string[]; acceptanceDateTime?: string[] };
function take(r: Recent, since: string, out: unknown[][]): string {
  let oldest = "9999";
  for (let i = 0; i < r.form.length; i++) {
    const d = r.filingDate[i];
    if (d < oldest) oldest = d;
    if (d < since || !KEEP.test(r.form[i])) continue;
    out.push([d, r.form[i], r.items?.[i] ?? "", (r.acceptanceDateTime?.[i] ?? "").slice(0, 16)]);
  }
  return oldest;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-onderzoek") !== SLEUTEL || SLEUTEL.startsWith("ZET-")) return json({ error: "geen toegang" }, 401);
  if (!UA) return json({ error: "SEC_USER_AGENT ontbreekt" }, 500);
  const url = new URL(req.url);
  try {
    if (url.searchParams.get("what") === "tickers") {
      const res = await sec("https://www.sec.gov/files/company_tickers.json");
      if (!res.ok) return json({ error: `SEC ${res.status}` }, 502);
      return new Response(await res.text(), { headers: { "content-type": "application/json" } });
    }
    const body = (await req.json()) as { ciks: number[]; since?: string };
    const since = body.since ?? "2018-06-01";
    const out: Record<string, unknown> = {};
    for (const cik of (body.ciks ?? []).slice(0, 40)) {
      try {
        const res = await sec(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`);
        if (!res.ok) { out[cik] = { error: `SEC ${res.status}` }; continue; }
        // deno-lint-ignore no-explicit-any
        const j = (await res.json()) as any;
        const rows: unknown[][] = [];
        let oldest = take(j.filings.recent as Recent, since, rows);
        // Oudere stukken staan in aparte bestanden; alleen ophalen als de recente lijst niet ver genoeg teruggaat.
        let extra = 0;
        for (const f of (j.filings.files ?? []) as Array<{ name: string; filingFrom: string; filingTo: string }>) {
          if (oldest <= since || extra >= 4) break;
          if (f.filingTo < since) continue;
          const r2 = await sec(`https://data.sec.gov/submissions/${f.name}`);
          if (!r2.ok) break;
          oldest = take((await r2.json()) as Recent, since, rows);
          extra++;
        }
        out[cik] = { name: j.name, sic: j.sic, sicd: j.sicDescription, cat: j.category, tickers: j.tickers, ex: j.exchanges, inc: j.stateOfIncorporation, fye: j.fiscalYearEnd, oldest, extra, f: rows };
      } catch (e) { out[cik] = { error: String(e).slice(0, 150) }; }
    }
    return json(out);
  } catch (e) {
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
