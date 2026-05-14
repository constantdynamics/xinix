// xinix-sim-background — simuleert 100+ fundamenteel verschillende handelsstrategieën
// op hetzelfde universum (watchlist + real price data). Elke strategie beheert een
// eigen papieren portefeuille van $10.000. Dagelijks draaien na US close (22:00 UTC).
//
// Dimensies die variëren tussen de strategieën:
//   min_score, require_red, sector, max_pos, pos_size, hold_days,
//   stop_loss, take_profit, limit_buf, min_gold, trailing_stop, opportunity_replace
//
// Gegroepeerd in 14 groepen (A–N) zodat per dimensie lessen getrokken kunnen worden.
//
// Marktconforme transactiekosten: 0,1% per transactie (koop én verkoop).
// Slimme exits:
//   - Trailing stop: stop_loss_price ratchets omhoog met de koers
//   - Signaalverval: entry-signalen verlopen + verlies → vroegtijdig exit
//   - Deelwinst: bij TP-strategieën 50% verkopen op halverwege
//   - Kansrotatie: slechtste positie vervangen als veel betere kans opkomt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function getServiceClient() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}
function checkAuth(req: Request) { const r = Deno.env.get("ADMIN_TOKEN"); if (!r) return false; return (req.headers.get("authorization") ?? "") === `Bearer ${r}`; }
function checkCron(req: Request) { const r = Deno.env.get("CRON_SECRET"); if (!r) return false; return (req.headers.get("x-cron-secret") ?? "") === r; }

// ── Transactiekosten ──────────────────────────────────────────────────────────
const TX_COST = 0.001; // 0,1% per transactie (koop + verkoop) — marktconform

// ── Strategy config type ──────────────────────────────────────────────────────
interface Cfg {
  slug: string; name: string; grp: string;
  minScore: number;
  redReq: boolean;
  sector: "all" | "biotech" | "mining";
  maxPos: number;
  posSize: number;
  holdDays: number;
  stop: number | null;         // vaste stop-loss fractie; null = geen vaste stop
  tp: number | null;           // take-profit fractie; null = geen TP
  limitBuf: number | null;
  minGold: number;
  trailingStop: number | null; // trailing stop (stop ratchets mee omhoog); null = geen
  opportunityReplace: boolean; // vervang slechtste positie voor significant betere kans
}

// ── 100 + 6 strategieën ───────────────────────────────────────────────────────
const B: Cfg = {
  slug:"s65", name:"Score ≥65 (basis)", grp:"A-Score",
  minScore:65, redReq:false, sector:"all", maxPos:8, posSize:1200,
  holdDays:60, stop:0.15, tp:null, limitBuf:0.10, minGold:0,
  trailingStop:null, opportunityReplace:false,
};
function c(o: Partial<Cfg> & { slug:string; name:string; grp:string }): Cfg { return { ...B, ...o }; }

const STRATEGIES: Cfg[] = [
  // A: Score-drempel sweep (10)
  c({slug:"s0",  name:"Score ≥0 (iedereen)",   grp:"A-Score", minScore:0 }),
  c({slug:"s40", name:"Score ≥40",              grp:"A-Score", minScore:40}),
  c({slug:"s50", name:"Score ≥50",              grp:"A-Score", minScore:50}),
  c({slug:"s55", name:"Score ≥55",              grp:"A-Score", minScore:55}),
  c({slug:"s60", name:"Score ≥60",              grp:"A-Score", minScore:60}),
  B,
  c({slug:"s70", name:"Score ≥70",              grp:"A-Score", minScore:70}),
  c({slug:"s75", name:"Score ≥75",              grp:"A-Score", minScore:75}),
  c({slug:"s80", name:"Score ≥80",              grp:"A-Score", minScore:80}),
  c({slug:"s90", name:"Score ≥90 (streng)",     grp:"A-Score", minScore:90}),

  // B: Tijdvenster (6)
  c({slug:"h20",  name:"Tijdvenster 20d",  grp:"B-Hold", holdDays:20 }),
  c({slug:"h30",  name:"Tijdvenster 30d",  grp:"B-Hold", holdDays:30 }),
  c({slug:"h45",  name:"Tijdvenster 45d",  grp:"B-Hold", holdDays:45 }),
  c({slug:"h90",  name:"Tijdvenster 90d",  grp:"B-Hold", holdDays:90 }),
  c({slug:"h120", name:"Tijdvenster 120d", grp:"B-Hold", holdDays:120}),
  c({slug:"h180", name:"Tijdvenster 180d", grp:"B-Hold", holdDays:180}),

  // C: Stop-loss (5)
  c({slug:"nostop", name:"Geen stop-loss",   grp:"C-Stop", stop:null }),
  c({slug:"stop10", name:"Stop-loss -10%",   grp:"C-Stop", stop:0.10 }),
  c({slug:"stop20", name:"Stop-loss -20%",   grp:"C-Stop", stop:0.20 }),
  c({slug:"stop25", name:"Stop-loss -25%",   grp:"C-Stop", stop:0.25 }),
  c({slug:"stop30", name:"Stop-loss -30%",   grp:"C-Stop", stop:0.30 }),

  // D: Take-profit (4)
  c({slug:"tp25",  name:"Take-profit +25%",  grp:"D-TP", tp:0.25}),
  c({slug:"tp50",  name:"Take-profit +50%",  grp:"D-TP", tp:0.50}),
  c({slug:"tp100", name:"Take-profit +100%", grp:"D-TP", tp:1.00}),
  c({slug:"tp200", name:"Take-profit +200%", grp:"D-TP", tp:2.00}),

  // E: Sector (6)
  c({slug:"bio",      name:"Biotech only",         grp:"E-Sector", sector:"biotech"}),
  c({slug:"bio_h30",  name:"Biotech 30d",           grp:"E-Sector", sector:"biotech", holdDays:30}),
  c({slug:"bio_s75",  name:"Biotech Score≥75",      grp:"E-Sector", sector:"biotech", minScore:75}),
  c({slug:"min",      name:"Mining only",           grp:"E-Sector", sector:"mining"}),
  c({slug:"min_h90",  name:"Mining 90d",            grp:"E-Sector", sector:"mining",  holdDays:90, stop:0.20}),
  c({slug:"min_s75",  name:"Mining Score≥75",       grp:"E-Sector", sector:"mining",  minScore:75}),

  // F: Concentratie / positiegrootte (8)
  c({slug:"pos3_xl",  name:"3 pos $2500 (geconcentreerd)", grp:"F-Concentratie", maxPos:3,  posSize:2500}),
  c({slug:"pos5_lg",  name:"5 pos $1800",                  grp:"F-Concentratie", maxPos:5,  posSize:1800}),
  c({slug:"pos5_md",  name:"5 pos $1500",                  grp:"F-Concentratie", maxPos:5,  posSize:1500}),
  c({slug:"pos8_lg",  name:"8 pos $1500",                  grp:"F-Concentratie", maxPos:8,  posSize:1500}),
  c({slug:"pos10_sm", name:"10 pos $800",                  grp:"F-Concentratie", maxPos:10, posSize:800 }),
  c({slug:"pos15_xs", name:"15 pos $500",                  grp:"F-Concentratie", maxPos:15, posSize:500 }),
  c({slug:"pos20_xs", name:"20 pos $400 (gespreid)",       grp:"F-Concentratie", maxPos:20, posSize:400 }),
  c({slug:"pos3_sm",  name:"3 pos $1000",                  grp:"F-Concentratie", maxPos:3,  posSize:1000}),

  // G: Rood-signaal varianten (7)
  c({slug:"red_only", name:"Alleen rood signaal",     grp:"G-Signaal", minScore:0,  redReq:true}),
  c({slug:"red_s50",  name:"Rood + Score≥50",         grp:"G-Signaal", minScore:50, redReq:true}),
  c({slug:"red_s60",  name:"Rood + Score≥60",         grp:"G-Signaal", minScore:60, redReq:true}),
  c({slug:"red_s65",  name:"Rood + Score≥65 (basis)", grp:"G-Signaal", minScore:65, redReq:true}),
  c({slug:"red_s70",  name:"Rood + Score≥70",         grp:"G-Signaal", minScore:70, redReq:true}),
  c({slug:"red_bio",  name:"Rood + Biotech",          grp:"G-Signaal", minScore:60, redReq:true, sector:"biotech"}),
  c({slug:"red_min",  name:"Rood + Mining",           grp:"G-Signaal", minScore:60, redReq:true, sector:"mining"}),

  // H: Medaille-filter (5)
  c({slug:"gold1_s60",  name:"≥1 Goud + Score≥60",      grp:"H-Medaille", minScore:60, minGold:1}),
  c({slug:"gold1_s65",  name:"≥1 Goud + Score≥65",      grp:"H-Medaille", minScore:65, minGold:1}),
  c({slug:"gold2",      name:"≥2 Goud (zeldzaam)",       grp:"H-Medaille", minScore:60, minGold:2}),
  c({slug:"gold1_red",  name:"≥1 Goud + Rood signaal",  grp:"H-Medaille", minScore:60, minGold:1, redReq:true}),
  c({slug:"gold1_h30",  name:"≥1 Goud + 30d",           grp:"H-Medaille", minScore:60, minGold:1, holdDays:30}),

  // I: Buy-limit filter (5)
  c({slug:"lim_strict", name:"Alleen op/onder buy_limit",  grp:"I-Limiet", limitBuf:0.00}),
  c({slug:"lim_5",      name:"Buy_limit +5%",              grp:"I-Limiet", limitBuf:0.05}),
  c({slug:"lim_20",     name:"Buy_limit +20%",             grp:"I-Limiet", limitBuf:0.20}),
  c({slug:"lim_none",   name:"Geen limiet-filter",         grp:"I-Limiet", limitBuf:null}),
  c({slug:"lim_s75",    name:"Strikt limiet + Score≥75",   grp:"I-Limiet", limitBuf:0.00, minScore:75}),

  // J: Exit-combinaties (8)
  c({slug:"tp50_stop10",  name:"TP+50% + Stop-10%",      grp:"J-Exit-combo", tp:0.50, stop:0.10}),
  c({slug:"tp100_stop15", name:"TP+100% + Stop-15%",     grp:"J-Exit-combo", tp:1.00, stop:0.15}),
  c({slug:"tp25_stop10",  name:"TP+25% + Stop-10%",      grp:"J-Exit-combo", tp:0.25, stop:0.10}),
  c({slug:"tp200_stop20", name:"TP+200% + Stop-20%",     grp:"J-Exit-combo", tp:2.00, stop:0.20}),
  c({slug:"nostop_h90",   name:"Geen stop + 90d",         grp:"J-Exit-combo", stop:null, holdDays:90}),
  c({slug:"nostop_h30",   name:"Geen stop + 30d",         grp:"J-Exit-combo", stop:null, holdDays:30}),
  c({slug:"stop5_h30",    name:"Stop-5% + 30d (strak)",  grp:"J-Exit-combo", stop:0.05, holdDays:30}),
  c({slug:"tp50_nostop",  name:"TP+50% geen stop",        grp:"J-Exit-combo", tp:0.50, stop:null}),

  // K: Agressieve profielen (5)
  c({slug:"aggressive",  name:"Agressief (S≥80+Rood, 3pos, 30d, TP+50%)",     grp:"K-Profiel", minScore:80, redReq:true, maxPos:3, posSize:2000, holdDays:30, stop:0.20, tp:0.50}),
  c({slug:"high_roller", name:"High roller (S≥75, 5pos, TP+100%)",             grp:"K-Profiel", minScore:75, maxPos:5, posSize:2000, holdDays:45, stop:0.15, tp:1.00}),
  c({slug:"momentum",    name:"Momentum (S≥70, 30d snel draaien, TP+30%)",    grp:"K-Profiel", minScore:70, holdDays:30, stop:0.10, tp:0.30}),
  c({slug:"gunslinger",  name:"Gunslinger (S≥60, geen limiet, 3pos, TP+75%)", grp:"K-Profiel", minScore:60, maxPos:3, posSize:2000, holdDays:45, stop:0.20, tp:0.75, limitBuf:null}),
  c({slug:"catalyst",    name:"Catalyst hunter (Rood, 45d, TP+50%)",          grp:"K-Profiel", minScore:0, redReq:true, holdDays:45, stop:0.20, tp:0.50}),

  // L: Conservatieve profielen (5)
  c({slug:"conservative",   name:"Conservatief (20pos, 120d, Stop-10%)",       grp:"L-Profiel", minScore:50, maxPos:20, posSize:400, holdDays:120, stop:0.10}),
  c({slug:"cautious",       name:"Voorzichtig (15pos, 90d, strikt limiet)",    grp:"L-Profiel", minScore:60, maxPos:15, posSize:500, holdDays:90, limitBuf:0.00}),
  c({slug:"gold_hunter",    name:"Gold hunter (≥1 Goud, 90d, geen stop)",     grp:"L-Profiel", minScore:60, minGold:1, holdDays:90, stop:null}),
  c({slug:"patient_mining", name:"Patient mining (90d, Stop-20%)",             grp:"L-Profiel", minScore:55, sector:"mining", maxPos:10, posSize:800, holdDays:90, stop:0.20}),
  c({slug:"safe_biotech",   name:"Veilig biotech (S≥70, 45d, Stop-10%)",      grp:"L-Profiel", minScore:70, sector:"biotech", maxPos:10, posSize:800, holdDays:45, stop:0.10}),

  // M: Cross-dimensionele combos (26)
  c({slug:"s75_h30",        name:"Score≥75 + 30d",              grp:"M-Combo", minScore:75, holdDays:30}),
  c({slug:"s75_h90",        name:"Score≥75 + 90d",              grp:"M-Combo", minScore:75, holdDays:90}),
  c({slug:"s65_h30_st10",   name:"S≥65 + 30d + Stop-10%",      grp:"M-Combo", holdDays:30, stop:0.10}),
  c({slug:"s70_tp50",       name:"Score≥70 + TP+50%",           grp:"M-Combo", minScore:70, tp:0.50}),
  c({slug:"s75_tp100",      name:"Score≥75 + TP+100%",          grp:"M-Combo", minScore:75, tp:1.00}),
  c({slug:"bio_h45",        name:"Biotech + 45d + Stop-15%",    grp:"M-Combo", sector:"biotech", holdDays:45}),
  c({slug:"min_h45",        name:"Mining + 45d + Stop-20%",     grp:"M-Combo", sector:"mining",  holdDays:45, stop:0.20}),
  c({slug:"red_h30_st20",   name:"Rood + 30d + Stop-20%",      grp:"M-Combo", minScore:0, redReq:true, holdDays:30, stop:0.20}),
  c({slug:"red_h90_tp100",  name:"Rood + 90d + TP+100%",       grp:"M-Combo", minScore:0, redReq:true, holdDays:90, tp:1.00}),
  c({slug:"gold1_bio",      name:"≥1 Goud + Biotech",          grp:"M-Combo", minGold:1, sector:"biotech"}),
  c({slug:"gold1_min",      name:"≥1 Goud + Mining",           grp:"M-Combo", minGold:1, sector:"mining"}),
  c({slug:"pos3_s80",       name:"3 pos + Score≥80",           grp:"M-Combo", maxPos:3, posSize:2500, minScore:80}),
  c({slug:"pos5_bio",       name:"5 pos + Biotech",            grp:"M-Combo", maxPos:5, posSize:1800, sector:"biotech"}),
  c({slug:"pos5_min",       name:"5 pos + Mining",             grp:"M-Combo", maxPos:5, posSize:1800, sector:"mining"}),
  c({slug:"h30_tp25_st10",  name:"30d + TP+25% + Stop-10%",   grp:"M-Combo", holdDays:30, tp:0.25, stop:0.10}),
  c({slug:"h60_tp50_st20",  name:"60d + TP+50% + Stop-20%",   grp:"M-Combo", tp:0.50, stop:0.20}),
  c({slug:"h120_tp200",     name:"120d + TP+200%",             grp:"M-Combo", holdDays:120, tp:2.00, stop:0.20}),
  c({slug:"lim0_h90",       name:"Strikt limiet + 90d",        grp:"M-Combo", limitBuf:0.00, minScore:60, holdDays:90}),
  c({slug:"lim_none_s75",   name:"Geen limiet + Score≥75",     grp:"M-Combo", limitBuf:null, minScore:75}),
  c({slug:"s50_20pos",      name:"Score≥50 + 20 pos",          grp:"M-Combo", minScore:50, maxPos:20, posSize:400}),
  c({slug:"s80_3pos_tp50",  name:"S≥80 + 3 pos + TP+50%",     grp:"M-Combo", minScore:80, maxPos:3, posSize:2500, tp:0.50}),
  c({slug:"red_3pos_h30",   name:"Rood + 3 pos + 30d",        grp:"M-Combo", minScore:0, redReq:true, maxPos:3, posSize:2000, holdDays:30}),
  c({slug:"gold1_h90_tp",   name:"≥1 Goud + 90d + TP+100%",  grp:"M-Combo", minGold:1, minScore:60, holdDays:90, tp:1.00}),
  c({slug:"s60_h120_ns",    name:"S≥60 + 120d + geen stop",   grp:"M-Combo", minScore:60, holdDays:120, stop:null}),
  c({slug:"bio_red_h45",    name:"Biotech + Rood + 45d",      grp:"M-Combo", sector:"biotech", redReq:true, minScore:60, holdDays:45}),
  c({slug:"min_s70_h60",    name:"Mining + S≥70 + 60d",       grp:"M-Combo", sector:"mining",  minScore:70, stop:0.20}),

  // N: Trailing stop + slimme exits (6) — testen of meebewegende stops beter presteren
  c({slug:"trail10",      name:"Trailing stop -10%",                        grp:"N-Trailing", trailingStop:0.10, stop:null}),
  c({slug:"trail15",      name:"Trailing stop -15%",                        grp:"N-Trailing", trailingStop:0.15, stop:null}),
  c({slug:"trail20",      name:"Trailing stop -20%",                        grp:"N-Trailing", trailingStop:0.20, stop:null}),
  c({slug:"trail10_tp50", name:"Trailing -10% + TP+50%",                   grp:"N-Trailing", trailingStop:0.10, stop:null, tp:0.50}),
  c({slug:"trail15_bio",  name:"Trailing -15% Biotech",                    grp:"N-Trailing", trailingStop:0.15, stop:null, sector:"biotech"}),
  c({slug:"opreplace",    name:"Kans-rotatie (S≥70, trailing -12%, dynm.)", grp:"N-Trailing", minScore:70, trailingStop:0.12, stop:null, opportunityReplace:true}),
];
// A:10 + B:6 + C:5 + D:4 + E:6 + F:8 + G:7 + H:5 + I:5 + J:8 + K:5 + L:5 + M:26 + N:6 = 106

// ── Positieve signaal-types ──────────────────────────────────────────────────
const POS_SIGNALS = new Set([
  "fda_approval","topline_positive","phase_success","breakthrough_designation",
  "buyout_definitive","bonanza_au","discovery_announcement","permit","first_pour",
  "buy_limit_hit","buy_limit_close","buy_limit_warmup","bonanza_ag","bonanza_cu",
  "licensing_deal","resource_update","pea","pfs","dfs","step_out_drill",
  "trial_status_change","jv_strategic","macro_tide",
  "pre_catalyst_7d","pre_catalyst_14d","pre_catalyst_30d","pre_catalyst_60d",
  "near5y_low_gem","loser_gem",
]);

// ── Signaalverval-exit drempels ──────────────────────────────────────────────
const SIGNAL_DECAY_LOSS_PCT = -3.0;   // pas exit toe als positie ≥ 3% verlies
const SIGNAL_DECAY_HOLD_FRAC = 0.33; // minimaal 1/3 van holdDays gehouden voor decay-check

interface OpenPos {
  id: number; strategy_id: number; ticker: string;
  qty: number; avg_price: number; entry_date: string;
  scheduled_exit_date: string;
  stop_loss_price: number | null; take_profit_price: number | null;
  entry_signal_types: string[];
  partial_exits: Array<{ qty_sold: number; net_proceeds: number; at: string; reason: string }>;
}
interface TickerRow { ticker: string; sector: string | null; goud_score: number | null; buy_limit: number | null; medal_gold: number | null; }
interface SigRow { ticker: string; signal_type: string; severity: string; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (!checkAuth(req) && !((req.headers.get("x-cron-secret") ?? "") === (Deno.env.get("CRON_SECRET") ?? "X"))) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const result = await run();
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
});

async function run() {
  const sb = getServiceClient();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // 1. Upsert strategies + states
  const stratRows = STRATEGIES.map((s) => ({
    slug: s.slug, name: s.name, grp: s.grp,
    config: {
      minScore: s.minScore, redReq: s.redReq, sector: s.sector, maxPos: s.maxPos,
      posSize: s.posSize, holdDays: s.holdDays, stop: s.stop, tp: s.tp,
      limitBuf: s.limitBuf, minGold: s.minGold,
      trailingStop: s.trailingStop, opportunityReplace: s.opportunityReplace,
    },
  }));
  await sb.from("xinix_strategies").upsert(stratRows, { onConflict: "slug", ignoreDuplicates: false });

  const { data: stratDb } = await sb.from("xinix_strategies").select("id, slug").in("slug", STRATEGIES.map((s) => s.slug));
  const idBySlug = new Map<string, number>();
  for (const r of (stratDb ?? [])) idBySlug.set(r.slug as string, r.id as number);

  const stateRows = STRATEGIES.map((s) => ({ strategy_id: idBySlug.get(s.slug)! })).filter((r) => r.strategy_id != null);
  await sb.from("xinix_strategy_state").upsert(stateRows, { onConflict: "strategy_id", ignoreDuplicates: true });

  // 2. Gedeelde marktdata ophalen
  const [statesRes, openRes, tickersRes, summaryRes, signalsRes] = await Promise.all([
    sb.from("xinix_strategy_state").select("strategy_id, cash"),
    sb.from("xinix_strategy_positions")
      .select("id, strategy_id, ticker, qty, avg_price, entry_date, scheduled_exit_date, stop_loss_price, take_profit_price, entry_signal_types, partial_exits")
      .is("closed_at", null),
    sb.from("signal_tickers").select("ticker, sector, goud_score, buy_limit, medal_gold").eq("active", true).eq("price_benched", false),
    sb.from("signal_price_summary").select("ticker, last_close"),
    sb.from("signal_events").select("ticker, signal_type, severity")
      .or("expires_at.is.null,expires_at.gt." + now.toISOString())
      .order("detected_at", { ascending: false }).limit(3000),
  ]);

  const cashByStrategy = new Map<number, number>();
  for (const r of (statesRes.data ?? [])) cashByStrategy.set(r.strategy_id as number, Number(r.cash));

  const openByStrategy = new Map<number, OpenPos[]>();
  for (const p of (openRes.data ?? []) as OpenPos[]) {
    const arr = openByStrategy.get(p.strategy_id) ?? [];
    arr.push(p);
    openByStrategy.set(p.strategy_id, arr);
  }

  const priceMap = new Map<string, number>();
  for (const r of (summaryRes.data ?? [])) {
    if (r.last_close != null) priceMap.set(r.ticker as string, Number(r.last_close));
  }

  const tickers = (tickersRes.data ?? []) as TickerRow[];
  const sigsByTicker = new Map<string, SigRow[]>();
  for (const s of (signalsRes.data ?? []) as SigRow[]) {
    const arr = sigsByTicker.get(s.ticker) ?? [];
    arr.push(s);
    sigsByTicker.set(s.ticker, arr);
  }

  // 3. Simuleer elke strategie
  const exits: Array<{ id: number; data: Record<string, unknown> }> = [];
  const stateUpdates: Array<{ strategy_id: number; cash: number; last_run_at: string }> = [];
  const equityRows: Array<Record<string, unknown>> = [];
  // Trailing stop ratchets: dagelijkse opwaartse aanpassing van stop_loss_price
  const stopRatchets: Array<{ id: number; stop_loss_price: number }> = [];
  // Deelverkopen: qty verlagen + partial_exits appenden
  const partialSells: Array<{ id: number; new_qty: number; new_partial_exits: unknown[] }> = [];
  // Buy-orders worden na alle exits/ratchets ingediend
  const buys: Array<Record<string, unknown>> = [];

  for (const cfg of STRATEGIES) {
    const sid = idBySlug.get(cfg.slug);
    if (sid == null) continue;
    let cash = cashByStrategy.get(sid) ?? 10000;
    const openPositions = openByStrategy.get(sid) ?? [];

    // ── Exit-checks ────────────────────────────────────────────────────────────
    const stillOpenTickers = new Set<string>();
    const exitedIds = new Set<number>();

    for (const p of openPositions) {
      const price = priceMap.get(p.ticker);
      if (price == null) { stillOpenTickers.add(p.ticker); continue; }

      // Vaste stop check (met de stop_loss_price uit DB — kan al eerder zijn geratchet)
      const fixedStopHit = cfg.stop != null && price <= Number(p.avg_price) * (1 - cfg.stop);
      // Trailing stop: vergelijk met geratchete stop_loss_price uit DB
      const trailStopHit = cfg.trailingStop != null && p.stop_loss_price != null && price <= Number(p.stop_loss_price);
      const stopHit = fixedStopHit || trailStopHit;
      const tpHit = p.take_profit_price != null && price >= Number(p.take_profit_price);
      const timeUp = now >= new Date(p.scheduled_exit_date);

      // Deelwinst: verkoop helft bij halverwege TP (alleen als: tp geconfigureerd, nog geen deelwinst, niet al op exit)
      if (!stopHit && !tpHit && !timeUp && cfg.tp != null) {
        const alreadyPartial = (p.partial_exits ?? []).length > 0;
        if (!alreadyPartial) {
          const partialTrigger = Number(p.avg_price) * (1 + cfg.tp * 0.5);
          if (price >= partialTrigger) {
            const soldQty = Math.floor(Number(p.qty) / 2 * 1000) / 1000;
            const remainingQty = Number(p.qty) - soldQty;
            if (soldQty > 0 && remainingQty > 0) {
              const netProceeds = soldQty * price * (1 - TX_COST);
              const peEntry = {
                qty_sold: soldQty, net_proceeds: +netProceeds.toFixed(4),
                at: now.toISOString(),
                reason: `Deelwinst ${((price / Number(p.avg_price) - 1) * 100).toFixed(1)}% — helft verkocht op weg naar TP+${(cfg.tp * 100).toFixed(0)}%`,
              };
              partialSells.push({ id: p.id, new_qty: remainingQty, new_partial_exits: [...(p.partial_exits ?? []), peEntry] });
              cash += netProceeds;
              stillOpenTickers.add(p.ticker);
              continue; // positie blijft open, geen volledige exit
            }
          }
        }
      }

      // Signaalverval-exit: entry-thesis niet meer geldig + in verlies
      let signalDecayExit = false;
      if (!stopHit && !tpHit && !timeUp) {
        const entrySigs = p.entry_signal_types ?? [];
        if (entrySigs.length > 0) {
          const heldDays = Math.round((now.getTime() - new Date(p.entry_date).getTime()) / 86_400_000);
          const minHeld = Math.max(14, Math.round(cfg.holdDays * SIGNAL_DECAY_HOLD_FRAC));
          if (heldDays >= minHeld) {
            const retPct = (price - Number(p.avg_price)) / Number(p.avg_price) * 100;
            if (retPct < SIGNAL_DECAY_LOSS_PCT) {
              const activeSigsForTicker = new Set(
                (sigsByTicker.get(p.ticker) ?? [])
                  .filter(s => POS_SIGNALS.has(s.signal_type))
                  .map(s => s.signal_type)
              );
              signalDecayExit = entrySigs.every(sig => !activeSigsForTicker.has(sig));
            }
          }
        }
      }

      if (!stopHit && !tpHit && !timeUp && !signalDecayExit) {
        // Nog open: trailing stop ratchet bijwerken voor morgen
        if (cfg.trailingStop != null) {
          const ratchet = +(price * (1 - cfg.trailingStop)).toFixed(price < 1 ? 4 : price < 10 ? 3 : 2);
          if (ratchet > (p.stop_loss_price ?? 0)) {
            stopRatchets.push({ id: p.id, stop_loss_price: ratchet });
          }
        }
        stillOpenTickers.add(p.ticker);
        continue;
      }

      // ── Positie sluiten ────────────────────────────────────────────────────
      const prevPartials = p.partial_exits ?? [];
      let retUsd: number, retPct: number, netProceeds: number;

      if (prevPartials.length > 0) {
        // Herstel originele qty voor juiste return-berekening
        const origQty = Number(p.qty) + prevPartials.reduce((s, pe) => s + pe.qty_sold, 0);
        const origCost = origQty * Number(p.avg_price) * (1 + TX_COST);
        const partialProc = prevPartials.reduce((s, pe) => s + pe.net_proceeds, 0);
        netProceeds = Number(p.qty) * price * (1 - TX_COST);
        retUsd = partialProc + netProceeds - origCost;
        retPct = origCost > 0 ? (retUsd / origCost) * 100 : 0;
      } else {
        netProceeds = Number(p.qty) * price * (1 - TX_COST);
        const cost = Number(p.qty) * Number(p.avg_price) * (1 + TX_COST);
        retUsd = netProceeds - cost;
        retPct = cost > 0 ? (retUsd / cost) * 100 : 0;
      }

      const holdDays = Math.max(0, Math.round((now.getTime() - new Date(p.entry_date).getTime()) / 86_400_000));
      const currentRetPct = (price - Number(p.avg_price)) / Number(p.avg_price) * 100;
      const reason = fixedStopHit   ? `Stop-loss -${(cfg.stop! * 100).toFixed(0)}%`
                  : trailStopHit   ? `Trailing stop -${(cfg.trailingStop! * 100).toFixed(0)}% (stop ${Number(p.stop_loss_price!).toFixed(2)})`
                  : tpHit          ? `Take-profit +${(cfg.tp! * 100).toFixed(0)}%`
                  : signalDecayExit ? `Signaalthesis verlopen + verlies ${currentRetPct.toFixed(1)}%`
                                   : `Tijdvenster ${cfg.holdDays}d verstreken`;

      exits.push({ id: p.id, data: { closed_at: now.toISOString(), closed_price: price, closed_reason: reason, return_usd: +retUsd.toFixed(4), return_pct: +retPct.toFixed(4), hold_days: holdDays } });
      exitedIds.add(p.id);
      cash += netProceeds;
    }

    // ── Kans-rotatie: vervang slechtste positie als veel betere kans beschikbaar ──
    // (alleen voor opportunityReplace strategieën)
    if (cfg.opportunityReplace && stillOpenTickers.size >= cfg.maxPos) {
      // Bouw kandidatenlijst alvast kort voor rotatie-check
      const quickCandidates: Array<{ ticker: string; rankScore: number }> = [];
      for (const t of tickers) {
        if (stillOpenTickers.has(t.ticker)) continue;
        if (cfg.sector !== "all" && t.sector !== cfg.sector) continue;
        const price = priceMap.get(t.ticker);
        if (!price || price <= 0) continue;
        const score = t.goud_score ?? 0;
        if (score < cfg.minScore) continue;
        const sigs = sigsByTicker.get(t.ticker) ?? [];
        const posSigs = sigs.filter(s => POS_SIGNALS.has(s.signal_type));
        const redCnt = posSigs.filter(s => s.severity === "red").length;
        const orgCnt = posSigs.filter(s => s.severity === "orange").length;
        quickCandidates.push({ ticker: t.ticker, rankScore: score + redCnt * 25 + orgCnt * 10 });
      }
      quickCandidates.sort((a, b) => b.rankScore - a.rankScore);

      if (quickCandidates.length > 0 && quickCandidates[0].rankScore >= 90) {
        // Zoek slechtste open positie (grootste verlies)
        let worstPos: OpenPos | null = null;
        let worstRet = -5.0; // drempel: alleen vervangen bij ≥ -5% verlies
        for (const p of openPositions) {
          if (exitedIds.has(p.id)) continue;
          const price = priceMap.get(p.ticker);
          if (!price) continue;
          const curRet = (price - Number(p.avg_price)) / Number(p.avg_price) * 100;
          if (curRet < worstRet) { worstRet = curRet; worstPos = p; }
        }
        if (worstPos) {
          const price = priceMap.get(worstPos.ticker)!;
          const prevPartials = worstPos.partial_exits ?? [];
          let retUsd: number, retPct: number, netProceeds: number;
          if (prevPartials.length > 0) {
            const origQty = Number(worstPos.qty) + prevPartials.reduce((s, pe) => s + pe.qty_sold, 0);
            const origCost = origQty * Number(worstPos.avg_price) * (1 + TX_COST);
            const partialProc = prevPartials.reduce((s, pe) => s + pe.net_proceeds, 0);
            netProceeds = Number(worstPos.qty) * price * (1 - TX_COST);
            retUsd = partialProc + netProceeds - origCost;
            retPct = origCost > 0 ? (retUsd / origCost) * 100 : 0;
          } else {
            netProceeds = Number(worstPos.qty) * price * (1 - TX_COST);
            const cost = Number(worstPos.qty) * Number(worstPos.avg_price) * (1 + TX_COST);
            retUsd = netProceeds - cost;
            retPct = cost > 0 ? (retUsd / cost) * 100 : 0;
          }
          const holdDays = Math.max(0, Math.round((now.getTime() - new Date(worstPos.entry_date).getTime()) / 86_400_000));
          exits.push({ id: worstPos.id, data: {
            closed_at: now.toISOString(), closed_price: price,
            closed_reason: `Kans-rotatie: ${quickCandidates[0].ticker} (rank ${quickCandidates[0].rankScore}) — positie verlies ${worstRet.toFixed(1)}%`,
            return_usd: +retUsd.toFixed(4), return_pct: +retPct.toFixed(4), hold_days: holdDays,
          }});
          exitedIds.add(worstPos.id);
          stillOpenTickers.delete(worstPos.ticker);
          cash += netProceeds;
        }
      }
    }

    // ── Buy-kandidaten zoeken & kopen ──────────────────────────────────────────
    const slotsAvailable = Math.max(0, cfg.maxPos - stillOpenTickers.size);
    if (slotsAvailable > 0 && cash - cfg.posSize >= 200) {
      const candidates: Array<{
        ticker: string; price: number; score: number; rankScore: number;
        sector: string | null; signals: SigRow[]; reason: string;
      }> = [];

      for (const t of tickers) {
        if (stillOpenTickers.has(t.ticker)) continue;
        if (cfg.sector !== "all" && t.sector !== cfg.sector) continue;
        if ((t.medal_gold ?? 0) < cfg.minGold) continue;
        const price = priceMap.get(t.ticker);
        if (price == null || price <= 0) continue;
        const score = t.goud_score ?? 0;
        const sigs = sigsByTicker.get(t.ticker) ?? [];
        const positiveSigs = sigs.filter((s) => POS_SIGNALS.has(s.signal_type));
        const hasRed = positiveSigs.some((s) => s.severity === "red");
        const scoreOk = score >= cfg.minScore;
        if (cfg.redReq && !hasRed) continue;
        if (!scoreOk && !hasRed) continue;
        if (cfg.limitBuf != null && t.buy_limit != null && price > Number(t.buy_limit) * (1 + cfg.limitBuf)) continue;
        const redCnt = positiveSigs.filter((s) => s.severity === "red").length;
        const orgCnt = positiveSigs.filter((s) => s.severity === "orange").length;
        const rankScore = score + redCnt * 25 + orgCnt * 10;
        const parts: string[] = [];
        if (scoreOk) parts.push(`score ${score}`);
        if (redCnt > 0) parts.push(`${redCnt}× rood`);
        if (orgCnt > 0) parts.push(`${orgCnt}× oranje`);
        candidates.push({ ticker: t.ticker, price, score, rankScore, sector: t.sector, signals: positiveSigs, reason: parts.join(" · ") || "kwalificeert" });
      }
      candidates.sort((a, b) => b.rankScore - a.rankScore);

      let bought = 0;
      for (const cand of candidates) {
        if (bought >= slotsAvailable) break;
        const buyCost = cfg.posSize; // beoogde positiewaarde
        if (cash - buyCost * (1 + TX_COST) < 200) break; // inclusief transactiekosten
        const qty = Math.floor((buyCost / cand.price) * 1000) / 1000;
        if (qty <= 0) continue;
        const actualCost = qty * cand.price * (1 + TX_COST); // totaal uit kas incl. kosten
        if (cash - actualCost < 200) continue;
        const fmtPrc = (n: number) => n.toFixed(cand.price < 1 ? 4 : cand.price < 10 ? 3 : 2);
        // Initiële stop: vaste stop OF startwaarde voor trailing stop
        const slp = cfg.stop != null         ? +fmtPrc(cand.price * (1 - cfg.stop))
                  : cfg.trailingStop != null  ? +fmtPrc(cand.price * (1 - cfg.trailingStop))
                  : null;
        const tpp = cfg.tp != null ? +fmtPrc(cand.price * (1 + cfg.tp)) : null;
        const exitDate = new Date(now.getTime() + cfg.holdDays * 86_400_000).toISOString();
        const sigTypes = [...new Set(cand.signals.map((s) => s.signal_type))];
        buys.push({
          strategy_id: sid, ticker: cand.ticker, qty, avg_price: cand.price,
          entry_date: now.toISOString(), entry_reason: `[${cfg.slug}] ${cand.reason}`,
          entry_signal_types: sigTypes, entry_score: cand.score || null, entry_sector: cand.sector,
          scheduled_exit_date: exitDate, stop_loss_price: slp, take_profit_price: tpp,
        });
        cash -= actualCost;
        stillOpenTickers.add(cand.ticker);
        bought++;
      }
    }

    // ── Equity snapshot ────────────────────────────────────────────────────────
    let posVal = 0;
    for (const p of (openByStrategy.get(sid) ?? [])) {
      if (exitedIds.has(p.id)) continue;
      const partialUpdate = partialSells.find(u => u.id === p.id);
      const qty = partialUpdate ? partialUpdate.new_qty : Number(p.qty);
      posVal += qty * (priceMap.get(p.ticker) ?? Number(p.avg_price));
    }
    for (const b of buys.filter((b) => b.strategy_id === sid)) {
      posVal += Number(b.qty as number) * Number(b.avg_price as number);
    }
    const totalEquity = cash + posVal;
    stateUpdates.push({ strategy_id: sid, cash, last_run_at: now.toISOString() });
    equityRows.push({ strategy_id: sid, date: today, cash, positions_value: posVal, total_equity: totalEquity, positions_count: stillOpenTickers.size, computed_at: now.toISOString() });
  }

  // 4. Batch writes
  for (const ex of exits) {
    await sb.from("xinix_strategy_positions").update(ex.data).eq("id", ex.id);
  }
  for (const r of stopRatchets) {
    await sb.from("xinix_strategy_positions").update({ stop_loss_price: r.stop_loss_price }).eq("id", r.id);
  }
  for (const u of partialSells) {
    await sb.from("xinix_strategy_positions").update({ qty: u.new_qty, partial_exits: u.new_partial_exits }).eq("id", u.id);
  }
  if (buys.length > 0) {
    for (let i = 0; i < buys.length; i += 500) {
      await sb.from("xinix_strategy_positions").insert(buys.slice(i, i + 500));
    }
  }
  await sb.from("xinix_strategy_state").upsert(stateUpdates, { onConflict: "strategy_id" });
  for (let i = 0; i < equityRows.length; i += 200) {
    await sb.from("xinix_strategy_equity").upsert(equityRows.slice(i, i + 200), { onConflict: "strategy_id,date" });
  }

  await sb.from("signal_runs").insert({
    job: "xinix-sim", finished_at: now.toISOString(), ok: true,
    message: `${STRATEGIES.length} strategieën: ${exits.length} exits (incl. ${partialSells.length} deelwinst), ${buys.length} aankopen, ${stopRatchets.length} stop-ratchets`,
    metrics: { strategies: STRATEGIES.length, exits: exits.length, partial_sells: partialSells.length, buys: buys.length, stop_ratchets: stopRatchets.length, equity_rows: equityRows.length },
  });

  return { ok: true, strategies: STRATEGIES.length, exits: exits.length, partial_sells: partialSells.length, buys: buys.length, stop_ratchets: stopRatchets.length };
}
