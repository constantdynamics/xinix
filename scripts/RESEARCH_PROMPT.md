# Claude Research prompt — biotech & mining event backtest

> Paste the prompt below into a fresh Claude.ai session with **Research / web
> search enabled** (or Projects with web access). Then attach
> `scripts/backtest-cases.json` (107 events) as a file.
>
> Why this works where my sandbox didn't: Claude's research/web tooling reaches
> sites like stockanalysis.com, macrotrends.net, marketwatch.com, finance‑news
> archives, SEC EDGAR, sedarplus.ca, and company press‑release archives. None
> of those are blocked the way Yahoo's API was for me.

---

## PROMPT (copy from here ↓)

You are a quantitative research assistant. I'm going to give you a JSON list of
~107 historical biotech and mining events with `ticker`, `date`, `type`,
`sector`, `note`. For **each** event, find the daily closing price for the
ticker on:

1. **`pre_close`** — the trading day **immediately before** `date`
2. **`event_close`** — the trading day at `date` (or the next trading day if
   `date` is a weekend/holiday)
3. **`max_close_5d`** — the **maximum** daily close on `event_close` and the
   following 5 trading days (so 6 closes total: t0…t5)

Then compute:

- `ret_1d   = (event_close   − pre_close) / pre_close`
- `ret_5d_max = (max_close_5d − pre_close) / pre_close`
- `hit_1d_100  = ret_1d ≥ 1.00`           (≥100% in one day)
- `hit_5d_max_250 = ret_5d_max ≥ 2.50`     (≥250% within 5 trading days)

### Where to look (use whatever works — fall back source by source)

In rough order of reliability:

1. **stockanalysis.com/stocks/{TICKER}/financials/?p=quarterly** — has
   historical price tables; or `stockanalysis.com/stocks/{TICKER}/history/`.
2. **finance.yahoo.com/quote/{TICKER}/history?period1=…&period2=…** — direct
   web page (not the JSON API). Often works through web fetch even when the
   API endpoint is blocked.
3. **marketwatch.com/investing/stock/{ticker}/charts** with
   `?countrycode=XX&time=…&start=…&end=…`
4. **macrotrends.net/stocks/charts/{TICKER}/{slug}/stock-price-history**
5. **investing.com/equities/{slug}-historical-data**
6. **wsj.com/market-data/quotes/{TICKER}/historical-prices**
7. For ASX/TSX/AIM tickers: **asx.com.au**, **tmxmoney.com**,
   **londonstockexchange.com**.
8. For OTC/very small caps with no clean source: search for the actual press
   release on PRNewswire/GlobeNewswire/SEC 8‑K, then look for any news
   article that quotes the % move on day 1 (e.g. "shares jumped 287% to
   close at $4.12") — extract `pre_close` and `event_close` from the
   article. Mark these rows `source: "news_article"`.

### Edge cases — handle these explicitly

- **Reverse splits**: many micro‑cap biotechs reverse‑split *after* the event.
  Always use **split‑adjusted closes from the same series** (so prices are
  consistent across t‑1…t+5). Do **not** mix split‑adjusted with raw.
- **Halted stocks** (often FDA approvals halt the stock pre‑market): if the
  reopened price is on a later day, treat that later day as t0 and shift
  the window.
- **Weekend / holiday `date`**: roll forward to the next trading day for
  `event_close`.
- **Buyout cash deals** (e.g. PFE/SGEN, MRK/PRMTSF): cap the realised
  return at the deal price — `event_close` should be the actual market
  close on announcement day, even if the offer was a 100%+ premium and
  the stock only moved to within a few % of the deal value. That's the
  whole point of the backtest.
- **Delisted tickers**: if you can't find any source, output the row with
  `status: "no_data"` and move on. Don't make numbers up.

### Output format — strict

Return a single CSV in a fenced ```csv block, with this exact header and one
row per input case:

```
sector,ticker,date,type,status,pre_close,event_close,max_close_5d,ret_1d,ret_5d_max,hit_1d_100,hit_5d_max_250,source,note
```

- Numeric fields: 4 decimal places, no thousands separators.
- `status`: one of `ok`, `no_data`, `halted_no_open`, `delisted`,
  `mismatched_split`.
- `hit_*` fields: literal `true` / `false` / empty string if status≠ok.
- `source`: short hostname of where you got the prices, e.g.
  `stockanalysis.com`, `marketwatch.com`, `news_article:reuters.com`.
- `note`: keep the original note column from the input.

After the CSV, give me a second fenced block with **aggregates per
`sector/event_type`** in this format:

```
sector,event_type,n_total,n_ok,n_hit_1d_100,n_hit_5d_max_250,hit_rate,avg_ret_1d,avg_ret_5d_max
```

Where `hit_rate = (n_hit_1d_100 ∪ n_hit_5d_max_250) / n_ok`, sorted by
`hit_rate` descending.

Finally, in a short prose section (≤200 words):
- Which 3 event types have the **highest** hit‑rate? (these stay as 🥇
  triggers)
- Which event types have **0 hits across all cases**? (these get demoted)
- Which cases have `status: no_data` and would be worth replacing in the
  curated list (suggest a substitute event of the same type if one comes to
  mind)?
- Any survivorship‑bias warnings about the curated list itself.

### Process / pacing

- Do **not** try to fetch all 107 in parallel. Batch ~10 cases per source,
  cache results. If a source rate‑limits you, switch to the next one.
- For each case, the *minimum* fetches are pre_close and the t0…t5 window —
  that's one chart query per case if the source returns a multi‑day table.
- It's fine to take 30+ tool calls; better correct than fast.
- If after all sources a case is genuinely unverifiable, mark `no_data`
  rather than guessing.

### Input

Cases are attached as `backtest-cases.json` (107 rows). Begin.

## (end of prompt ↑)

---

## After you get the CSV back

1. Save the CSV as `scripts/backtest-results.csv`
2. Tell me ("import the CSV"), and I will:
   - upsert into `signal_backtest_results` so it shows in the Backtest tab
   - update `GOUD_EVENT_TYPES` in `compute-signals-background` to keep only
     types with `hit_rate ≥ 0.5` and `n_ok ≥ 3` (drop the rest to orange)
   - replace any `no_data` cases with the substitutes Claude suggested
3. Optionally run the Netlify backtest from the deployed site too — if both
   methods agree on the hit‑rates, calibration is locked in.
