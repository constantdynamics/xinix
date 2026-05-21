// xinix-sim-background — simuleert ~556 fundamenteel verschillende handelsstrategieën
// op hetzelfde universum (watchlist + real price data). Elke strategie beheert een
// eigen papieren portefeuille van $10.000. Dagelijks draaien na US close (22:00 UTC).
//
// Dimensies die variëren tussen de strategieën:
//   min_score, require_red, sector, max_pos, pos_size, hold_days,
//   stop_loss, take_profit, limit_buf, min_gold, trailing_stop, opportunity_replace,
//   require_hikkertje, require_zwitserleven
//
// Gegroepeerd in 25 groepen (A–Y) zodat per dimensie lessen getrokken kunnen worden.
// Groep X = hikkertjes (momentum plays), Y = zwitserleven (dividend-rijke fallen angels).
//
// Dividend-income wordt approximatief meegeteld in totaalrendement:
// avg_price × dividend_yield × qty × (hold_days/365) bij elke positie-sluiting.
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
import { checkAuth, checkCron, checkAdminOrCron } from "../_shared/auth.ts";
import { TX_COST } from "../_shared/constants.ts";

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
  requireHikkertje?: boolean;   // alleen kandidaten met is_hikkertje=true
  requireZwitserleven?: boolean; // alleen kandidaten met zwitserleven_stocks.meets_criteria=true
  requirePoefie?: boolean;      // alleen kandidaten met is_poefie=true
  requireHotWarm?: boolean;     // alleen kandidaten met minimaal 1 rood OF oranje positief signaal
  hotWarmRatio?: number;        // bij requireHotWarm: fractie van slots gereserveerd voor hot (rood), rest voor warm (oranje). Default 0.70 (70/30).
}

// ── 200 strategieën (B = basisprofiel, gebruikt als basis voor c()) ─────────
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

  // O: Kans-rotatie varianten (8) — opportunityReplace gecombineerd met andere dimensies
  c({slug:"opr_s75",      name:"Kansrot. Score≥75",                     grp:"O-OppReplace", minScore:75, opportunityReplace:true}),
  c({slug:"opr_trail10",  name:"Kansrot. trailing -10%",                grp:"O-OppReplace", trailingStop:0.10, stop:null, opportunityReplace:true}),
  c({slug:"opr_trail20",  name:"Kansrot. trailing -20%",                grp:"O-OppReplace", trailingStop:0.20, stop:null, opportunityReplace:true}),
  c({slug:"opr_bio",      name:"Kansrot. Biotech",                      grp:"O-OppReplace", sector:"biotech",  opportunityReplace:true}),
  c({slug:"opr_min",      name:"Kansrot. Mining",                       grp:"O-OppReplace", sector:"mining",   opportunityReplace:true}),
  c({slug:"opr_h30",      name:"Kansrot. 30d",                          grp:"O-OppReplace", holdDays:30, opportunityReplace:true}),
  c({slug:"opr_pos15",    name:"Kansrot. 15 pos",                       grp:"O-OppReplace", maxPos:15, posSize:600, opportunityReplace:true}),
  c({slug:"opr_red",      name:"Kansrot. Rood signaal",                 grp:"O-OppReplace", minScore:0, redReq:true, opportunityReplace:true}),

  // P: Trailing stop uitbreidingen (10) — meer granulariteit in de trailing-dimensie
  c({slug:"trail8",         name:"Trailing stop -8% (strak)",           grp:"P-Trailing2", trailingStop:0.08, stop:null}),
  c({slug:"trail12",        name:"Trailing stop -12%",                  grp:"P-Trailing2", trailingStop:0.12, stop:null}),
  c({slug:"trail25",        name:"Trailing stop -25% (ruim)",           grp:"P-Trailing2", trailingStop:0.25, stop:null}),
  c({slug:"trail15_s75",    name:"Trailing -15% + Score≥75",            grp:"P-Trailing2", trailingStop:0.15, stop:null, minScore:75}),
  c({slug:"trail15_h90",    name:"Trailing -15% + 90d",                 grp:"P-Trailing2", trailingStop:0.15, stop:null, holdDays:90}),
  c({slug:"trail15_min",    name:"Trailing -15% + Mining",              grp:"P-Trailing2", trailingStop:0.15, stop:null, sector:"mining"}),
  c({slug:"trail10_tp100",  name:"Trailing -10% + TP+100%",             grp:"P-Trailing2", trailingStop:0.10, stop:null, tp:1.00}),
  c({slug:"trail20_h120",   name:"Trailing -20% + 120d",                grp:"P-Trailing2", trailingStop:0.20, stop:null, holdDays:120}),
  c({slug:"trail12_red",    name:"Trailing -12% + Rood",                grp:"P-Trailing2", trailingStop:0.12, stop:null, minScore:0, redReq:true}),
  c({slug:"trail15_tp25",   name:"Trailing -15% + TP+25%",              grp:"P-Trailing2", trailingStop:0.15, stop:null, tp:0.25}),

  // Q: Score × Hold matrix (10) — vult gaten in de score-hold combinatieruimte
  c({slug:"s50_h45",   name:"Score≥50 + 45d",  grp:"Q-ScoreHold", minScore:50, holdDays:45}),
  c({slug:"s60_h30",   name:"Score≥60 + 30d",  grp:"Q-ScoreHold", minScore:60, holdDays:30}),
  c({slug:"s60_h90",   name:"Score≥60 + 90d",  grp:"Q-ScoreHold", minScore:60, holdDays:90}),
  c({slug:"s70_h20",   name:"Score≥70 + 20d",  grp:"Q-ScoreHold", minScore:70, holdDays:20}),
  c({slug:"s70_h45",   name:"Score≥70 + 45d",  grp:"Q-ScoreHold", minScore:70, holdDays:45}),
  c({slug:"s70_h90",   name:"Score≥70 + 90d",  grp:"Q-ScoreHold", minScore:70, holdDays:90}),
  c({slug:"s70_h120",  name:"Score≥70 + 120d", grp:"Q-ScoreHold", minScore:70, holdDays:120}),
  c({slug:"s75_h120",  name:"Score≥75 + 120d", grp:"Q-ScoreHold", minScore:75, holdDays:120}),
  c({slug:"s80_h30",   name:"Score≥80 + 30d",  grp:"Q-ScoreHold", minScore:80, holdDays:30}),
  c({slug:"s80_h90",   name:"Score≥80 + 90d",  grp:"Q-ScoreHold", minScore:80, holdDays:90}),

  // R: Stop × Score (8) — hoe beïnvloedt stop-striktheid een score-drempel?
  c({slug:"s50_stop5",  name:"Score≥50 + Stop -5%",  grp:"R-StopScore", minScore:50, stop:0.05}),
  c({slug:"s60_stop5",  name:"Score≥60 + Stop -5%",  grp:"R-StopScore", minScore:60, stop:0.05}),
  c({slug:"s65_stop5",  name:"Score≥65 + Stop -5%",  grp:"R-StopScore", stop:0.05}),
  c({slug:"s70_stop20", name:"Score≥70 + Stop -20%", grp:"R-StopScore", minScore:70, stop:0.20}),
  c({slug:"s75_stop10", name:"Score≥75 + Stop -10%", grp:"R-StopScore", minScore:75, stop:0.10}),
  c({slug:"s75_stop25", name:"Score≥75 + Stop -25%", grp:"R-StopScore", minScore:75, stop:0.25}),
  c({slug:"s80_stop10", name:"Score≥80 + Stop -10%", grp:"R-StopScore", minScore:80, stop:0.10}),
  c({slug:"s80_nostop", name:"Score≥80 + geen stop", grp:"R-StopScore", minScore:80, stop:null}),

  // S: TP varianten uitgebreid (8)
  c({slug:"tp25_h30",      name:"TP+25% + 30d",              grp:"S-TPVariant", tp:0.25, holdDays:30}),
  c({slug:"tp25_h90",      name:"TP+25% + 90d",              grp:"S-TPVariant", tp:0.25, holdDays:90}),
  c({slug:"tp50_h90",      name:"TP+50% + 90d",              grp:"S-TPVariant", tp:0.50, holdDays:90}),
  c({slug:"tp50_s75",      name:"TP+50% + Score≥75",         grp:"S-TPVariant", tp:0.50, minScore:75}),
  c({slug:"tp100_h120",    name:"TP+100% + 120d",            grp:"S-TPVariant", tp:1.00, holdDays:120}),
  c({slug:"tp100_s80",     name:"TP+100% + Score≥80",        grp:"S-TPVariant", tp:1.00, minScore:80}),
  c({slug:"tp200_s75",     name:"TP+200% + Score≥75",        grp:"S-TPVariant", tp:2.00, minScore:75}),
  c({slug:"tp25_s80_st10", name:"TP+25% + S≥80 + Stop-10%", grp:"S-TPVariant", tp:0.25, minScore:80, stop:0.10}),

  // T: Sector verrijkt (8)
  c({slug:"bio_tp50",     name:"Biotech + TP+50%",               grp:"T-SectorRich", sector:"biotech", tp:0.50}),
  c({slug:"bio_tp100",    name:"Biotech + TP+100%",              grp:"T-SectorRich", sector:"biotech", tp:1.00}),
  c({slug:"bio_s70_tp50", name:"Biotech + Score≥70 + TP+50%",   grp:"T-SectorRich", sector:"biotech", minScore:70, tp:0.50}),
  c({slug:"bio_trail15",  name:"Biotech + trailing -15%",        grp:"T-SectorRich", sector:"biotech", trailingStop:0.15, stop:null}),
  c({slug:"min_trail15",  name:"Mining + trailing -15%",         grp:"T-SectorRich", sector:"mining",  trailingStop:0.15, stop:null}),
  c({slug:"min_tp100",    name:"Mining + TP+100%",               grp:"T-SectorRich", sector:"mining",  tp:1.00}),
  c({slug:"min_s70_tp50", name:"Mining + Score≥70 + TP+50%",    grp:"T-SectorRich", sector:"mining",  minScore:70, tp:0.50}),
  c({slug:"min_h120_ns",  name:"Mining + 120d + geen stop",      grp:"T-SectorRich", sector:"mining",  holdDays:120, stop:null}),

  // U: Conservatieve profielen uitgebreid (6)
  c({slug:"ultra_safe",  name:"Ultra veilig (20 pos, Stop -5%)",       grp:"U-ConsProfiel", minScore:50, maxPos:20, posSize:400, holdDays:90, stop:0.05}),
  c({slug:"diversified", name:"Gediversifieerd (15 pos, 90d)",         grp:"U-ConsProfiel", minScore:55, maxPos:15, posSize:600, holdDays:90}),
  c({slug:"income",      name:"Inkomsten (12 pos, TP+25%)",            grp:"U-ConsProfiel", minScore:60, maxPos:12, posSize:700, tp:0.25, stop:0.15}),
  c({slug:"patient_all", name:"Geduldig (10 pos, 120d, Stop -10%)",   grp:"U-ConsProfiel", minScore:65, maxPos:10, posSize:900, holdDays:120, stop:0.10}),
  c({slug:"gold_cons",   name:"Goud conservatief (15 pos, 90d)",      grp:"U-ConsProfiel", minGold:1, minScore:60, maxPos:15, posSize:600, holdDays:90, stop:0.15}),
  c({slug:"low_risk_bio",name:"Laag risico Biotech (8 pos, 90d)",     grp:"U-ConsProfiel", sector:"biotech", minScore:70, maxPos:8, posSize:900, holdDays:90, stop:0.10}),

  // V: Agressieve profielen uitgebreid (6)
  c({slug:"ultra_agg",    name:"Ultra agressief (S≥80+Rood, 3 pos, 20d, TP+100%)", grp:"V-AggProfiel", minScore:80, redReq:true, maxPos:3, posSize:2500, holdDays:20, stop:null, tp:1.00}),
  c({slug:"trend_follow", name:"Trend follower (S≥70, trailing -12%, 4 pos)",      grp:"V-AggProfiel", minScore:70, maxPos:4, posSize:2000, trailingStop:0.12, stop:null}),
  c({slug:"breakout",     name:"Breakout (S≥75+Rood, 4 pos, 30d, TP+75%)",        grp:"V-AggProfiel", minScore:75, redReq:true, maxPos:4, posSize:2000, holdDays:30, stop:0.20, tp:0.75}),
  c({slug:"bio_explosive",name:"Bio explosief (Rood, 3 pos, TP+100%)",             grp:"V-AggProfiel", sector:"biotech", redReq:true, maxPos:3, posSize:2500, stop:null, tp:1.00}),
  c({slug:"min_momentum", name:"Mining momentum (S≥70, trailing -15%, TP+50%)",   grp:"V-AggProfiel", sector:"mining", minScore:70, trailingStop:0.15, stop:null, tp:0.50}),
  c({slug:"hybrid_trail", name:"Hybride trail+rotatie (S≥70, TP+50%)",            grp:"V-AggProfiel", minScore:70, trailingStop:0.10, stop:null, tp:0.50, opportunityReplace:true}),

  // W: Multi-factor combos (30) — kruisverbanden van 3+ dimensies
  c({slug:"s75_red_h45",      name:"S≥75 + Rood + 45d",              grp:"W-MultiCombo", minScore:75, redReq:true, holdDays:45}),
  c({slug:"s70_gold1_h60",    name:"S≥70 + ≥1 Goud + 60d",           grp:"W-MultiCombo", minScore:70, minGold:1}),
  c({slug:"s75_gold1_h45",    name:"S≥75 + ≥1 Goud + 45d",           grp:"W-MultiCombo", minScore:75, minGold:1, holdDays:45}),
  c({slug:"s70_lim0_h60",     name:"S≥70 + Strikt limiet + 60d",      grp:"W-MultiCombo", minScore:70, limitBuf:0.00}),
  c({slug:"s80_lim0",         name:"S≥80 + Strikt limiet",            grp:"W-MultiCombo", minScore:80, limitBuf:0.00}),
  c({slug:"red_gold1_h60",    name:"Rood + ≥1 Goud + 60d",           grp:"W-MultiCombo", redReq:true, minGold:1}),
  c({slug:"bio_gold1_trail",  name:"Biotech + Goud + trailing -15%",  grp:"W-MultiCombo", sector:"biotech", minGold:1, trailingStop:0.15, stop:null}),
  c({slug:"min_gold1_h90",    name:"Mining + ≥1 Goud + 90d",          grp:"W-MultiCombo", sector:"mining", minGold:1, holdDays:90}),
  c({slug:"bio_s70_h90",      name:"Biotech + S≥70 + 90d",            grp:"W-MultiCombo", sector:"biotech", minScore:70, holdDays:90}),
  c({slug:"s70_trail15_h90",  name:"S≥70 + trailing -15% + 90d",      grp:"W-MultiCombo", minScore:70, trailingStop:0.15, stop:null, holdDays:90}),
  c({slug:"s75_trail10_tp50", name:"S≥75 + trailing -10% + TP+50%",   grp:"W-MultiCombo", minScore:75, trailingStop:0.10, stop:null, tp:0.50}),
  c({slug:"s65_opr_trail",    name:"S≥65 + kansrot. + trailing -12%", grp:"W-MultiCombo", trailingStop:0.12, stop:null, opportunityReplace:true}),
  c({slug:"red_trail15_h60",  name:"Rood + trailing -15% + 60d",      grp:"W-MultiCombo", minScore:0, redReq:true, trailingStop:0.15, stop:null}),
  c({slug:"gold1_trail15_h90",name:"≥1 Goud + trailing -15% + 90d",   grp:"W-MultiCombo", minGold:1, minScore:60, trailingStop:0.15, stop:null, holdDays:90}),
  c({slug:"bio_opr",          name:"Biotech + kansrotatie",           grp:"W-MultiCombo", sector:"biotech", opportunityReplace:true}),
  c({slug:"min_opr",          name:"Mining + kansrotatie",            grp:"W-MultiCombo", sector:"mining",  opportunityReplace:true}),
  c({slug:"s80_opr_trail",    name:"S≥80 + kansrot. + trailing -12%", grp:"W-MultiCombo", minScore:80, trailingStop:0.12, stop:null, opportunityReplace:true}),
  c({slug:"pos5_trail15",     name:"5 pos $1800 + trailing -15%",     grp:"W-MultiCombo", maxPos:5, posSize:1800, trailingStop:0.15, stop:null}),
  c({slug:"pos3_trail10_tp",  name:"3 pos $2500 + trailing -10% + TP+50%", grp:"W-MultiCombo", maxPos:3, posSize:2500, trailingStop:0.10, stop:null, tp:0.50}),
  c({slug:"s70_h30_tp50",     name:"S≥70 + 30d + TP+50%",            grp:"W-MultiCombo", minScore:70, holdDays:30, tp:0.50}),
  c({slug:"s75_stop15_tp100", name:"S≥75 + Stop-15% + TP+100%",      grp:"W-MultiCombo", minScore:75, stop:0.15, tp:1.00}),
  c({slug:"bio_h90_ns",       name:"Biotech + 90d + geen stop",       grp:"W-MultiCombo", sector:"biotech", holdDays:90, stop:null}),
  c({slug:"min_h30_tp50",     name:"Mining + 30d + TP+50%",          grp:"W-MultiCombo", sector:"mining", holdDays:30, tp:0.50}),
  c({slug:"red_s70_trail",    name:"Rood + S≥70 + trailing -12%",    grp:"W-MultiCombo", minScore:70, redReq:true, trailingStop:0.12, stop:null}),
  c({slug:"s60_h30_tp25",     name:"S≥60 + 30d + TP+25%",            grp:"W-MultiCombo", minScore:60, holdDays:30, tp:0.25}),
  c({slug:"gold2_trail",      name:"≥2 Goud + trailing -15%",         grp:"W-MultiCombo", minGold:2, minScore:60, trailingStop:0.15, stop:null}),
  c({slug:"s80_red_trail",    name:"S≥80 + Rood + trailing -12%",    grp:"W-MultiCombo", minScore:80, redReq:true, trailingStop:0.12, stop:null}),
  c({slug:"lim0_trail15",     name:"Strikt limiet + trailing -15%",   grp:"W-MultiCombo", limitBuf:0.00, trailingStop:0.15, stop:null}),
  c({slug:"s65_bio_trail",    name:"S≥65 + Biotech + trailing -15%",  grp:"W-MultiCombo", minScore:65, sector:"biotech", trailingStop:0.15, stop:null}),
  c({slug:"min_red_h60",      name:"Mining + Rood + 60d",             grp:"W-MultiCombo", sector:"mining", redReq:true, minScore:0}),

  // X: Hikkertjes-strategieën (10) — momentum plays op explosieve 1-dag stijgers.
  // Korte hold, hoge TP, deel met trailing om de spike mee te pakken.
  c({slug:"hik_basic",      name:"⚡ Hikkertje basis (30d, TP+50%)",          grp:"X-Hikkertjes", minScore:0, holdDays:30, stop:0.20, tp:0.50, requireHikkertje:true}),
  c({slug:"hik_aggr",       name:"⚡ Hikkertje agressief (20d, TP+100%)",      grp:"X-Hikkertjes", minScore:0, holdDays:20, stop:0.20, tp:1.00, requireHikkertje:true, maxPos:5, posSize:2000}),
  c({slug:"hik_explosive",  name:"⚡ Hikkertje explosief (15d, TP+200%)",      grp:"X-Hikkertjes", minScore:0, holdDays:15, stop:0.25, tp:2.00, requireHikkertje:true, maxPos:4, posSize:2500}),
  c({slug:"hik_trail10",    name:"⚡ Hikkertje trailing -10%",                grp:"X-Hikkertjes", minScore:0, holdDays:45, stop:null, trailingStop:0.10, requireHikkertje:true}),
  c({slug:"hik_trail15",    name:"⚡ Hikkertje trailing -15%",                grp:"X-Hikkertjes", minScore:0, holdDays:60, stop:null, trailingStop:0.15, requireHikkertje:true}),
  c({slug:"hik_s50",        name:"⚡ Hikkertje + S≥50",                       grp:"X-Hikkertjes", minScore:50, holdDays:30, stop:0.20, tp:0.50, requireHikkertje:true}),
  c({slug:"hik_red",        name:"⚡ Hikkertje + Rood signaal",               grp:"X-Hikkertjes", minScore:0, holdDays:30, stop:0.20, tp:0.75, redReq:true, requireHikkertje:true}),
  c({slug:"hik_lim0",       name:"⚡ Hikkertje op buy_limit (strikt)",         grp:"X-Hikkertjes", minScore:0, holdDays:30, stop:0.20, tp:0.50, limitBuf:0.00, requireHikkertje:true}),
  c({slug:"hik_opr",        name:"⚡ Hikkertje + kansrotatie",                grp:"X-Hikkertjes", minScore:0, holdDays:30, stop:null, trailingStop:0.12, tp:0.75, requireHikkertje:true, opportunityReplace:true}),
  c({slug:"hik_bio",        name:"⚡ Hikkertje biotech only",                  grp:"X-Hikkertjes", minScore:0, holdDays:30, stop:0.20, tp:1.00, sector:"biotech", requireHikkertje:true}),

  // Y: Zwitserleven-strategieën (10) — dividend-rijke fallen angels uit grote indices.
  // Lange hold zodat dividend (avg × yield × days/365) significant bijdraagt aan totaalrendement.
  // Stops zijn ruimer/afwezig omdat het dividend een buffer biedt.
  c({slug:"zwl_basic",      name:"🌴 Zwitserleven 90d",                      grp:"Y-Zwitserleven", minScore:0, holdDays:90, stop:0.20, tp:null, requireZwitserleven:true}),
  c({slug:"zwl_long",       name:"🌴 Zwitserleven 180d (lange dividend-rit)", grp:"Y-Zwitserleven", minScore:0, holdDays:180, stop:0.25, tp:null, requireZwitserleven:true}),
  c({slug:"zwl_nostop",     name:"🌴 Zwitserleven geen stop (180d)",          grp:"Y-Zwitserleven", minScore:0, holdDays:180, stop:null, tp:null, requireZwitserleven:true}),
  c({slug:"zwl_trail15",    name:"🌴 Zwitserleven trailing -15%",            grp:"Y-Zwitserleven", minScore:0, holdDays:120, stop:null, trailingStop:0.15, requireZwitserleven:true}),
  c({slug:"zwl_trail20",    name:"🌴 Zwitserleven trailing -20%",            grp:"Y-Zwitserleven", minScore:0, holdDays:120, stop:null, trailingStop:0.20, requireZwitserleven:true}),
  c({slug:"zwl_tp25",       name:"🌴 Zwitserleven + TP+25%",                 grp:"Y-Zwitserleven", minScore:0, holdDays:90, stop:0.20, tp:0.25, requireZwitserleven:true}),
  c({slug:"zwl_tp50",       name:"🌴 Zwitserleven + TP+50%",                 grp:"Y-Zwitserleven", minScore:0, holdDays:120, stop:0.20, tp:0.50, requireZwitserleven:true}),
  c({slug:"zwl_cons",       name:"🌴 Zwitserleven conservatief (15 pos)",     grp:"Y-Zwitserleven", minScore:0, holdDays:120, stop:0.15, tp:null, maxPos:15, posSize:600, requireZwitserleven:true}),
  c({slug:"zwl_concentrate", name:"🌴 Zwitserleven geconcentreerd (5 pos)",   grp:"Y-Zwitserleven", minScore:0, holdDays:120, stop:0.20, tp:null, maxPos:5, posSize:2000, requireZwitserleven:true}),
  c({slug:"zwl_lim5",       name:"🌴 Zwitserleven + buy_limit +5%",          grp:"Y-Zwitserleven", minScore:0, holdDays:90, stop:0.20, tp:null, limitBuf:0.05, requireZwitserleven:true}),
];

// ── Padding tot 20 per familie + 2 nieuwe families ──────────────────────────
// We breiden families die nu minder dan 20 strategieën hebben uit naar 20
// "om het recht te trekken qua kansen" — elke familie krijgt evenveel
// experimentele varianten. Families die al ≥20 hebben (M-Combo, W-MultiCombo)
// blijven onaangetast.
const EXTRA_STRATEGIES: Cfg[] = [
  // A-Score → 20 (was 9, +11): score-drempel + dimensies zoals stop/tp/hold
  c({slug:"s5",       name:"Score ≥5",                      grp:"A-Score", minScore:5}),
  c({slug:"s10",      name:"Score ≥10",                     grp:"A-Score", minScore:10}),
  c({slug:"s15",      name:"Score ≥15",                     grp:"A-Score", minScore:15}),
  c({slug:"s20",      name:"Score ≥20",                     grp:"A-Score", minScore:20}),
  c({slug:"s25",      name:"Score ≥25",                     grp:"A-Score", minScore:25}),
  c({slug:"s30",      name:"Score ≥30",                     grp:"A-Score", minScore:30}),
  c({slug:"s35",      name:"Score ≥35",                     grp:"A-Score", minScore:35}),
  c({slug:"s45",      name:"Score ≥45",                     grp:"A-Score", minScore:45}),
  c({slug:"s85",      name:"Score ≥85",                     grp:"A-Score", minScore:85}),
  c({slug:"s95",      name:"Score ≥95 (extreem streng)",    grp:"A-Score", minScore:95}),

  // B-Hold → 20 (was 6, +14): meer tijdvensters + cross-overs
  c({slug:"h7",        name:"Tijdvenster 7d (snel)",        grp:"B-Hold", holdDays:7}),
  c({slug:"h10",       name:"Tijdvenster 10d",              grp:"B-Hold", holdDays:10}),
  c({slug:"h14",       name:"Tijdvenster 14d (2 weken)",    grp:"B-Hold", holdDays:14}),
  c({slug:"h25",       name:"Tijdvenster 25d",              grp:"B-Hold", holdDays:25}),
  c({slug:"h35",       name:"Tijdvenster 35d",              grp:"B-Hold", holdDays:35}),
  c({slug:"h60",       name:"Tijdvenster 60d (basis)",      grp:"B-Hold", holdDays:60}),
  c({slug:"h75",       name:"Tijdvenster 75d",              grp:"B-Hold", holdDays:75}),
  c({slug:"h100",      name:"Tijdvenster 100d",             grp:"B-Hold", holdDays:100}),
  c({slug:"h150",      name:"Tijdvenster 150d",             grp:"B-Hold", holdDays:150}),
  c({slug:"h240",      name:"Tijdvenster 240d",             grp:"B-Hold", holdDays:240}),
  c({slug:"h300",      name:"Tijdvenster 300d",             grp:"B-Hold", holdDays:300}),
  c({slug:"h365",      name:"Tijdvenster 365d (een jaar)",  grp:"B-Hold", holdDays:365}),
  c({slug:"h30_s50",   name:"30d + Score≥50",               grp:"B-Hold", holdDays:30, minScore:50}),
  c({slug:"h60_s70",   name:"60d + Score≥70",               grp:"B-Hold", holdDays:60, minScore:70}),

  // C-Stop → 20 (was 5, +15): meer stop-loss waarden
  c({slug:"stop3",     name:"Stop-loss -3% (zeer strak)",    grp:"C-Stop", stop:0.03}),
  c({slug:"stop5",     name:"Stop-loss -5%",                 grp:"C-Stop", stop:0.05}),
  c({slug:"stop7",     name:"Stop-loss -7%",                 grp:"C-Stop", stop:0.07}),
  c({slug:"stop8",     name:"Stop-loss -8%",                 grp:"C-Stop", stop:0.08}),
  c({slug:"stop12",    name:"Stop-loss -12%",                grp:"C-Stop", stop:0.12}),
  c({slug:"stop15",    name:"Stop-loss -15% (basis)",        grp:"C-Stop", stop:0.15}),
  c({slug:"stop18",    name:"Stop-loss -18%",                grp:"C-Stop", stop:0.18}),
  c({slug:"stop22",    name:"Stop-loss -22%",                grp:"C-Stop", stop:0.22}),
  c({slug:"stop28",    name:"Stop-loss -28%",                grp:"C-Stop", stop:0.28}),
  c({slug:"stop35",    name:"Stop-loss -35%",                grp:"C-Stop", stop:0.35}),
  c({slug:"stop40",    name:"Stop-loss -40%",                grp:"C-Stop", stop:0.40}),
  c({slug:"stop50",    name:"Stop-loss -50% (zeer ruim)",    grp:"C-Stop", stop:0.50}),
  c({slug:"stop10_s70",name:"Stop-10% + Score≥70",           grp:"C-Stop", stop:0.10, minScore:70}),
  c({slug:"stop15_h90",name:"Stop-15% + 90d",                grp:"C-Stop", stop:0.15, holdDays:90}),
  c({slug:"stop20_h45",name:"Stop-20% + 45d",                grp:"C-Stop", stop:0.20, holdDays:45}),

  // D-TP → 20 (was 4, +16): meer take-profit waarden + cross-overs
  c({slug:"tp10",      name:"Take-profit +10%",              grp:"D-TP", tp:0.10}),
  c({slug:"tp15",      name:"Take-profit +15%",              grp:"D-TP", tp:0.15}),
  c({slug:"tp20",      name:"Take-profit +20%",              grp:"D-TP", tp:0.20}),
  c({slug:"tp30",      name:"Take-profit +30%",              grp:"D-TP", tp:0.30}),
  c({slug:"tp40",      name:"Take-profit +40%",              grp:"D-TP", tp:0.40}),
  c({slug:"tp60",      name:"Take-profit +60%",              grp:"D-TP", tp:0.60}),
  c({slug:"tp75",      name:"Take-profit +75%",              grp:"D-TP", tp:0.75}),
  c({slug:"tp85",      name:"Take-profit +85%",              grp:"D-TP", tp:0.85}),
  c({slug:"tp125",     name:"Take-profit +125%",             grp:"D-TP", tp:1.25}),
  c({slug:"tp150",     name:"Take-profit +150%",             grp:"D-TP", tp:1.50}),
  c({slug:"tp175",     name:"Take-profit +175%",             grp:"D-TP", tp:1.75}),
  c({slug:"tp250",     name:"Take-profit +250%",             grp:"D-TP", tp:2.50}),
  c({slug:"tp300",     name:"Take-profit +300%",             grp:"D-TP", tp:3.00}),
  c({slug:"tp400",     name:"Take-profit +400%",             grp:"D-TP", tp:4.00}),
  c({slug:"tp500",     name:"Take-profit +500% (moonshot)",  grp:"D-TP", tp:5.00}),
  c({slug:"tp35_s70",  name:"TP+35% + Score≥70",             grp:"D-TP", tp:0.35, minScore:70}),

  // E-Sector → 20 (was 6, +14): meer biotech/mining-variaties
  c({slug:"bio_h60",      name:"Biotech 60d",                   grp:"E-Sector", sector:"biotech", holdDays:60}),
  c({slug:"bio_h120",     name:"Biotech 120d",                  grp:"E-Sector", sector:"biotech", holdDays:120}),
  c({slug:"bio_s60",      name:"Biotech Score≥60",              grp:"E-Sector", sector:"biotech", minScore:60}),
  c({slug:"bio_s70",      name:"Biotech Score≥70",              grp:"E-Sector", sector:"biotech", minScore:70}),
  c({slug:"bio_stop10",   name:"Biotech Stop-10%",              grp:"E-Sector", sector:"biotech", stop:0.10}),
  c({slug:"bio_stop25",   name:"Biotech Stop-25%",              grp:"E-Sector", sector:"biotech", stop:0.25}),
  c({slug:"bio_tp25",     name:"Biotech TP+25%",                grp:"E-Sector", sector:"biotech", tp:0.25}),
  c({slug:"min_h45",      name:"Mining 45d",                    grp:"E-Sector", sector:"mining",  holdDays:45}),
  c({slug:"min_h120",     name:"Mining 120d",                   grp:"E-Sector", sector:"mining",  holdDays:120}),
  c({slug:"min_s60",      name:"Mining Score≥60",               grp:"E-Sector", sector:"mining",  minScore:60}),
  c({slug:"min_s70",      name:"Mining Score≥70",               grp:"E-Sector", sector:"mining",  minScore:70}),
  c({slug:"min_stop25",   name:"Mining Stop-25%",               grp:"E-Sector", sector:"mining",  stop:0.25}),
  c({slug:"min_tp50",     name:"Mining TP+50%",                 grp:"E-Sector", sector:"mining",  tp:0.50}),
  c({slug:"min_tp100",    name:"Mining TP+100%",                grp:"E-Sector", sector:"mining",  tp:1.00}),

  // F-Concentratie → 20 (was 8, +12)
  c({slug:"pos1_max",     name:"1 pos $5000 (all-in)",          grp:"F-Concentratie", maxPos:1,  posSize:5000}),
  c({slug:"pos2_xl",      name:"2 pos $3500",                   grp:"F-Concentratie", maxPos:2,  posSize:3500}),
  c({slug:"pos4_lg",      name:"4 pos $2000",                   grp:"F-Concentratie", maxPos:4,  posSize:2000}),
  c({slug:"pos6_md",      name:"6 pos $1500",                   grp:"F-Concentratie", maxPos:6,  posSize:1500}),
  c({slug:"pos7_md",      name:"7 pos $1300",                   grp:"F-Concentratie", maxPos:7,  posSize:1300}),
  c({slug:"pos8_sm",      name:"8 pos $1000",                   grp:"F-Concentratie", maxPos:8,  posSize:1000}),
  c({slug:"pos10_md",     name:"10 pos $1000",                  grp:"F-Concentratie", maxPos:10, posSize:1000}),
  c({slug:"pos12_md",     name:"12 pos $800",                   grp:"F-Concentratie", maxPos:12, posSize:800}),
  c({slug:"pos12_sm",     name:"12 pos $600",                   grp:"F-Concentratie", maxPos:12, posSize:600}),
  c({slug:"pos18_xs",     name:"18 pos $450",                   grp:"F-Concentratie", maxPos:18, posSize:450}),
  c({slug:"pos25_micro",  name:"25 pos $300 (zeer gespreid)",   grp:"F-Concentratie", maxPos:25, posSize:300}),
  c({slug:"pos30_micro",  name:"30 pos $250",                   grp:"F-Concentratie", maxPos:30, posSize:250}),

  // G-Signaal → 20 (was 7, +13)
  c({slug:"red_s55",      name:"Rood + Score≥55",               grp:"G-Signaal", minScore:55, redReq:true}),
  c({slug:"red_s75",      name:"Rood + Score≥75",               grp:"G-Signaal", minScore:75, redReq:true}),
  c({slug:"red_s80",      name:"Rood + Score≥80",               grp:"G-Signaal", minScore:80, redReq:true}),
  c({slug:"red_h30",      name:"Rood + 30d",                    grp:"G-Signaal", minScore:0,  redReq:true, holdDays:30}),
  c({slug:"red_h45",      name:"Rood + 45d",                    grp:"G-Signaal", minScore:0,  redReq:true, holdDays:45}),
  c({slug:"red_h90",      name:"Rood + 90d",                    grp:"G-Signaal", minScore:0,  redReq:true, holdDays:90}),
  c({slug:"red_h120",     name:"Rood + 120d",                   grp:"G-Signaal", minScore:0,  redReq:true, holdDays:120}),
  c({slug:"red_stop10",   name:"Rood + Stop-10%",               grp:"G-Signaal", minScore:0,  redReq:true, stop:0.10}),
  c({slug:"red_stop20",   name:"Rood + Stop-20%",               grp:"G-Signaal", minScore:0,  redReq:true, stop:0.20}),
  c({slug:"red_tp50",     name:"Rood + TP+50%",                 grp:"G-Signaal", minScore:0,  redReq:true, tp:0.50}),
  c({slug:"red_tp100",    name:"Rood + TP+100%",                grp:"G-Signaal", minScore:0,  redReq:true, tp:1.00}),
  c({slug:"red_trail10",  name:"Rood + Trailing -10%",          grp:"G-Signaal", minScore:0,  redReq:true, trailingStop:0.10, stop:null}),
  c({slug:"red_lim0",     name:"Rood + Strikt limiet",          grp:"G-Signaal", minScore:0,  redReq:true, limitBuf:0.00}),

  // H-Medaille → 20 (was 5, +15)
  c({slug:"gold1_s50",    name:"≥1 Goud + Score≥50",            grp:"H-Medaille", minScore:50, minGold:1}),
  c({slug:"gold1_s70",    name:"≥1 Goud + Score≥70",            grp:"H-Medaille", minScore:70, minGold:1}),
  c({slug:"gold1_s75",    name:"≥1 Goud + Score≥75",            grp:"H-Medaille", minScore:75, minGold:1}),
  c({slug:"gold1_s80",    name:"≥1 Goud + Score≥80",            grp:"H-Medaille", minScore:80, minGold:1}),
  c({slug:"gold1_h45",    name:"≥1 Goud + 45d",                 grp:"H-Medaille", minScore:60, minGold:1, holdDays:45}),
  c({slug:"gold1_h60",    name:"≥1 Goud + 60d",                 grp:"H-Medaille", minScore:60, minGold:1, holdDays:60}),
  c({slug:"gold1_h120",   name:"≥1 Goud + 120d",                grp:"H-Medaille", minScore:60, minGold:1, holdDays:120}),
  c({slug:"gold1_stop10", name:"≥1 Goud + Stop-10%",            grp:"H-Medaille", minScore:60, minGold:1, stop:0.10}),
  c({slug:"gold1_stop20", name:"≥1 Goud + Stop-20%",            grp:"H-Medaille", minScore:60, minGold:1, stop:0.20}),
  c({slug:"gold1_tp50",   name:"≥1 Goud + TP+50%",              grp:"H-Medaille", minScore:60, minGold:1, tp:0.50}),
  c({slug:"gold1_tp100",  name:"≥1 Goud + TP+100%",             grp:"H-Medaille", minScore:60, minGold:1, tp:1.00}),
  c({slug:"gold1_bio2",   name:"≥1 Goud + Biotech",             grp:"H-Medaille", minScore:60, minGold:1, sector:"biotech"}),
  c({slug:"gold1_min2",   name:"≥1 Goud + Mining",              grp:"H-Medaille", minScore:60, minGold:1, sector:"mining"}),
  c({slug:"gold1_trail",  name:"≥1 Goud + Trailing -15%",       grp:"H-Medaille", minScore:60, minGold:1, trailingStop:0.15, stop:null}),
  c({slug:"gold2_red",    name:"≥2 Goud + Rood signaal",        grp:"H-Medaille", minScore:60, minGold:2, redReq:true}),

  // I-Limiet → 20 (was 5, +15)
  c({slug:"lim2",         name:"Buy_limit +2%",                  grp:"I-Limiet", limitBuf:0.02}),
  c({slug:"lim3",         name:"Buy_limit +3%",                  grp:"I-Limiet", limitBuf:0.03}),
  c({slug:"lim7",         name:"Buy_limit +7%",                  grp:"I-Limiet", limitBuf:0.07}),
  c({slug:"lim15",        name:"Buy_limit +15%",                 grp:"I-Limiet", limitBuf:0.15}),
  c({slug:"lim25",        name:"Buy_limit +25%",                 grp:"I-Limiet", limitBuf:0.25}),
  c({slug:"lim30",        name:"Buy_limit +30%",                 grp:"I-Limiet", limitBuf:0.30}),
  c({slug:"lim50",        name:"Buy_limit +50%",                 grp:"I-Limiet", limitBuf:0.50}),
  c({slug:"lim0_h30",     name:"Strikt limiet + 30d",            grp:"I-Limiet", limitBuf:0.00, holdDays:30}),
  c({slug:"lim0_h60",     name:"Strikt limiet + 60d",            grp:"I-Limiet", limitBuf:0.00, holdDays:60}),
  c({slug:"lim5_s70",     name:"Limiet +5% + Score≥70",          grp:"I-Limiet", limitBuf:0.05, minScore:70}),
  c({slug:"lim10_s75",    name:"Limiet +10% + Score≥75",         grp:"I-Limiet", limitBuf:0.10, minScore:75}),
  c({slug:"lim0_red",     name:"Strikt limiet + Rood",           grp:"I-Limiet", limitBuf:0.00, minScore:0, redReq:true}),
  c({slug:"lim0_gold1",   name:"Strikt limiet + ≥1 Goud",        grp:"I-Limiet", limitBuf:0.00, minGold:1}),
  c({slug:"lim5_bio",     name:"Limiet +5% + Biotech",           grp:"I-Limiet", limitBuf:0.05, sector:"biotech"}),
  c({slug:"lim5_min",     name:"Limiet +5% + Mining",            grp:"I-Limiet", limitBuf:0.05, sector:"mining"}),

  // J-Exit-combo → 20 (was 8, +12)
  c({slug:"tp15_stop5",     name:"TP+15% + Stop-5%",             grp:"J-Exit-combo", tp:0.15, stop:0.05}),
  c({slug:"tp20_stop8",     name:"TP+20% + Stop-8%",             grp:"J-Exit-combo", tp:0.20, stop:0.08}),
  c({slug:"tp30_stop10",    name:"TP+30% + Stop-10%",            grp:"J-Exit-combo", tp:0.30, stop:0.10}),
  c({slug:"tp40_stop15",    name:"TP+40% + Stop-15%",            grp:"J-Exit-combo", tp:0.40, stop:0.15}),
  c({slug:"tp50_stop20",    name:"TP+50% + Stop-20%",            grp:"J-Exit-combo", tp:0.50, stop:0.20}),
  c({slug:"tp75_stop15",    name:"TP+75% + Stop-15%",            grp:"J-Exit-combo", tp:0.75, stop:0.15}),
  c({slug:"tp100_stop20",   name:"TP+100% + Stop-20%",           grp:"J-Exit-combo", tp:1.00, stop:0.20}),
  c({slug:"tp150_stop25",   name:"TP+150% + Stop-25%",           grp:"J-Exit-combo", tp:1.50, stop:0.25}),
  c({slug:"tp50_trail10",   name:"TP+50% + Trailing -10%",       grp:"J-Exit-combo", tp:0.50, trailingStop:0.10, stop:null}),
  c({slug:"tp100_trail15",  name:"TP+100% + Trailing -15%",      grp:"J-Exit-combo", tp:1.00, trailingStop:0.15, stop:null}),
  c({slug:"nostop_h60",     name:"Geen stop + 60d",              grp:"J-Exit-combo", stop:null, holdDays:60}),
  c({slug:"nostop_h120",    name:"Geen stop + 120d",             grp:"J-Exit-combo", stop:null, holdDays:120}),

  // K-Profiel (agressief) → 20 (was 5, +15)
  c({slug:"agg_red",        name:"Agg. Rood (S≥75, 4 pos, TP+75%)",          grp:"K-Profiel", minScore:75, redReq:true, maxPos:4, posSize:2000, tp:0.75, stop:0.20}),
  c({slug:"agg_red_short",  name:"Agg. Rood snel (S≥70, 3 pos, 20d, TP+60%)", grp:"K-Profiel", minScore:70, redReq:true, maxPos:3, posSize:2500, holdDays:20, tp:0.60, stop:0.15}),
  c({slug:"agg_bio_trail",  name:"Agg. Biotech (trailing -10%, TP+100%)",     grp:"K-Profiel", sector:"biotech", minScore:70, maxPos:4, posSize:2000, trailingStop:0.10, stop:null, tp:1.00}),
  c({slug:"agg_min_trail",  name:"Agg. Mining (trailing -10%, TP+75%)",       grp:"K-Profiel", sector:"mining",  minScore:70, maxPos:4, posSize:2000, trailingStop:0.10, stop:null, tp:0.75}),
  c({slug:"agg_gold_short", name:"Agg. Goud snel (≥1 Goud, 30d, TP+50%)",     grp:"K-Profiel", minScore:60, minGold:1, maxPos:4, posSize:2000, holdDays:30, tp:0.50, stop:0.20}),
  c({slug:"agg_s85_3pos",   name:"Agg. S≥85 + 3 pos + TP+100%",               grp:"K-Profiel", minScore:85, maxPos:3, posSize:2500, tp:1.00, stop:0.20}),
  c({slug:"agg_tp200",      name:"Agg. TP+200% (S≥70, 4 pos)",                grp:"K-Profiel", minScore:70, maxPos:4, posSize:2000, tp:2.00, stop:0.25}),
  c({slug:"agg_lim0_short", name:"Agg. Strikt limiet + 20d",                  grp:"K-Profiel", minScore:65, maxPos:5, posSize:1800, holdDays:20, limitBuf:0.00, tp:0.50, stop:0.15}),
  c({slug:"agg_no_lim_tp",  name:"Agg. Geen limiet + TP+75%",                 grp:"K-Profiel", minScore:75, maxPos:4, posSize:2000, limitBuf:null, tp:0.75, stop:0.20}),
  c({slug:"agg_red_bio",    name:"Agg. Rood + Biotech (3 pos, TP+100%)",      grp:"K-Profiel", sector:"biotech", redReq:true, minScore:0, maxPos:3, posSize:2500, tp:1.00, stop:0.20}),
  c({slug:"agg_red_min",    name:"Agg. Rood + Mining (3 pos, TP+75%)",        grp:"K-Profiel", sector:"mining",  redReq:true, minScore:0, maxPos:3, posSize:2500, tp:0.75, stop:0.20}),
  c({slug:"agg_short_30",   name:"Agg. 30d snel draaien (S≥75)",              grp:"K-Profiel", minScore:75, maxPos:5, posSize:1800, holdDays:30, tp:0.40, stop:0.12}),
  c({slug:"agg_pos2",       name:"Agg. 2 pos $3500 + TP+100%",                grp:"K-Profiel", minScore:75, maxPos:2, posSize:3500, tp:1.00, stop:0.20}),
  c({slug:"agg_opr_red",    name:"Agg. Kansrot. + Rood (trailing -10%)",       grp:"K-Profiel", minScore:60, redReq:true, maxPos:4, posSize:2000, trailingStop:0.10, stop:null, opportunityReplace:true}),
  c({slug:"agg_tp50_h20",   name:"Agg. TP+50% + 20d",                          grp:"K-Profiel", minScore:70, maxPos:5, posSize:1800, holdDays:20, tp:0.50, stop:0.15}),

  // L-Profiel (conservatief) → 20 (was 5, +15)
  c({slug:"cons_20pos_h90", name:"Cons. 20 pos + 90d",                        grp:"L-Profiel", minScore:50, maxPos:20, posSize:400, holdDays:90, stop:0.15}),
  c({slug:"cons_25pos",     name:"Cons. 25 pos $300 (zeer gespreid)",         grp:"L-Profiel", minScore:50, maxPos:25, posSize:300, holdDays:120, stop:0.15}),
  c({slug:"cons_lim0",      name:"Cons. 15 pos + Strikt limiet",              grp:"L-Profiel", minScore:60, maxPos:15, posSize:500, limitBuf:0.00, holdDays:90, stop:0.12}),
  c({slug:"cons_s50",       name:"Cons. Score≥50 + 12 pos + 120d",            grp:"L-Profiel", minScore:50, maxPos:12, posSize:700, holdDays:120, stop:0.12}),
  c({slug:"cons_s60_120",   name:"Cons. Score≥60 + 120d",                     grp:"L-Profiel", minScore:60, maxPos:10, posSize:900, holdDays:120, stop:0.10}),
  c({slug:"cons_s65_180",   name:"Cons. Score≥65 + 180d",                     grp:"L-Profiel", minScore:65, maxPos:10, posSize:900, holdDays:180, stop:0.12}),
  c({slug:"cons_gold1_120", name:"Cons. ≥1 Goud + 120d",                      grp:"L-Profiel", minScore:60, minGold:1, maxPos:12, posSize:700, holdDays:120, stop:0.12}),
  c({slug:"cons_bio_s70",   name:"Cons. Biotech S≥70 + 90d",                  grp:"L-Profiel", sector:"biotech", minScore:70, maxPos:10, posSize:800, holdDays:90, stop:0.10}),
  c({slug:"cons_min_s65",   name:"Cons. Mining S≥65 + 120d",                  grp:"L-Profiel", sector:"mining",  minScore:65, maxPos:10, posSize:800, holdDays:120, stop:0.15}),
  c({slug:"cons_div_short", name:"Cons. Tijdvenster 45d (defensief)",         grp:"L-Profiel", minScore:65, maxPos:15, posSize:500, holdDays:45, stop:0.08}),
  c({slug:"cons_trail8",    name:"Cons. Trailing -8% (10 pos)",               grp:"L-Profiel", minScore:60, maxPos:10, posSize:800, trailingStop:0.08, stop:null, holdDays:90}),
  c({slug:"cons_trail12",   name:"Cons. Trailing -12% (15 pos)",              grp:"L-Profiel", minScore:60, maxPos:15, posSize:500, trailingStop:0.12, stop:null, holdDays:90}),
  c({slug:"cons_h180_s55",  name:"Cons. 180d + Score≥55",                     grp:"L-Profiel", minScore:55, maxPos:12, posSize:700, holdDays:180, stop:0.15}),
  c({slug:"cons_h120_lim0", name:"Cons. 120d + Strikt limiet",                grp:"L-Profiel", minScore:60, maxPos:12, posSize:700, holdDays:120, limitBuf:0.00, stop:0.10}),
  c({slug:"cons_15pos_180", name:"Cons. 15 pos + 180d",                       grp:"L-Profiel", minScore:60, maxPos:15, posSize:500, holdDays:180, stop:0.15}),

  // N-Trailing → 20 (was 6, +14)
  c({slug:"trail7",          name:"Trailing stop -7%",                        grp:"N-Trailing", trailingStop:0.07, stop:null}),
  c({slug:"trail9",          name:"Trailing stop -9%",                        grp:"N-Trailing", trailingStop:0.09, stop:null}),
  c({slug:"trail11",         name:"Trailing stop -11%",                       grp:"N-Trailing", trailingStop:0.11, stop:null}),
  c({slug:"trail13",         name:"Trailing stop -13%",                       grp:"N-Trailing", trailingStop:0.13, stop:null}),
  c({slug:"trail17",         name:"Trailing stop -17%",                       grp:"N-Trailing", trailingStop:0.17, stop:null}),
  c({slug:"trail22",         name:"Trailing stop -22%",                       grp:"N-Trailing", trailingStop:0.22, stop:null}),
  c({slug:"trail30",         name:"Trailing stop -30% (zeer ruim)",           grp:"N-Trailing", trailingStop:0.30, stop:null}),
  c({slug:"trail15_h30",     name:"Trailing -15% + 30d",                      grp:"N-Trailing", trailingStop:0.15, stop:null, holdDays:30}),
  c({slug:"trail15_h60",     name:"Trailing -15% + 60d",                      grp:"N-Trailing", trailingStop:0.15, stop:null, holdDays:60}),
  c({slug:"trail10_s70",     name:"Trailing -10% + Score≥70",                 grp:"N-Trailing", trailingStop:0.10, stop:null, minScore:70}),
  c({slug:"trail15_s80",     name:"Trailing -15% + Score≥80",                 grp:"N-Trailing", trailingStop:0.15, stop:null, minScore:80}),
  c({slug:"trail10_red",     name:"Trailing -10% + Rood signaal",             grp:"N-Trailing", trailingStop:0.10, stop:null, minScore:0, redReq:true}),
  c({slug:"trail10_gold1",   name:"Trailing -10% + ≥1 Goud",                  grp:"N-Trailing", trailingStop:0.10, stop:null, minGold:1}),
  c({slug:"trail15_lim0",    name:"Trailing -15% + Strikt limiet",            grp:"N-Trailing", trailingStop:0.15, stop:null, limitBuf:0.00}),

  // O-OppReplace → 20 (was 8, +12)
  c({slug:"opr_s50",         name:"Kansrot. Score≥50",                        grp:"O-OppReplace", minScore:50, opportunityReplace:true}),
  c({slug:"opr_s60",         name:"Kansrot. Score≥60",                        grp:"O-OppReplace", minScore:60, opportunityReplace:true}),
  c({slug:"opr_s80",         name:"Kansrot. Score≥80",                        grp:"O-OppReplace", minScore:80, opportunityReplace:true}),
  c({slug:"opr_gold1",       name:"Kansrot. ≥1 Goud",                         grp:"O-OppReplace", minGold:1,   opportunityReplace:true}),
  c({slug:"opr_lim0",        name:"Kansrot. Strikt limiet",                    grp:"O-OppReplace", limitBuf:0.00, opportunityReplace:true}),
  c({slug:"opr_lim_none",    name:"Kansrot. Geen limiet",                      grp:"O-OppReplace", limitBuf:null, opportunityReplace:true}),
  c({slug:"opr_h45",         name:"Kansrot. 45d",                              grp:"O-OppReplace", holdDays:45, opportunityReplace:true}),
  c({slug:"opr_h90",         name:"Kansrot. 90d",                              grp:"O-OppReplace", holdDays:90, opportunityReplace:true}),
  c({slug:"opr_pos5",        name:"Kansrot. 5 pos $1800",                      grp:"O-OppReplace", maxPos:5, posSize:1800, opportunityReplace:true}),
  c({slug:"opr_pos20",       name:"Kansrot. 20 pos $400",                      grp:"O-OppReplace", maxPos:20, posSize:400, opportunityReplace:true}),
  c({slug:"opr_tp50",        name:"Kansrot. TP+50%",                           grp:"O-OppReplace", tp:0.50, opportunityReplace:true}),
  c({slug:"opr_tp100",       name:"Kansrot. TP+100%",                          grp:"O-OppReplace", tp:1.00, opportunityReplace:true}),

  // P-Trailing2 → 20 (was 10, +10)
  c({slug:"trail5",          name:"Trailing stop -5% (zeer strak)",            grp:"P-Trailing2", trailingStop:0.05, stop:null}),
  c({slug:"trail6",          name:"Trailing stop -6%",                         grp:"P-Trailing2", trailingStop:0.06, stop:null}),
  c({slug:"trail14",         name:"Trailing stop -14%",                        grp:"P-Trailing2", trailingStop:0.14, stop:null}),
  c({slug:"trail16",         name:"Trailing stop -16%",                        grp:"P-Trailing2", trailingStop:0.16, stop:null}),
  c({slug:"trail18",         name:"Trailing stop -18%",                        grp:"P-Trailing2", trailingStop:0.18, stop:null}),
  c({slug:"trail10_lim0",    name:"Trailing -10% + Strikt limiet",             grp:"P-Trailing2", trailingStop:0.10, stop:null, limitBuf:0.00}),
  c({slug:"trail15_gold1",   name:"Trailing -15% + ≥1 Goud",                   grp:"P-Trailing2", trailingStop:0.15, stop:null, minGold:1}),
  c({slug:"trail20_s70",     name:"Trailing -20% + Score≥70",                  grp:"P-Trailing2", trailingStop:0.20, stop:null, minScore:70}),
  c({slug:"trail12_h60",     name:"Trailing -12% + 60d",                       grp:"P-Trailing2", trailingStop:0.12, stop:null, holdDays:60}),
  c({slug:"trail15_pos5",    name:"Trailing -15% + 5 pos $1800",               grp:"P-Trailing2", trailingStop:0.15, stop:null, maxPos:5, posSize:1800}),

  // Q-ScoreHold → 20 (was 10, +10)
  c({slug:"s50_h30",         name:"Score≥50 + 30d",                            grp:"Q-ScoreHold", minScore:50, holdDays:30}),
  c({slug:"s50_h60",         name:"Score≥50 + 60d",                            grp:"Q-ScoreHold", minScore:50, holdDays:60}),
  c({slug:"s55_h45",         name:"Score≥55 + 45d",                            grp:"Q-ScoreHold", minScore:55, holdDays:45}),
  c({slug:"s60_h60",         name:"Score≥60 + 60d",                            grp:"Q-ScoreHold", minScore:60, holdDays:60}),
  c({slug:"s60_h120",        name:"Score≥60 + 120d",                           grp:"Q-ScoreHold", minScore:60, holdDays:120}),
  c({slug:"s65_h30",         name:"Score≥65 + 30d",                            grp:"Q-ScoreHold", minScore:65, holdDays:30}),
  c({slug:"s65_h90",         name:"Score≥65 + 90d",                            grp:"Q-ScoreHold", minScore:65, holdDays:90}),
  c({slug:"s75_h45",         name:"Score≥75 + 45d",                            grp:"Q-ScoreHold", minScore:75, holdDays:45}),
  c({slug:"s75_h60",         name:"Score≥75 + 60d",                            grp:"Q-ScoreHold", minScore:75, holdDays:60}),
  c({slug:"s80_h60",         name:"Score≥80 + 60d",                            grp:"Q-ScoreHold", minScore:80, holdDays:60}),

  // R-StopScore → 20 (was 8, +12)
  c({slug:"s55_stop8",       name:"Score≥55 + Stop-8%",                        grp:"R-StopScore", minScore:55, stop:0.08}),
  c({slug:"s60_stop10",      name:"Score≥60 + Stop-10%",                       grp:"R-StopScore", minScore:60, stop:0.10}),
  c({slug:"s60_stop20",      name:"Score≥60 + Stop-20%",                       grp:"R-StopScore", minScore:60, stop:0.20}),
  c({slug:"s65_stop10",      name:"Score≥65 + Stop-10%",                       grp:"R-StopScore", stop:0.10}),
  c({slug:"s65_stop20",      name:"Score≥65 + Stop-20%",                       grp:"R-StopScore", stop:0.20}),
  c({slug:"s70_stop10",      name:"Score≥70 + Stop-10%",                       grp:"R-StopScore", minScore:70, stop:0.10}),
  c({slug:"s70_stop15",      name:"Score≥70 + Stop-15%",                       grp:"R-StopScore", minScore:70, stop:0.15}),
  c({slug:"s70_stop25",      name:"Score≥70 + Stop-25%",                       grp:"R-StopScore", minScore:70, stop:0.25}),
  c({slug:"s75_stop15",      name:"Score≥75 + Stop-15%",                       grp:"R-StopScore", minScore:75, stop:0.15}),
  c({slug:"s80_stop15",      name:"Score≥80 + Stop-15%",                       grp:"R-StopScore", minScore:80, stop:0.15}),
  c({slug:"s80_stop20",      name:"Score≥80 + Stop-20%",                       grp:"R-StopScore", minScore:80, stop:0.20}),
  c({slug:"s85_stop10",      name:"Score≥85 + Stop-10%",                       grp:"R-StopScore", minScore:85, stop:0.10}),

  // S-TPVariant → 20 (was 8, +12)
  c({slug:"tp15_h60",        name:"TP+15% + 60d",                              grp:"S-TPVariant", tp:0.15, holdDays:60}),
  c({slug:"tp20_h45",        name:"TP+20% + 45d",                              grp:"S-TPVariant", tp:0.20, holdDays:45}),
  c({slug:"tp30_s60",        name:"TP+30% + Score≥60",                         grp:"S-TPVariant", tp:0.30, minScore:60}),
  c({slug:"tp35_s70",        name:"TP+35% + Score≥70",                         grp:"S-TPVariant", tp:0.35, minScore:70}),
  c({slug:"tp40_h60",        name:"TP+40% + 60d",                              grp:"S-TPVariant", tp:0.40, holdDays:60}),
  c({slug:"tp60_s65",        name:"TP+60% + Score≥65",                         grp:"S-TPVariant", tp:0.60}),
  c({slug:"tp75_s70",        name:"TP+75% + Score≥70",                         grp:"S-TPVariant", tp:0.75, minScore:70}),
  c({slug:"tp100_h45",       name:"TP+100% + 45d",                             grp:"S-TPVariant", tp:1.00, holdDays:45}),
  c({slug:"tp100_h60",       name:"TP+100% + 60d",                             grp:"S-TPVariant", tp:1.00, holdDays:60}),
  c({slug:"tp150_s75",       name:"TP+150% + Score≥75",                        grp:"S-TPVariant", tp:1.50, minScore:75}),
  c({slug:"tp200_h90",       name:"TP+200% + 90d",                             grp:"S-TPVariant", tp:2.00, holdDays:90}),
  c({slug:"tp300_s80",       name:"TP+300% + Score≥80",                        grp:"S-TPVariant", tp:3.00, minScore:80}),

  // T-SectorRich → 20 (was 8, +12)
  c({slug:"bio_h30",         name:"Biotech + 30d",                             grp:"T-SectorRich", sector:"biotech", holdDays:30}),
  c({slug:"bio_stop10_h60",  name:"Biotech + Stop-10% + 60d",                  grp:"T-SectorRich", sector:"biotech", stop:0.10, holdDays:60}),
  c({slug:"bio_gold1",       name:"Biotech + ≥1 Goud",                         grp:"T-SectorRich", sector:"biotech", minGold:1}),
  c({slug:"bio_lim0",        name:"Biotech + Strikt limiet",                   grp:"T-SectorRich", sector:"biotech", limitBuf:0.00}),
  c({slug:"bio_red_short",   name:"Biotech + Rood + 30d",                      grp:"T-SectorRich", sector:"biotech", redReq:true, minScore:0, holdDays:30}),
  c({slug:"bio_opr_var",     name:"Biotech + Kansrotatie + 4 pos",             grp:"T-SectorRich", sector:"biotech", maxPos:4, posSize:2000, opportunityReplace:true}),
  c({slug:"min_red_s65",     name:"Mining + Rood + Score≥65",                  grp:"T-SectorRich", sector:"mining",  redReq:true}),
  c({slug:"min_gold1_var",   name:"Mining + ≥1 Goud + 90d",                    grp:"T-SectorRich", sector:"mining",  minGold:1, holdDays:90}),
  c({slug:"min_lim0",        name:"Mining + Strikt limiet",                    grp:"T-SectorRich", sector:"mining",  limitBuf:0.00}),
  c({slug:"min_tp25",        name:"Mining + TP+25%",                           grp:"T-SectorRich", sector:"mining",  tp:0.25}),
  c({slug:"min_tp200",       name:"Mining + TP+200%",                          grp:"T-SectorRich", sector:"mining",  tp:2.00}),
  c({slug:"min_opr_var",     name:"Mining + Kansrotatie + trailing -12%",      grp:"T-SectorRich", sector:"mining",  trailingStop:0.12, stop:null, opportunityReplace:true}),

  // U-ConsProfiel → 20 (was 6, +14)
  c({slug:"cons_micro",       name:"Cons. micro (30 pos $250, 90d)",            grp:"U-ConsProfiel", minScore:50, maxPos:30, posSize:250, holdDays:90, stop:0.10}),
  c({slug:"cons_pos18",       name:"Cons. 18 pos $450 + 120d",                  grp:"U-ConsProfiel", minScore:55, maxPos:18, posSize:450, holdDays:120, stop:0.12}),
  c({slug:"cons_pos25",       name:"Cons. 25 pos $300 + 90d",                   grp:"U-ConsProfiel", minScore:55, maxPos:25, posSize:300, holdDays:90, stop:0.12}),
  c({slug:"cons_gold_pos12",  name:"Cons. ≥1 Goud + 12 pos + 120d",             grp:"U-ConsProfiel", minScore:60, minGold:1, maxPos:12, posSize:700, holdDays:120, stop:0.10}),
  c({slug:"cons_gold_pos20",  name:"Cons. ≥1 Goud + 20 pos + 90d",              grp:"U-ConsProfiel", minScore:60, minGold:1, maxPos:20, posSize:400, holdDays:90, stop:0.12}),
  c({slug:"cons_lim0_pos15",  name:"Cons. Strikt limiet + 15 pos",              grp:"U-ConsProfiel", minScore:60, maxPos:15, posSize:500, limitBuf:0.00, holdDays:120, stop:0.10}),
  c({slug:"cons_bio_pos10",   name:"Cons. Biotech + 10 pos + 120d",             grp:"U-ConsProfiel", sector:"biotech", minScore:70, maxPos:10, posSize:800, holdDays:120, stop:0.10}),
  c({slug:"cons_min_pos12",   name:"Cons. Mining + 12 pos + 120d",              grp:"U-ConsProfiel", sector:"mining", minScore:65, maxPos:12, posSize:700, holdDays:120, stop:0.15}),
  c({slug:"cons_div_15p",     name:"Cons. div-rijk + 15 pos + 180d",            grp:"U-ConsProfiel", minScore:55, maxPos:15, posSize:500, holdDays:180, stop:0.15}),
  c({slug:"cons_tp20",        name:"Cons. TP+20% (15 pos)",                     grp:"U-ConsProfiel", minScore:60, maxPos:15, posSize:500, tp:0.20, stop:0.10, holdDays:90}),
  c({slug:"cons_trail10_p15", name:"Cons. Trailing -10% + 15 pos",              grp:"U-ConsProfiel", minScore:60, maxPos:15, posSize:500, trailingStop:0.10, stop:null, holdDays:90}),
  c({slug:"cons_h240",        name:"Cons. 240d hold (geduldig)",                grp:"U-ConsProfiel", minScore:60, maxPos:12, posSize:700, holdDays:240, stop:0.15}),
  c({slug:"cons_h365",        name:"Cons. 365d hold (jaar)",                    grp:"U-ConsProfiel", minScore:65, maxPos:10, posSize:900, holdDays:365, stop:0.20}),
  c({slug:"cons_safe_div",    name:"Cons. veilig + Score≥70 + 10 pos",          grp:"U-ConsProfiel", minScore:70, maxPos:10, posSize:900, holdDays:120, stop:0.08}),

  // V-AggProfiel → 20 (was 6, +14)
  c({slug:"agg_red_3p_20d",  name:"Agg. Rood + 3 pos + 20d + TP+50%",           grp:"V-AggProfiel", minScore:0, redReq:true, maxPos:3, posSize:2500, holdDays:20, tp:0.50, stop:0.20}),
  c({slug:"agg_red_2p_tp100",name:"Agg. Rood + 2 pos + TP+100%",                grp:"V-AggProfiel", minScore:0, redReq:true, maxPos:2, posSize:3500, tp:1.00, stop:0.25}),
  c({slug:"agg_red_4p_30d",  name:"Agg. Rood + 4 pos + 30d + TP+75%",           grp:"V-AggProfiel", minScore:0, redReq:true, maxPos:4, posSize:2000, holdDays:30, tp:0.75, stop:0.20}),
  c({slug:"agg_gold2",       name:"Agg. ≥2 Goud (zeldzame ZWAAR)",              grp:"V-AggProfiel", minGold:2, maxPos:3, posSize:2500, tp:1.00, stop:0.20}),
  c({slug:"agg_gold1_red",   name:"Agg. ≥1 Goud + Rood",                        grp:"V-AggProfiel", minGold:1, redReq:true, maxPos:3, posSize:2500, tp:0.75, stop:0.20}),
  c({slug:"agg_bio_red_2p",  name:"Agg. Biotech + Rood + 2 pos",                grp:"V-AggProfiel", sector:"biotech", redReq:true, minScore:0, maxPos:2, posSize:3500, tp:1.00, stop:0.20}),
  c({slug:"agg_min_red_2p",  name:"Agg. Mining + Rood + 2 pos",                 grp:"V-AggProfiel", sector:"mining",  redReq:true, minScore:0, maxPos:2, posSize:3500, tp:1.00, stop:0.25}),
  c({slug:"agg_trail8_red",  name:"Agg. Trailing -8% + Rood",                   grp:"V-AggProfiel", minScore:0, redReq:true, maxPos:4, posSize:2000, trailingStop:0.08, stop:null}),
  c({slug:"agg_no_lim_red",  name:"Agg. Geen limiet + Rood",                    grp:"V-AggProfiel", minScore:0, redReq:true, maxPos:4, posSize:2000, limitBuf:null, tp:0.75, stop:0.20}),
  c({slug:"agg_lim0_red",    name:"Agg. Strikt limiet + Rood",                  grp:"V-AggProfiel", minScore:0, redReq:true, maxPos:4, posSize:2000, limitBuf:0.00, tp:1.00, stop:0.20}),
  c({slug:"agg_tp200_red",   name:"Agg. Rood + TP+200% (4 pos)",                grp:"V-AggProfiel", minScore:0, redReq:true, maxPos:4, posSize:2000, tp:2.00, stop:0.25}),
  c({slug:"agg_tp300",       name:"Agg. TP+300% (S≥75, 3 pos)",                 grp:"V-AggProfiel", minScore:75, maxPos:3, posSize:2500, tp:3.00, stop:0.25}),
  c({slug:"agg_h20_tp50",    name:"Agg. 20d + TP+50% (S≥70, 4 pos)",            grp:"V-AggProfiel", minScore:70, maxPos:4, posSize:2000, holdDays:20, tp:0.50, stop:0.15}),
  c({slug:"agg_h15_tp75",    name:"Agg. 15d + TP+75% (S≥75, 4 pos)",            grp:"V-AggProfiel", minScore:75, maxPos:4, posSize:2000, holdDays:15, tp:0.75, stop:0.15}),

  // X-Hikkertjes → 20 (was 10, +10)
  c({slug:"hik_s60",         name:"⚡ Hikkertje + S≥60",                         grp:"X-Hikkertjes", minScore:60, holdDays:30, stop:0.20, tp:0.50, requireHikkertje:true}),
  c({slug:"hik_s70",         name:"⚡ Hikkertje + S≥70",                         grp:"X-Hikkertjes", minScore:70, holdDays:30, stop:0.20, tp:0.50, requireHikkertje:true}),
  c({slug:"hik_trail20",     name:"⚡ Hikkertje trailing -20%",                  grp:"X-Hikkertjes", minScore:0, holdDays:60, stop:null, trailingStop:0.20, requireHikkertje:true}),
  c({slug:"hik_tp25",        name:"⚡ Hikkertje + TP+25% (snel cashen)",         grp:"X-Hikkertjes", minScore:0, holdDays:14, stop:0.15, tp:0.25, requireHikkertje:true}),
  c({slug:"hik_tp75",        name:"⚡ Hikkertje + TP+75%",                       grp:"X-Hikkertjes", minScore:0, holdDays:30, stop:0.20, tp:0.75, requireHikkertje:true}),
  c({slug:"hik_min",         name:"⚡ Hikkertje + Mining",                       grp:"X-Hikkertjes", minScore:0, holdDays:30, stop:0.20, tp:0.50, sector:"mining", requireHikkertje:true}),
  c({slug:"hik_gold1",       name:"⚡ Hikkertje + ≥1 Goud",                      grp:"X-Hikkertjes", minScore:0, minGold:1, holdDays:30, stop:0.20, tp:0.50, requireHikkertje:true}),
  c({slug:"hik_h10",         name:"⚡ Hikkertje 10d (heel snel)",                grp:"X-Hikkertjes", minScore:0, holdDays:10, stop:0.15, tp:0.50, requireHikkertje:true}),
  c({slug:"hik_h45_trail",   name:"⚡ Hikkertje + 45d + trailing -12%",          grp:"X-Hikkertjes", minScore:0, holdDays:45, stop:null, trailingStop:0.12, requireHikkertje:true}),
  c({slug:"hik_pos3_xl",     name:"⚡ Hikkertje + 3 pos $2500 + TP+100%",        grp:"X-Hikkertjes", minScore:0, maxPos:3, posSize:2500, holdDays:30, stop:0.20, tp:1.00, requireHikkertje:true}),

  // Y-Zwitserleven → 20 (was 10, +10)
  c({slug:"zwl_60",          name:"🌴 Zwitserleven 60d",                        grp:"Y-Zwitserleven", minScore:0, holdDays:60,  stop:0.15, tp:null, requireZwitserleven:true}),
  c({slug:"zwl_240",         name:"🌴 Zwitserleven 240d",                       grp:"Y-Zwitserleven", minScore:0, holdDays:240, stop:0.25, tp:null, requireZwitserleven:true}),
  c({slug:"zwl_365",         name:"🌴 Zwitserleven 365d (jaar dividend-rit)",   grp:"Y-Zwitserleven", minScore:0, holdDays:365, stop:null, tp:null, requireZwitserleven:true}),
  c({slug:"zwl_trail10",     name:"🌴 Zwitserleven trailing -10%",              grp:"Y-Zwitserleven", minScore:0, holdDays:120, stop:null, trailingStop:0.10, requireZwitserleven:true}),
  c({slug:"zwl_tp100",       name:"🌴 Zwitserleven + TP+100%",                  grp:"Y-Zwitserleven", minScore:0, holdDays:180, stop:0.20, tp:1.00, requireZwitserleven:true}),
  c({slug:"zwl_s50",         name:"🌴 Zwitserleven + Score≥50",                 grp:"Y-Zwitserleven", minScore:50, holdDays:120, stop:0.20, tp:null, requireZwitserleven:true}),
  c({slug:"zwl_s65",         name:"🌴 Zwitserleven + Score≥65",                 grp:"Y-Zwitserleven", minScore:65, holdDays:120, stop:0.20, tp:null, requireZwitserleven:true}),
  c({slug:"zwl_pos20",       name:"🌴 Zwitserleven + 20 pos $400 (zeer gespreid)", grp:"Y-Zwitserleven", minScore:0, maxPos:20, posSize:400, holdDays:120, stop:0.15, tp:null, requireZwitserleven:true}),
  c({slug:"zwl_pos3",        name:"🌴 Zwitserleven + 3 pos $2500 (geconcentreerd)", grp:"Y-Zwitserleven", minScore:0, maxPos:3, posSize:2500, holdDays:180, stop:0.25, tp:null, requireZwitserleven:true}),
  c({slug:"zwl_lim0",        name:"🌴 Zwitserleven + Strikt limiet",            grp:"Y-Zwitserleven", minScore:0, holdDays:120, stop:0.20, tp:null, limitBuf:0.00, requireZwitserleven:true}),

  // Z-HotWarmRotatie → 20 (NIEUW): wekelijkse rebalance op dashboard hot/warm signalen,
  // 70/30 verdeling tussen hot (rood) en warm (oranje). holdDays:7 = positie verloopt
  // automatisch elke week zodat de portefeuille altijd fris is met de huidige signalen.
  c({slug:"hw_basic",        name:"🔥 Hot/Warm wekelijks (70/30, 8 pos)",        grp:"Z-HotWarmRotatie", minScore:0, holdDays:7,  stop:0.15, tp:null, requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_50_50",        name:"🔥 Hot/Warm 50/50",                          grp:"Z-HotWarmRotatie", minScore:0, holdDays:7,  stop:0.15, tp:null, requireHotWarm:true, hotWarmRatio:0.50}),
  c({slug:"hw_80_20",        name:"🔥 Hot/Warm 80/20",                          grp:"Z-HotWarmRotatie", minScore:0, holdDays:7,  stop:0.15, tp:null, requireHotWarm:true, hotWarmRatio:0.80}),
  c({slug:"hw_100_0",        name:"🔥 Hot/Warm 100% hot",                       grp:"Z-HotWarmRotatie", minScore:0, holdDays:7,  stop:0.15, tp:null, requireHotWarm:true, hotWarmRatio:1.00}),
  c({slug:"hw_h14",          name:"🔥 Hot/Warm 2-weken rotatie",                grp:"Z-HotWarmRotatie", minScore:0, holdDays:14, stop:0.15, tp:null, requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_h3",           name:"🔥 Hot/Warm 3d (zeer fris)",                 grp:"Z-HotWarmRotatie", minScore:0, holdDays:3,  stop:0.10, tp:null, requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_h30",          name:"🔥 Hot/Warm maandelijks (30d)",              grp:"Z-HotWarmRotatie", minScore:0, holdDays:30, stop:0.15, tp:null, requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_s60",          name:"🔥 Hot/Warm + Score≥60",                     grp:"Z-HotWarmRotatie", minScore:60, holdDays:7, stop:0.15, tp:null, requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_s70",          name:"🔥 Hot/Warm + Score≥70",                     grp:"Z-HotWarmRotatie", minScore:70, holdDays:7, stop:0.15, tp:null, requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_pos5",         name:"🔥 Hot/Warm 5 pos $1800 (geconcentreerd)",   grp:"Z-HotWarmRotatie", minScore:0,  holdDays:7, stop:0.15, tp:null, maxPos:5, posSize:1800, requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_pos15",        name:"🔥 Hot/Warm 15 pos $600 (gespreid)",         grp:"Z-HotWarmRotatie", minScore:0,  holdDays:7, stop:0.15, tp:null, maxPos:15, posSize:600, requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_tp25",         name:"🔥 Hot/Warm + TP+25%",                       grp:"Z-HotWarmRotatie", minScore:0,  holdDays:7, stop:0.15, tp:0.25, requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_tp50",         name:"🔥 Hot/Warm + TP+50%",                       grp:"Z-HotWarmRotatie", minScore:0,  holdDays:7, stop:0.15, tp:0.50, requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_trail8",       name:"🔥 Hot/Warm trailing -8%",                   grp:"Z-HotWarmRotatie", minScore:0,  holdDays:14, stop:null, trailingStop:0.08, requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_trail12",      name:"🔥 Hot/Warm trailing -12%",                  grp:"Z-HotWarmRotatie", minScore:0,  holdDays:14, stop:null, trailingStop:0.12, requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_bio",          name:"🔥 Hot/Warm Biotech only",                   grp:"Z-HotWarmRotatie", minScore:0,  holdDays:7, stop:0.15, tp:null, sector:"biotech", requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_min",          name:"🔥 Hot/Warm Mining only",                    grp:"Z-HotWarmRotatie", minScore:0,  holdDays:7, stop:0.15, tp:null, sector:"mining",  requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_lim0",         name:"🔥 Hot/Warm + Strikt limiet",                grp:"Z-HotWarmRotatie", minScore:0,  holdDays:7, stop:0.15, tp:null, limitBuf:0.00, requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_gold1",        name:"🔥 Hot/Warm + ≥1 Goud",                      grp:"Z-HotWarmRotatie", minScore:0,  holdDays:7, stop:0.15, tp:null, minGold:1, requireHotWarm:true, hotWarmRatio:0.70}),
  c({slug:"hw_opr",          name:"🔥 Hot/Warm + Kansrotatie",                  grp:"Z-HotWarmRotatie", minScore:0,  holdDays:14, stop:null, trailingStop:0.10, requireHotWarm:true, hotWarmRatio:0.70, opportunityReplace:true}),

  // AA-Poefies → 20 (NIEUW): trade aandelen met poefie-historie (vroegere 125%+
  // explosie binnen 7 dagen). Hypothese: deze aandelen blijven vatbaar voor
  // nieuwe poefie-events. Vooral interessant op of net onder de buy-limit.
  c({slug:"pf_basic",        name:"🎆 Poefie basis (60d, lim+10%)",             grp:"AA-Poefies", minScore:0, holdDays:60, stop:0.20, tp:null, requirePoefie:true}),
  c({slug:"pf_lim0",         name:"🎆 Poefie + Strikt limiet",                  grp:"AA-Poefies", minScore:0, holdDays:60, stop:0.20, tp:null, limitBuf:0.00, requirePoefie:true}),
  c({slug:"pf_lim5",         name:"🎆 Poefie + Buy_limit +5%",                  grp:"AA-Poefies", minScore:0, holdDays:60, stop:0.20, tp:null, limitBuf:0.05, requirePoefie:true}),
  c({slug:"pf_h30",          name:"🎆 Poefie + 30d (snel cashen)",              grp:"AA-Poefies", minScore:0, holdDays:30, stop:0.20, tp:null, requirePoefie:true}),
  c({slug:"pf_h90",          name:"🎆 Poefie + 90d",                            grp:"AA-Poefies", minScore:0, holdDays:90, stop:0.20, tp:null, requirePoefie:true}),
  c({slug:"pf_h120",         name:"🎆 Poefie + 120d (geduldig)",                grp:"AA-Poefies", minScore:0, holdDays:120, stop:0.25, tp:null, requirePoefie:true}),
  c({slug:"pf_tp50",         name:"🎆 Poefie + TP+50%",                         grp:"AA-Poefies", minScore:0, holdDays:60, stop:0.20, tp:0.50, requirePoefie:true}),
  c({slug:"pf_tp100",        name:"🎆 Poefie + TP+100%",                        grp:"AA-Poefies", minScore:0, holdDays:60, stop:0.20, tp:1.00, requirePoefie:true}),
  c({slug:"pf_tp125",        name:"🎆 Poefie + TP+125% (classic poefie)",       grp:"AA-Poefies", minScore:0, holdDays:60, stop:0.20, tp:1.25, requirePoefie:true}),
  c({slug:"pf_tp200",        name:"🎆 Poefie + TP+200%",                        grp:"AA-Poefies", minScore:0, holdDays:90, stop:0.25, tp:2.00, requirePoefie:true}),
  c({slug:"pf_trail10",      name:"🎆 Poefie + trailing -10%",                  grp:"AA-Poefies", minScore:0, holdDays:90, stop:null, trailingStop:0.10, requirePoefie:true}),
  c({slug:"pf_trail15",      name:"🎆 Poefie + trailing -15%",                  grp:"AA-Poefies", minScore:0, holdDays:90, stop:null, trailingStop:0.15, requirePoefie:true}),
  c({slug:"pf_trail20",      name:"🎆 Poefie + trailing -20%",                  grp:"AA-Poefies", minScore:0, holdDays:120, stop:null, trailingStop:0.20, requirePoefie:true}),
  c({slug:"pf_s60",          name:"🎆 Poefie + Score≥60",                       grp:"AA-Poefies", minScore:60, holdDays:60, stop:0.20, tp:null, requirePoefie:true}),
  c({slug:"pf_s70",          name:"🎆 Poefie + Score≥70",                       grp:"AA-Poefies", minScore:70, holdDays:60, stop:0.20, tp:null, requirePoefie:true}),
  c({slug:"pf_red",          name:"🎆 Poefie + Rood signaal",                   grp:"AA-Poefies", minScore:0, redReq:true, holdDays:60, stop:0.20, tp:null, requirePoefie:true}),
  c({slug:"pf_pos3",         name:"🎆 Poefie 3 pos $2500 (geconcentreerd)",     grp:"AA-Poefies", minScore:0, maxPos:3, posSize:2500, holdDays:60, stop:0.20, tp:0.75, requirePoefie:true}),
  c({slug:"pf_pos15",        name:"🎆 Poefie 15 pos $500 (gespreid)",           grp:"AA-Poefies", minScore:0, maxPos:15, posSize:500, holdDays:60, stop:0.20, tp:null, requirePoefie:true}),
  c({slug:"pf_bio",          name:"🎆 Poefie + Biotech only",                   grp:"AA-Poefies", minScore:0, holdDays:60, stop:0.20, tp:null, sector:"biotech", requirePoefie:true}),
  c({slug:"pf_min",          name:"🎆 Poefie + Mining only",                    grp:"AA-Poefies", minScore:0, holdDays:60, stop:0.25, tp:null, sector:"mining",  requirePoefie:true}),
];

// Voeg padding toe aan het hoofd-array. We dedupliceren op slug (idempotent bij
// hercompilatie). Ongebruikte families (al ≥20) blijven onaangetast.
const _seenSlugs = new Set(STRATEGIES.map(s => s.slug));
for (const s of EXTRA_STRATEGIES) {
  if (!_seenSlugs.has(s.slug)) { STRATEGIES.push(s); _seenSlugs.add(s.slug); }
}

// Totaal eindwaarde: ~520 strategieën (200 origineel + 322 nieuw, minus enkele duplicates).
// Iedere familie behalve M-Combo (26) en W-MultiCombo (30) heeft nu precies 20 varianten.

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
interface TickerRow { ticker: string; sector: string | null; goud_score: number | null; buy_limit: number | null; medal_gold: number | null; is_hikkertje: boolean | null; is_poefie: boolean | null; dividend_yield: number | null; }
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
      requireHikkertje: s.requireHikkertje ?? false,
      requireZwitserleven: s.requireZwitserleven ?? false,
      requirePoefie: s.requirePoefie ?? false,
      requireHotWarm: s.requireHotWarm ?? false,
      hotWarmRatio: s.hotWarmRatio ?? null,
    },
  }));
  await sb.from("xinix_strategies").upsert(stratRows, { onConflict: "slug", ignoreDuplicates: false });

  const { data: stratDb } = await sb.from("xinix_strategies").select("id, slug").in("slug", STRATEGIES.map((s) => s.slug));
  const idBySlug = new Map<string, number>();
  for (const r of (stratDb ?? [])) idBySlug.set(r.slug as string, r.id as number);

  const stateRows = STRATEGIES.map((s) => ({ strategy_id: idBySlug.get(s.slug)! })).filter((r) => r.strategy_id != null);
  await sb.from("xinix_strategy_state").upsert(stateRows, { onConflict: "strategy_id", ignoreDuplicates: true });

  // 2. Gedeelde marktdata ophalen
  const [statesRes, openRes, tickersRes, summaryRes, signalsRes, regimeRes, zwitserlevenRes] = await Promise.all([
    sb.from("xinix_strategy_state").select("strategy_id, cash, max_equity, max_drawdown_pct"),
    sb.from("xinix_strategy_positions")
      .select("id, strategy_id, ticker, qty, avg_price, entry_date, scheduled_exit_date, stop_loss_price, take_profit_price, entry_signal_types, partial_exits")
      .is("closed_at", null),
    sb.from("signal_tickers").select("ticker, sector, goud_score, buy_limit, medal_gold, is_hikkertje, is_poefie, dividend_yield").eq("active", true).eq("price_benched", false),
    sb.from("signal_price_summary").select("ticker, last_close"),
    sb.from("signal_events").select("ticker, signal_type, severity")
      .or("expires_at.is.null,expires_at.gt." + now.toISOString())
      .order("detected_at", { ascending: false }).limit(3000),
    sb.from("market_regime").select("is_bull, regime, updated_at").eq("id", 1).maybeSingle(),
    sb.from("zwitserleven_stocks").select("ticker").eq("meets_criteria", true),
  ]);

  // Zwitserleven-set (tickers die aan alle 4 criteria voldoen)
  const zwitserlevenSet = new Set<string>();
  for (const r of (zwitserlevenRes.data ?? [])) zwitserlevenSet.add(r.ticker as string);

  // Dividend per ticker (TTM yield als fractie) — voor approximation van
  // dividend-income op gesloten posities.
  const dividendYieldByTicker = new Map<string, number>();
  for (const t of (tickersRes.data ?? [])) {
    if ((t as TickerRow).dividend_yield != null) dividendYieldByTicker.set(t.ticker as string, Number((t as TickerRow).dividend_yield));
  }

  // Marktregime: 3 staten. Bij ontbrekende/verouderde data (>3d) → standaard strong_bull.
  const regimeRow  = regimeRes.data;
  const regimeAgeD = regimeRow?.updated_at
    ? (now.getTime() - new Date(regimeRow.updated_at).getTime()) / 86400000
    : 999;
  const regime        = regimeAgeD < 3 ? (regimeRow?.regime ?? "strong_bull") : "strong_bull";
  const isBullMarket  = regime !== "bear";
  // weak_bull: 60% positiegrootte (voorzichtig kopen); bear: 0% (geen aankopen)
  const regimePosScale    = regime === "strong_bull" ? 1.0 : regime === "weak_bull" ? 0.6 : 0.0;
  // bear/weak_bull: trailing stop ratchets dichter bij de koers → snellere exit bij verdere daling
  const stopTightenFactor = regime === "strong_bull" ? 1.0 : regime === "weak_bull" ? 0.75 : 0.5;

  const cashByStrategy = new Map<number, number>();
  const maxEquityByStrategy = new Map<number, number>();
  const maxDrawdownByStrategy = new Map<number, number>();
  for (const r of (statesRes.data ?? [])) {
    cashByStrategy.set(r.strategy_id as number, Number(r.cash));
    if (r.max_equity != null) maxEquityByStrategy.set(r.strategy_id as number, Number(r.max_equity));
    if (r.max_drawdown_pct != null) maxDrawdownByStrategy.set(r.strategy_id as number, Number(r.max_drawdown_pct));
  }

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
        // Trailing stop ratchet: in zwakkere markt dichter bij de koers → snellere exit
        if (cfg.trailingStop != null) {
          const effectiveTrail = cfg.trailingStop * stopTightenFactor;
          const ratchet = +(price * (1 - effectiveTrail)).toFixed(price < 1 ? 4 : price < 10 ? 3 : 2);
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
      const holdDays = Math.max(0, Math.round((now.getTime() - new Date(p.entry_date).getTime()) / 86_400_000));

      // Dividend-income approximation: avg_price × dividend_yield × qty × (holdDays/365).
      // Bron: signal_tickers.dividend_yield (TTM yield als fractie). Aanname dat het
      // yield-niveau stabiel was tijdens de hold-periode — voor de meeste large-caps OK.
      const divYield = dividendYieldByTicker.get(p.ticker) ?? 0;
      const dividendIncome = divYield > 0 && holdDays > 0
        ? Number(p.qty) * Number(p.avg_price) * divYield * (holdDays / 365)
        : 0;

      if (prevPartials.length > 0) {
        // Herstel originele qty voor juiste return-berekening
        const origQty = Number(p.qty) + prevPartials.reduce((s, pe) => s + pe.qty_sold, 0);
        const origCost = origQty * Number(p.avg_price) * (1 + TX_COST);
        const partialProc = prevPartials.reduce((s, pe) => s + pe.net_proceeds, 0);
        netProceeds = Number(p.qty) * price * (1 - TX_COST);
        retUsd = partialProc + netProceeds + dividendIncome - origCost;
        retPct = origCost > 0 ? (retUsd / origCost) * 100 : 0;
      } else {
        netProceeds = Number(p.qty) * price * (1 - TX_COST);
        const cost = Number(p.qty) * Number(p.avg_price) * (1 + TX_COST);
        retUsd = netProceeds + dividendIncome - cost;
        retPct = cost > 0 ? (retUsd / cost) * 100 : 0;
      }
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
        if (cfg.requireHikkertje && !t.is_hikkertje) continue;
        if (cfg.requireZwitserleven && !zwitserlevenSet.has(t.ticker)) continue;
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
          const holdDays = Math.max(0, Math.round((now.getTime() - new Date(worstPos.entry_date).getTime()) / 86_400_000));
          // Dividend-income (zie hoofdsluiting voor toelichting).
          const divYield = dividendYieldByTicker.get(worstPos.ticker) ?? 0;
          const dividendIncome = divYield > 0 && holdDays > 0
            ? Number(worstPos.qty) * Number(worstPos.avg_price) * divYield * (holdDays / 365)
            : 0;
          if (prevPartials.length > 0) {
            const origQty = Number(worstPos.qty) + prevPartials.reduce((s, pe) => s + pe.qty_sold, 0);
            const origCost = origQty * Number(worstPos.avg_price) * (1 + TX_COST);
            const partialProc = prevPartials.reduce((s, pe) => s + pe.net_proceeds, 0);
            netProceeds = Number(worstPos.qty) * price * (1 - TX_COST);
            retUsd = partialProc + netProceeds + dividendIncome - origCost;
            retPct = origCost > 0 ? (retUsd / origCost) * 100 : 0;
          } else {
            netProceeds = Number(worstPos.qty) * price * (1 - TX_COST);
            const cost = Number(worstPos.qty) * Number(worstPos.avg_price) * (1 + TX_COST);
            retUsd = netProceeds + dividendIncome - cost;
            retPct = cost > 0 ? (retUsd / cost) * 100 : 0;
          }
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
    const slotsAvailable    = Math.max(0, cfg.maxPos - stillOpenTickers.size);
    const effectivePosSize  = Math.round(cfg.posSize * regimePosScale);
    if (slotsAvailable > 0 && cash - effectivePosSize >= 200 && isBullMarket) {
      const candidates: Array<{
        ticker: string; price: number; score: number; rankScore: number;
        sector: string | null; signals: SigRow[]; reason: string;
      }> = [];

      for (const t of tickers) {
        if (stillOpenTickers.has(t.ticker)) continue;
        if (cfg.sector !== "all" && t.sector !== cfg.sector) continue;
        if ((t.medal_gold ?? 0) < cfg.minGold) continue;
        if (cfg.requireHikkertje && !t.is_hikkertje) continue;
        if (cfg.requireZwitserleven && !zwitserlevenSet.has(t.ticker)) continue;
        if (cfg.requirePoefie && !t.is_poefie) continue;
        const price = priceMap.get(t.ticker);
        if (price == null || price <= 0) continue;
        const score = t.goud_score ?? 0;
        const sigs = sigsByTicker.get(t.ticker) ?? [];
        const positiveSigs = sigs.filter((s) => POS_SIGNALS.has(s.signal_type));
        const hasRed = positiveSigs.some((s) => s.severity === "red");
        const hasOrange = positiveSigs.some((s) => s.severity === "orange");
        if (cfg.requireHotWarm && !hasRed && !hasOrange) continue;
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

      // Hot/Warm rotatie-familie: reserveer een vast deel van de slots voor hot
      // (tickers met rood positief signaal) en de rest voor warm (oranje, geen rood).
      // Standaard 70/30. Hot wint van nature al door rankScore-bonus van rood, maar
      // deze split garandeert ook bij overschot aan hot dat warm aan bod komt.
      const isHotWarmFamily = cfg.requireHotWarm === true;
      const hotRatio = cfg.hotWarmRatio ?? 0.70;
      const targetHotSlots  = isHotWarmFamily ? Math.round(slotsAvailable * hotRatio) : slotsAvailable;
      const targetWarmSlots = isHotWarmFamily ? slotsAvailable - targetHotSlots : 0;
      let hotBought = 0;
      let warmBought = 0;
      function candKind(c: typeof candidates[number]): "hot" | "warm" {
        return c.signals.some(s => s.severity === "red") ? "hot" : "warm";
      }

      let bought = 0;
      for (const cand of candidates) {
        if (bought >= slotsAvailable) break;
        if (isHotWarmFamily) {
          const kind = candKind(cand);
          if (kind === "hot"  && hotBought  >= targetHotSlots)  continue;
          if (kind === "warm" && warmBought >= targetWarmSlots) continue;
        }
        const buyCost = effectivePosSize; // geschaald op marktregime
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
        if (isHotWarmFamily) {
          if (candKind(cand) === "hot") hotBought++; else warmBought++;
        }
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

    // Drawdown-tracking: houdt het hoogste punt bij en berekent de max. terugval
    const prevMaxEquity  = maxEquityByStrategy.get(sid) ?? totalEquity;
    const newMaxEquity   = Math.max(totalEquity, prevMaxEquity);
    const ddFromPeak     = newMaxEquity > 0 ? ((newMaxEquity - totalEquity) / newMaxEquity) * 100 : 0;
    const newMaxDrawdown = Math.max(ddFromPeak, maxDrawdownByStrategy.get(sid) ?? 0);

    stateUpdates.push({ strategy_id: sid, cash, last_run_at: now.toISOString(), max_equity: +newMaxEquity.toFixed(4), max_drawdown_pct: +newMaxDrawdown.toFixed(4) });
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
    message: `${STRATEGIES.length} strategieën: ${exits.length} exits (incl. ${partialSells.length} deelwinst), ${buys.length} aankopen, ${stopRatchets.length} stop-ratchets [regime: ${regime}]`,
    metrics: { strategies: STRATEGIES.length, exits: exits.length, partial_sells: partialSells.length, buys: buys.length, stop_ratchets: stopRatchets.length, equity_rows: equityRows.length, regime },
  });

  return { ok: true, strategies: STRATEGIES.length, exits: exits.length, partial_sells: partialSells.length, buys: buys.length, stop_ratchets: stopRatchets.length };
}
