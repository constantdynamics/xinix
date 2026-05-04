import type { Config } from "@netlify/functions";
import { getServiceClient, logRun } from "./_lib/supabase.mts";
import { insertSignal } from "./_lib/signals.mts";

// Yahoo Finance company news search — free, no auth.
// Per ticker we pull ~20 recent news items and run regex over titles+summaries
// to detect bonanza assays, resource updates, PEA/PFS/DFS, permits, JVs,
// financings, first pour. Also adds discovered upcoming catalysts to signal_catalysts.

interface YahooNewsItem {
  uuid?: string;
  title?: string;
  link?: string;
  publisher?: string;
  providerPublishTime?: number; // unix seconds
  summary?: string;
  type?: string;
}

async function searchNews(query: string): Promise<YahooNewsItem[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
    query
  )}&quotesCount=0&newsCount=20&lang=en-US`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; SignalMiningBot/1.0; +https://github.com)",
    },
  });
  if (!res.ok) throw new Error(`Yahoo news ${query} HTTP ${res.status}`);
  const json = (await res.json()) as { news?: YahooNewsItem[] };
  return json.news ?? [];
}

interface MiningPattern {
  type: string;
  severity: "yellow" | "orange" | "red";
  re: RegExp;
  label: string;
  catalyst?: string;
}

// Bonanza-grade thresholds align with framework cluster 1.1.
// Capture group 1 must be the numeric value for grade-based patterns.
const BONANZA: MiningPattern[] = [
  {
    type: "bonanza_au",
    severity: "red",
    re: /(\d{1,4}(?:[.,]\d+)?)\s*(?:g\s*\/\s*t|gpt|grams?\s*per\s*tonne)\s*(?:au|gold)/i,
    label: "high-grade Au intercept",
  },
  {
    type: "bonanza_ag",
    severity: "red",
    re: /(\d{2,5}(?:[.,]\d+)?)\s*(?:g\s*\/\s*t|gpt|grams?\s*per\s*tonne)\s*(?:ag|silver)/i,
    label: "high-grade Ag intercept",
  },
  {
    type: "bonanza_cu",
    severity: "red",
    re: /(\d{1,3}(?:[.,]\d+)?)\s*%\s*(?:cu|copper)/i,
    label: "high-grade Cu intercept",
  },
];

function bonanzaThresholdMet(type: string, value: number): boolean {
  if (type === "bonanza_au") return value >= 30; // ≥30 g/t Au
  if (type === "bonanza_ag") return value >= 1000; // ≥1000 g/t Ag
  if (type === "bonanza_cu") return value >= 5; // ≥5% Cu
  return false;
}

const NEWS_PATTERNS: MiningPattern[] = [
  {
    type: "resource_update",
    severity: "orange",
    re: /(?:initial\s+)?(?:mineral\s+)?resource\s+estimate|maiden\s+resource|updated?\s+resource/i,
    label: "Resource estimate update",
    catalyst: "resource_update",
  },
  {
    type: "pea",
    severity: "orange",
    re: /preliminary\s+economic\s+assessment|\bpea\b/i,
    label: "PEA published",
    catalyst: "PEA",
  },
  {
    type: "pfs",
    severity: "orange",
    re: /pre[\s-]?feasibility\s+study|\bpfs\b/i,
    label: "PFS published",
    catalyst: "PFS",
  },
  {
    type: "dfs",
    severity: "red",
    re: /(?:definitive|bankable)\s+feasibility|\bdfs\b/i,
    label: "DFS published",
    catalyst: "DFS",
  },
  {
    type: "permit",
    severity: "red",
    re: /(?:mining|construction|environmental)\s+permit\s+(?:granted|approved|received)|\beia\s+approved/i,
    label: "Permit granted",
    catalyst: "permit",
  },
  {
    type: "jv_strategic",
    severity: "orange",
    re: /(?:strategic\s+)?(?:joint\s+venture|earn[-\s]?in|cornerstone\s+investment)/i,
    label: "JV / strategic investment",
  },
  {
    type: "first_pour",
    severity: "red",
    re: /first\s+gold\s+pour|commercial\s+production\s+(?:declared|achieved|announced)/i,
    label: "First pour / commercial production",
  },
  {
    type: "takeover_bid",
    severity: "red",
    re: /(?:takeover|acquisition|all[-\s]?cash)\s+(?:offer|bid|proposal)|to\s+be\s+acquired/i,
    label: "Takeover bid",
  },
  {
    type: "financing",
    severity: "yellow",
    re: /(?:bought\s+deal|private\s+placement|prospectus\s+offering)\s+(?:financing|of)/i,
    label: "Equity financing",
  },
  {
    type: "step_out_drill",
    severity: "orange",
    re: /step[-\s]?out\s+drill|extends?\s+mineralization|expands?\s+(?:high[-\s]?grade\s+)?zone/i,
    label: "Step-out drill / zone extension",
  },
];

export default async () => {
  await logRun("poll-mining-news", async () => {
    const supabase = getServiceClient();
    const { data: tickers } = await supabase
      .from("signal_tickers")
      .select("ticker, company, commodity")
      .eq("active", true)
      .eq("sector", "mining");
    if (!tickers || tickers.length === 0)
      return { ok: true, message: "no mining tickers" };

    let signalsInserted = 0;
    let catalystsAdded = 0;
    let scanned = 0;
    const errors: string[] = [];
    const cutoff = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
    const expires14 = new Date(
      Date.now() + 14 * 24 * 60 * 60 * 1000
    ).toISOString();

    for (const t of tickers) {
      try {
        // Search by ticker first, fall back to company on no results
        let news = await searchNews(t.ticker);
        if (news.length === 0 && t.company)
          news = await searchNews(t.company);
        for (const item of news) {
          if (!item.title) continue;
          if (
            item.providerPublishTime &&
            item.providerPublishTime < cutoff
          )
            continue;
          scanned++;

          const haystack = `${item.title} ${item.summary ?? ""}`;
          const link = item.link ?? "";
          const uniq = item.uuid ?? `${t.ticker}:${item.title.slice(0, 80)}`;

          // Bonanza assays — extract numeric value and check threshold
          for (const p of BONANZA) {
            const m = haystack.match(p.re);
            if (!m) continue;
            const value = Number((m[1] ?? "").replace(",", "."));
            if (!Number.isFinite(value)) continue;
            if (!bonanzaThresholdMet(p.type, value)) continue;
            const id = await insertSignal(supabase, {
              ticker: t.ticker,
              signal_type: p.type,
              severity: p.severity,
              title: `${t.ticker}: ${p.label} (${value} ${
                p.type === "bonanza_cu" ? "%" : "g/t"
              })`,
              detail: `${item.title}${link ? `\n${link}` : ""}`,
              payload: {
                value,
                title: item.title,
                publisher: item.publisher,
                link,
              },
              expires_at: expires14,
              dedup_key: `${p.type}:${uniq}`,
            });
            if (id) signalsInserted++;
          }

          // Generic news patterns — at most one match per item, prioritized order
          for (const p of NEWS_PATTERNS) {
            if (!p.re.test(haystack)) continue;
            const id = await insertSignal(supabase, {
              ticker: t.ticker,
              signal_type: p.type,
              severity: p.severity,
              title: `${t.ticker}: ${p.label}`,
              detail: `${item.title}${link ? `\n${link}` : ""}`,
              payload: {
                title: item.title,
                publisher: item.publisher,
                link,
              },
              expires_at: expires14,
              dedup_key: `${p.type}:${uniq}`,
            });
            if (id) signalsInserted++;

            // Record matching catalysts as "occurred" with today's date
            if (p.catalyst) {
              const { data: existing } = await supabase
                .from("signal_catalysts")
                .select("id")
                .eq("ticker", t.ticker)
                .eq("source", "yahoo-news")
                .eq("source_id", uniq)
                .maybeSingle();
              if (!existing) {
                await supabase.from("signal_catalysts").insert({
                  ticker: t.ticker,
                  sector: "mining",
                  catalyst_type: p.catalyst,
                  description: item.title,
                  expected_date: new Date().toISOString().slice(0, 10),
                  source: "yahoo-news",
                  source_id: uniq,
                  status: "occurred",
                  occurred_at: new Date().toISOString(),
                });
                catalystsAdded++;
              }
            }
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 250));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${t.ticker}: ${msg}`);
      }
    }

    return {
      ok: errors.length === 0,
      message:
        `${scanned} items scanned, ${signalsInserted} signals, ${catalystsAdded} catalysts` +
        (errors.length ? `; errors: ${errors.slice(0, 3).join("; ")}` : ""),
      metrics: {
        scanned,
        signals: signalsInserted,
        catalysts: catalystsAdded,
        errors: errors.length,
      },
    };
  });
};

export const config: Config = {
  schedule: "15 */2 * * *", // every 2 hours
};
