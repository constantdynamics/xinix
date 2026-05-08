import { getServiceClient } from "../_shared/supabase.ts";
import { insertSignal } from "../_shared/signals.ts";
import { runBackground } from "../_shared/runner.ts";

const UA =
  Deno.env.get("SEC_USER_AGENT") ?? "BiotechSignalBot contact@example.com";

interface TickerCikMap {
  [k: string]: { cik_str: number; ticker: string; title: string };
}

let cikCache: Map<string, string> | null = null;

async function getCikMap(): Promise<Map<string, string>> {
  if (cikCache) return cikCache;
  const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`SEC tickers HTTP ${res.status}`);
  const json = (await res.json()) as TickerCikMap;
  const map = new Map<string, string>();
  for (const v of Object.values(json)) {
    map.set(v.ticker.toUpperCase(), String(v.cik_str).padStart(10, "0"));
  }
  cikCache = map;
  return map;
}

interface EdgarSubmissions {
  filings: {
    recent: {
      accessionNumber: string[];
      form: string[];
      filingDate: string[];
      primaryDocument: string[];
      items?: string[];
    };
  };
}

async function fetchSubmissions(cik: string): Promise<EdgarSubmissions> {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`EDGAR ${cik} HTTP ${res.status}`);
  return (await res.json()) as EdgarSubmissions;
}

function classify8KItems(items: string): {
  severity: "yellow" | "orange" | "red";
  label: string;
} | null {
  const list = items
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.some((i) => ["1.01", "2.01"].includes(i))) {
    return { severity: "red", label: "Material agreement / acquisition" };
  }
  if (list.some((i) => ["7.01", "8.01"].includes(i))) {
    return { severity: "orange", label: "Reg FD / other material event" };
  }
  if (list.some((i) => ["1.03", "3.01"].includes(i))) {
    return { severity: "red", label: "Bankruptcy / delisting" };
  }
  if (list.some((i) => ["3.02"].includes(i))) {
    return { severity: "yellow", label: "Capital raise" };
  }
  if (list.some((i) => ["3.03", "5.02"].includes(i))) {
    return { severity: "yellow", label: "Governance / mgmt change" };
  }
  return null;
}

Deno.serve(
  runBackground("poll-edgar", async () => {
    const supabase = getServiceClient();
    const { data: tickers } = await supabase
      .from("signal_tickers")
      .select("ticker")
      .eq("active", true);
    if (!tickers) return { ok: true, message: "no tickers" };

    const cikMap = await getCikMap();
    let filingsTracked = 0;
    let signalsInserted = 0;
    const errors: string[] = [];

    for (const { ticker } of tickers) {
      try {
        const cik = cikMap.get(ticker.toUpperCase());
        if (!cik) continue;
        const subs = await fetchSubmissions(cik);
        const recent = subs.filings.recent;
        if (!recent) continue;

        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        for (let i = 0; i < recent.accessionNumber.length; i++) {
          const form = recent.form[i];
          if (!["8-K", "8-K/A"].includes(form)) continue;
          const filingDate = new Date(recent.filingDate[i]);
          if (filingDate < cutoff) continue;

          const accession = recent.accessionNumber[i];
          const items = recent.items?.[i] ?? "";
          const accNoDash = accession.replace(/-/g, "");
          const primaryDoc = recent.primaryDocument[i];
          const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(
            cik,
            10
          )}/${accNoDash}/${primaryDoc}`;

          const { error: insertErr } = await supabase
            .from("signal_filings")
            .insert({
              ticker,
              accession,
              form,
              filed_at: filingDate.toISOString(),
              primary_doc_url: url,
              items,
            });

          if (insertErr) {
            if (!String(insertErr.message).includes("duplicate")) {
              errors.push(`${ticker} insert: ${insertErr.message}`);
            }
            continue;
          }
          filingsTracked++;

          const cls = classify8KItems(items);
          if (cls) {
            const sigId = await insertSignal(supabase, {
              ticker,
              signal_type: "8k_material",
              severity: cls.severity,
              title: `${ticker} 8-K: ${cls.label}`,
              detail: `Items ${items}. ${url}`,
              payload: { accession, items, url },
              expires_at: new Date(
                Date.now() + 14 * 24 * 60 * 60 * 1000
              ).toISOString(),
              dedup_key: `8k:${accession}`,
            });
            if (sigId) signalsInserted++;
          }
        }
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${ticker}: ${msg}`);
      }
    }

    return {
      ok: errors.length === 0,
      message:
        `${filingsTracked} new filings, ${signalsInserted} signals` +
        (errors.length
          ? `; errors: ${errors.slice(0, 3).join("; ")}`
          : ""),
      metrics: { filings: filingsTracked, signals: signalsInserted },
    };
  })
);
