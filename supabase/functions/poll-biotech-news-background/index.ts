import { getServiceClient } from "../_shared/supabase.ts";
import { insertSignal } from "../_shared/signals.ts";
import { runBackground } from "../_shared/runner.ts";

interface YahooNewsItem {
  uuid?: string;
  title?: string;
  link?: string;
  publisher?: string;
  providerPublishTime?: number;
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
        "Mozilla/5.0 (compatible; SignalBiotechBot/1.0; +https://github.com)",
    },
  });
  if (!res.ok) throw new Error(`Yahoo news ${query} HTTP ${res.status}`);
  const json = (await res.json()) as { news?: YahooNewsItem[] };
  return json.news ?? [];
}

interface BiotechPattern {
  type: string;
  severity: "yellow" | "orange" | "red";
  re: RegExp;
  label: string;
}

const NEGATIVE =
  /(?:did\s+not|failed\s+to|miss(?:ed)?|fails?\s+to)\s+(?:meet|achieve)/i;

const BIOTECH_PATTERNS: BiotechPattern[] = [
  {
    type: "topline_positive",
    severity: "red",
    re: /(?:topline|interim)\s+(?:data|results?)\s+(?:positive|favourable|favorable)|primary\s+endpoint\s+(?:met|achieved)|met\s+(?:its\s+)?primary\s+endpoint|achieved\s+statistical\s+significance|statistically\s+significant\s+(?:improvement|reduction)/i,
    label: "Topline data positive / primary endpoint met",
  },
  {
    type: "phase_success",
    severity: "red",
    re: /phase\s*(?:2|ii|3|iii)\s+(?:trial\s+)?(?:successful|positive|met)/i,
    label: "Phase 2/3 trial successful",
  },
  {
    type: "breakthrough_designation",
    severity: "red",
    re: /breakthrough\s+therapy\s+designation|granted\s+(?:fast\s+track|priority\s+review)/i,
    label: "Breakthrough / fast track designation",
  },
  {
    type: "licensing_deal",
    severity: "red",
    re: /licensing\s+agreement\s+(?:with|worth|valued)|exclusive\s+(?:worldwide\s+)?license\s+to|upfront\s+payment\s+of\s+\$\d/i,
    label: "Major licensing deal",
  },
  {
    type: "buyout_definitive",
    severity: "red",
    re: /(?:definitive|binding)\s+agreement\s+to\s+(?:acquire|be\s+acquired)|to\s+be\s+acquired\s+(?:for|by)|all[-\s]?cash\s+(?:offer|tender)/i,
    label: "Definitive acquisition agreement",
  },
  {
    type: "trial_failed",
    severity: "red",
    re: /(?:phase\s*(?:2|ii|3|iii)\s+(?:trial\s+)?(?:fails?|failed))|did\s+not\s+meet\s+(?:its\s+)?primary\s+endpoint|trial\s+(?:halted|terminated)/i,
    label: "Trial failed / halted",
  },
  {
    type: "topline_mixed",
    severity: "orange",
    re: /mixed\s+(?:results|data)|(?:secondary|exploratory)\s+endpoint\s+met/i,
    label: "Mixed / secondary endpoint",
  },
];

Deno.serve(
  runBackground("poll-biotech-news", async () => {
    const supabase = getServiceClient();
    const { data: tickers } = await supabase
      .from("signal_tickers")
      .select("ticker, company")
      .eq("active", true)
      .eq("sector", "biotech");
    if (!tickers || tickers.length === 0)
      return { ok: true, message: "no biotech tickers" };

    let signalsInserted = 0;
    let scanned = 0;
    const errors: string[] = [];
    const cutoff = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    const expires14 = new Date(
      Date.now() + 14 * 24 * 60 * 60 * 1000
    ).toISOString();

    for (const t of tickers) {
      try {
        let news = await searchNews(t.ticker);
        if (news.length === 0 && t.company)
          news = await searchNews(t.company);
        for (const item of news) {
          if (!item.title) continue;
          if (item.providerPublishTime && item.providerPublishTime < cutoff)
            continue;
          scanned++;

          const haystack = `${item.title} ${item.summary ?? ""}`;
          const link = item.link ?? "";
          const uniq = item.uuid ?? `${t.ticker}:${item.title.slice(0, 80)}`;
          const titleHasNegative = NEGATIVE.test(haystack);

          for (const p of BIOTECH_PATTERNS) {
            if (!p.re.test(haystack)) continue;
            if (p.type === "topline_positive" && titleHasNegative) continue;

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
        `${scanned} items scanned, ${signalsInserted} signals` +
        (errors.length
          ? `; errors: ${errors.slice(0, 3).join("; ")}`
          : ""),
      metrics: {
        scanned,
        signals: signalsInserted,
        errors: errors.length,
      },
    };
  })
);
