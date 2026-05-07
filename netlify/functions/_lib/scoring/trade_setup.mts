// Briefing §4.4 + §10.1: in trader mode produceert elke BUY/STRONG_BUY een
// TradeSetup met entry, target, stop, R:R, position size, max_hold, exits.
// Maakt het signaal actionable — owner heeft een plan voor entry, niet
// alleen een "koop dit" label.
//
// Per briefing §C.3: een STRONG_BUY label is een TRIGGER VOOR ONDERZOEK,
// geen trade order. TradeSetup biedt het kader; de owner doet de
// fine-grained check (clinicaltrials.gov, persberichten) voor entry.

export interface TradeSetup {
  entry: number;          // current price (laatste close)
  target: number;         // peak target
  stop: number;           // hard stop
  rr: number;             // (target - entry) / (entry - stop)
  positionSizeUsd: number; // 1% account risk default
  maxHoldDays: number;    // tot catalyst + 7d cushion
  exits: ExitRule[];
  notes: string[];
}

export interface ExitRule {
  trigger: string;
  detail: string;
}

const DEFAULT_ACCOUNT_USD = 10_000;
const DEFAULT_RISK_PER_TRADE_PCT = 0.01; // 1%
const MIN_RR = 3.0;

// Peak return verwachting per catalyst type — uit briefing §6.1.6
// PEER_PEAK_RETURNS. Dit zijn medians over historische winners; gebruikt
// als realistisch peak target. Conservatiever dan in v1.1 omdat we nog
// geen forward returns hebben (briefing §9.7 survivorship bias).
const PEAK_TARGET_BY_CATALYST: Record<string, number> = {
  // biotech
  phase_3_readout: 1.5,         // 150%
  fda_pdufa_pending: 1.0,       // 100%
  phase_2b_readout: 0.8,
  phase_2_readout: 0.5,
  ema_chmp_pending: 0.6,
  // mining
  drilling_tier1_in_progress: 2.5,  // 250% — PMET/WA1 ballpark
  drilling_results_pending: 1.5,
  resource_estimate_maiden_pending: 1.0,
  permit_decision_tier1_pending: 0.6,
  china_export_shock: 2.0,
  // generic fallback
  generic: 0.6,
};

// Stop loss als % onder entry per catalyst type. Mining is volatieler dus
// wider stop. Briefing §C.3 + §9.10: stop te krap = vroeg uitgestopt op noise.
const STOP_PCT_BY_CATALYST: Record<string, number> = {
  phase_3_readout: 0.18,
  fda_pdufa_pending: 0.15,
  phase_2b_readout: 0.20,
  phase_2_readout: 0.20,
  ema_chmp_pending: 0.15,
  drilling_tier1_in_progress: 0.25,
  drilling_results_pending: 0.22,
  resource_estimate_maiden_pending: 0.20,
  permit_decision_tier1_pending: 0.18,
  china_export_shock: 0.30,
  generic: 0.20,
};

export interface TradeSetupInput {
  currentPrice: number;
  catalystType: string | null;
  daysUntilCatalyst: number | null;
  finalScore: number;
  sector: "biotech" | "mining";
  accountUsd?: number;
}

export function buildTradeSetup(
  input: TradeSetupInput
): TradeSetup | null {
  if (!input.currentPrice || input.currentPrice <= 0) return null;

  const catType = input.catalystType ?? "generic";
  const peakRet =
    PEAK_TARGET_BY_CATALYST[catType] ?? PEAK_TARGET_BY_CATALYST.generic;
  const stopPct =
    STOP_PCT_BY_CATALYST[catType] ?? STOP_PCT_BY_CATALYST.generic;

  const entry = input.currentPrice;
  const target = +(entry * (1 + peakRet)).toFixed(4);
  const stop = +(entry * (1 - stopPct)).toFixed(4);

  const reward = target - entry;
  const risk = entry - stop;
  const rr = risk > 0 ? +(reward / risk).toFixed(2) : 0;

  // Position size: 1% account risk / risk-per-share
  const account = input.accountUsd ?? DEFAULT_ACCOUNT_USD;
  const dollarRisk = account * DEFAULT_RISK_PER_TRADE_PCT;
  const shares = risk > 0 ? Math.floor(dollarRisk / risk) : 0;
  const positionSizeUsd = +(shares * entry).toFixed(2);

  // Max hold: tot catalyst + 7 dagen cushion. Als geen datum, 60 dagen.
  const maxHoldDays =
    input.daysUntilCatalyst != null
      ? Math.max(7, input.daysUntilCatalyst + 7)
      : 60;

  const exits: ExitRule[] = [
    { trigger: "target_hit", detail: `Verkoop bij $${target} (+${(peakRet * 100).toFixed(0)}%)` },
    { trigger: "stop_hit", detail: `Hard stop bij $${stop} (-${(stopPct * 100).toFixed(0)}%)` },
    {
      trigger: "catalyst_passed_no_pump",
      detail: `Als catalyst voorbij is en prijs binnen ±5% van entry: exit.`,
    },
    {
      trigger: "volume_collapse",
      detail: "Als 5-dag volume <50% van 50d-avg: trim of exit.",
    },
  ];
  if (input.sector === "biotech") {
    exits.push({
      trigger: "sell_the_news",
      detail:
        "Bij positieve readout en spike >100%: trail stop op 50% van piek, niet vasthouden voor T+90.",
    });
  }

  const notes: string[] = [];
  if (rr < MIN_RR) {
    notes.push(
      `R:R = ${rr} < ${MIN_RR} minimum — overweeg target hoger of entry afwachten.`
    );
  }
  if (input.daysUntilCatalyst != null && input.daysUntilCatalyst < 5) {
    notes.push(
      "Catalyst < 5 dagen weg — overweeg helft positie voor en helft na."
    );
  }
  if (input.finalScore < 0.55) {
    notes.push(
      `Final score ${input.finalScore.toFixed(2)} onder BUY drempel (0.55) — alleen voor experimenteel.`
    );
  }

  return { entry, target, stop, rr, positionSizeUsd, maxHoldDays, exits, notes };
}
