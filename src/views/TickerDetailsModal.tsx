import { useState } from "react";
import type { Card } from "../types";
import { patchTicker } from "../api";
import { googleFinanceUrl } from "../tickerLinks";

interface Props {
  card: Card;
  onClose: () => void;
  onSaved: () => void;
}

type FieldType = "number" | "text" | "boolean" | "select";
interface Field {
  key: keyof Card;
  label: string;
  type: FieldType;
  options?: string[];
  hint?: string;
}

const SHARED_FIELDS: Field[] = [
  { key: "market_cap_usd", label: "Market cap (USD)", type: "number" },
  {
    key: "cash_runway_months",
    label: "Runway (maanden)",
    type: "number",
    hint: "Briefing §2.3: 18+ mnd is sweet spot voor biotech",
  },
  {
    key: "insider_ownership_pct",
    label: "Insider ownership (0–1)",
    type: "number",
    hint: "0.10 t/m 0.30 = sweet spot",
  },
  {
    key: "pre_event_ytd_return_pct",
    label: "Pre-event YTD return (1.55 = +155%)",
    type: "number",
    hint: "Briefing §6.1.2: ≥1.5 = sell-the-news AVOID",
  },
  {
    key: "share_count_millions",
    label: "Shares outstanding (M)",
    type: "number",
  },
  { key: "notes", label: "Notes", type: "text" },
];

const BIOTECH_FIELDS: Field[] = [
  {
    key: "trial_patient_population_severity",
    label: "Patient population severity",
    type: "select",
    options: ["", "early", "moderate", "late"],
    hint: "ETNB F2-F3 = early; AKRO F4 = late (briefing §5.4 paar 1)",
  },
  {
    key: "trial_endpoint_duration_weeks",
    label: "Endpoint duration (wks)",
    type: "number",
    hint: "24w = beter dan 36w bij progressieve disease",
  },
  {
    key: "primary_endpoint_powered_for_subgroup",
    label: "Powered op subgroup only?",
    type: "boolean",
    hint: "TRUE = AKRO-style rode vlag (-0.20 penalty)",
  },
  {
    key: "mechanism_has_clinical_precedent",
    label: "Mechanism heeft klinisch precedent?",
    type: "boolean",
  },
  { key: "prior_crl_count", label: "Prior CRL count", type: "number" },
  {
    key: "label_narrowed_after_crl",
    label: "Label narrowed na CRL?",
    type: "boolean",
    hint: "TRUE = AKBA-style smart strategy",
  },
  {
    key: "has_ex_us_safety_dataset",
    label: "Heeft ex-US safety dataset?",
    type: "boolean",
  },
  {
    key: "fda_advisory_committee_outcome",
    label: "AdCom outcome",
    type: "select",
    options: ["", "positive", "negative", "none", "pending"],
  },
  { key: "trial_size_n", label: "Trial size (n)", type: "number" },
  {
    key: "competitor_failures_in_target",
    label: "Competitor failures bij target",
    type: "number",
  },
  {
    key: "has_breakthrough_designation",
    label: "Breakthrough designation",
    type: "boolean",
  },
  { key: "has_fast_track", label: "Fast Track", type: "boolean" },
  { key: "has_orphan_drug", label: "Orphan Drug", type: "boolean" },
  { key: "first_in_class", label: "First-in-class", type: "boolean" },
  { key: "best_in_class", label: "Best-in-class", type: "boolean" },
];

const MINING_FIELDS: Field[] = [
  {
    key: "geological_anomaly",
    label: "Geological anomaly",
    type: "select",
    options: ["", "dual_grav_mag", "single_signal", "nearology", "none"],
    hint: "WA1 (dual) +500%, LYN (single) -50% (briefing §5.4 paar 3)",
  },
  { key: "cover_depth_meters", label: "Cover depth (m)", type: "number" },
  {
    key: "prior_geophysics_spend_usd",
    label: "Prior geophysics spend (USD)",
    type: "number",
  },
  {
    key: "processing_tech",
    label: "Processing technology",
    type: "select",
    options: ["", "proven_conventional", "unproven_dle", "unproven_other"],
    hint: "PMET (conventional) vs LKE (Lilac DLE) — briefing §5.4 paar 4",
  },
  {
    key: "operational_status",
    label: "Operational status",
    type: "select",
    options: ["", "operational", "construction", "pre_development"],
    hint: "UAMY operational +3800%, PPTA pre-dev +19% (briefing §5.4 paar 5)",
  },
  {
    key: "promoter_concentration_pct",
    label: "Promoter concentration (0-1)",
    type: "number",
  },
  {
    key: "has_strategic_backer",
    label: "Strategic backer aanwezig?",
    type: "boolean",
    hint: "Albemarle/CATL/etc.",
  },
  {
    key: "strategic_backer_tier",
    label: "Backer tier (1 of 2)",
    type: "number",
  },
];

export function TickerDetailsModal({ card, onClose, onSaved }: Props) {
  const [form, setForm] = useState<Record<string, unknown>>({
    ...Object.fromEntries(
      [...SHARED_FIELDS, ...BIOTECH_FIELDS, ...MINING_FIELDS].map((f) => [
        f.key,
        card[f.key] ?? "",
      ])
    ),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields =
    card.sector === "biotech"
      ? [...SHARED_FIELDS, ...BIOTECH_FIELDS]
      : [...SHARED_FIELDS, ...MINING_FIELDS];

  function setField(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function isFilled(v: unknown): boolean {
    return v !== "" && v != null;
  }
  const groupCounts = {
    shared: {
      total: SHARED_FIELDS.length,
      filled: SHARED_FIELDS.filter((f) => isFilled(form[f.key as string]))
        .length,
    },
    sector: {
      total:
        card.sector === "biotech" ? BIOTECH_FIELDS.length : MINING_FIELDS.length,
      filled: (card.sector === "biotech" ? BIOTECH_FIELDS : MINING_FIELDS).filter(
        (f) => isFilled(form[f.key as string])
      ).length,
    },
  };
  const totalFilled = groupCounts.shared.filled + groupCounts.sector.filled;
  const totalFields = groupCounts.shared.total + groupCounts.sector.total;
  const overallPct = totalFields ? totalFilled / totalFields : 0;
  function light(filled: number, total: number): string {
    const r = total ? filled / total : 0;
    if (r >= 0.7) return "bg-fog-lime";
    if (r >= 0.4) return "bg-fog-warn";
    return "bg-fog-loss";
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Strip empty strings → null
      const payload: Record<string, unknown> = {};
      for (const f of fields) {
        const v = form[f.key as string];
        if (v === "" || v == null) payload[f.key as string] = null;
        else if (f.type === "number") payload[f.key as string] = Number(v);
        else if (f.type === "boolean")
          payload[f.key as string] =
            v === true || v === "true" ? true : v === false || v === "false" ? false : null;
        else payload[f.key as string] = v;
      }
      await patchTicker(card.ticker, payload);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 animate-fade-up">
      <div className="bg-ink-2 border border-ink-5 rounded-2xl max-w-3xl w-full my-8 shadow-glow">
        <div className="p-5 border-b border-ink-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-3">
              <a
                href={googleFinanceUrl(card.ticker, card.exchange)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-fog-pink hover:underline"
                title={`Open ${card.ticker} op Google Finance`}
              >
                {card.ticker}
              </a>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md border border-ink-6 text-neutral-400">
                {card.sector}
              </span>
            </h2>
            <p className="text-xs text-neutral-500 mt-1">
              {card.company} · pre‑event details (briefing v1.1)
            </p>
            <div className="mt-2 flex items-center gap-3 text-[11px]">
              <span className="text-neutral-500 uppercase tracking-wider font-bold text-[10px]">
                Compleetheid
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${light(
                    groupCounts.shared.filled,
                    groupCounts.shared.total
                  )}`}
                />
                <span className="text-neutral-300 tabular">
                  shared {groupCounts.shared.filled}/{groupCounts.shared.total}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${light(
                    groupCounts.sector.filled,
                    groupCounts.sector.total
                  )}`}
                />
                <span className="text-neutral-300 tabular">
                  {card.sector} {groupCounts.sector.filled}/
                  {groupCounts.sector.total}
                </span>
              </span>
              <span className="text-fog-pink font-bold tabular">
                {(overallPct * 100).toFixed(0)}%
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg hover:bg-ink-3 text-neutral-400 hover:text-fog-pink transition flex items-center justify-center"
            title="Sluiten"
          >
            ✕
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {fields.map((f) => (
            <div key={f.key as string} className="space-y-1">
              <label className="block text-[10px] uppercase tracking-wider font-bold text-neutral-500">
                {f.label}
                {f.hint && (
                  <span className="block text-[10px] normal-case tracking-normal text-neutral-400 font-normal mt-0.5">
                    {f.hint}
                  </span>
                )}
              </label>
              {f.type === "boolean" ? (
                <select
                  value={
                    form[f.key as string] === true
                      ? "true"
                      : form[f.key as string] === false
                      ? "false"
                      : ""
                  }
                  onChange={(e) =>
                    setField(
                      f.key as string,
                      e.target.value === "" ? "" : e.target.value === "true"
                    )
                  }
                  className="w-full h-9 px-2.5 rounded-lg"
                >
                  <option value="">— onbekend —</option>
                  <option value="true">ja</option>
                  <option value="false">nee</option>
                </select>
              ) : f.type === "select" ? (
                <select
                  value={(form[f.key as string] ?? "") as string}
                  onChange={(e) => setField(f.key as string, e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg"
                >
                  {f.options!.map((o) => (
                    <option key={o} value={o}>
                      {o || "— onbekend —"}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === "number" ? "number" : "text"}
                  step="any"
                  value={(form[f.key as string] ?? "") as string | number}
                  onChange={(e) => setField(f.key as string, e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg font-mono"
                />
              )}
            </div>
          ))}
        </div>

        {error && (
          <div className="mx-5 mb-2 rounded-lg border border-fog-loss/40 bg-fog-loss/10 p-2 text-sm text-fog-loss">
            {error}
          </div>
        )}

        <div className="p-5 border-t border-ink-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-9 px-4 text-sm rounded-lg border border-ink-5 text-neutral-300 hover:bg-ink-3"
          >
            Annuleer
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="h-9 px-5 text-sm rounded-lg bg-fog-pink hover:bg-fog-pink-soft text-black font-bold disabled:opacity-40 shadow-glow"
          >
            {busy ? "Bezig..." : "Opslaan"}
          </button>
        </div>
      </div>
    </div>
  );
}
