// Bewerkbaar aankooplimiet-veld voor in een tabelcel of tegel. Zelfstandig:
// houdt z'n eigen bewerk- en opslag-state bij en schrijft direct naar de DB.
// Niet-admins zien het veld read-only.
import { useEffect, useState } from "react";
import { patchTicker, getToken } from "../api";

function fmtLimit(v: number): string {
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}

export function EditableLimit({
  ticker,
  buyLimit,
  compact = false,
}: {
  ticker: string;
  buyLimit: number | null;
  compact?: boolean;
}) {
  const isAdmin = !!getToken();
  const [value, setValue] = useState<number | null>(buyLimit);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Sync wanneer de bovenliggende data ververst.
  useEffect(() => {
    setValue(buyLimit);
  }, [buyLimit]);

  function start() {
    if (!isAdmin) return;
    setDraft(value != null ? String(value) : "");
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setDraft("");
  }
  async function commit() {
    const trimmed = draft.trim();
    let next: number | null;
    if (trimmed === "") {
      next = null;
    } else {
      const parsed = Number(trimmed.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0) {
        setEditing(false);
        return;
      }
      next = parsed;
    }
    setEditing(false);
    const prev = value;
    setValue(next); // optimistisch
    setSaving(true);
    try {
      await patchTicker(ticker, { buy_limit: next });
    } catch (err) {
      console.error("save buy_limit failed", err);
      setValue(prev); // rollback
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") cancel();
        }}
        className={
          (compact ? "w-16 text-[10px]" : "w-20 text-xs") +
          " px-1.5 py-0.5 rounded bg-ink-3 border border-fog-lime text-right font-mono text-neutral-100 focus:outline-none"
        }
      />
    );
  }

  const label = saving
    ? "…"
    : value != null
    ? compact
      ? `lim ${fmtLimit(value)}`
      : fmtLimit(value)
    : compact
    ? "+ limiet"
    : "+";

  return (
    <button
      type="button"
      onClick={start}
      disabled={!isAdmin}
      className={
        "rounded font-mono tabular-nums transition-colors " +
        (compact ? "text-[10px] px-1 py-0.5" : "text-xs px-1.5 py-0.5") +
        " " +
        (isAdmin ? "hover:bg-ink-3 cursor-pointer" : "cursor-default") +
        " " +
        (value != null ? "text-neutral-200" : "text-neutral-600")
      }
      title={isAdmin ? "Klik om de aankooplimiet aan te passen" : "Login vereist"}
    >
      {label}
    </button>
  );
}
