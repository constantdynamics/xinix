// Gedeeld kolom-systeem voor alle tabel-tabs: kies welke kolommen zichtbaar
// zijn én in welke volgorde. De keuze wordt per tab server-side bewaard
// (ui_settings) zodat ze over devices synchroniseert.

import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { getToken, type TableColumnPref } from "../api";
import { saveTableColumns, useUiSettings } from "../hooks/useUiSettings";
import { Button } from "./ui";

export interface ColumnMeta {
  key: string;
  label: string;
}

// Bepaal de effectieve kolomvolgorde + verborgen-set uit de opgeslagen
// voorkeur. Onbekende keys worden genegeerd; kolommen die nog niet in de
// opgeslagen volgorde staan komen achteraan. De locked-kolom staat altijd
// vooraan en is nooit verborgen.
export function resolveColumnOrder(
  defined: ColumnMeta[],
  pref: TableColumnPref | undefined,
  lockedKey?: string,
): { order: string[]; hidden: Set<string> } {
  const valid = new Set(defined.map((c) => c.key));
  const saved = (pref?.order ?? []).filter((k) => valid.has(k));
  const missing = defined.map((c) => c.key).filter((k) => !saved.includes(k));
  let order = [...saved, ...missing];
  const hidden = new Set((pref?.hidden ?? []).filter((k) => valid.has(k)));
  if (lockedKey && valid.has(lockedKey)) {
    hidden.delete(lockedKey);
    order = [lockedKey, ...order.filter((k) => k !== lockedKey)];
  }
  return { order, hidden };
}

// Hook voor tabel-views: geeft de zichtbare kolom-keys in de gekozen volgorde.
export function useColumnLayout(
  tabKey: string,
  defined: ColumnMeta[],
  lockedKey?: string,
): { visibleKeys: string[] } {
  const { settings } = useUiSettings();
  return useMemo(() => {
    const pref = settings?.table_columns?.[tabKey];
    const { order, hidden } = resolveColumnOrder(defined, pref, lockedKey);
    return { visibleKeys: order.filter((k) => !hidden.has(k)) };
  }, [settings, tabKey, defined, lockedKey]);
}

// Knop + uitklap-paneel waarmee de gebruiker kolommen toont/verbergt en
// herordent (drag-and-drop). Opslaan vereist een admin-token.
export function ColumnPicker({
  tabKey,
  columns,
  lockedKey,
  className,
}: {
  tabKey: string;
  columns: ColumnMeta[];
  lockedKey?: string;
  className?: string;
}) {
  const { settings } = useUiSettings();
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const labelOf = (k: string) => columns.find((c) => c.key === k)?.label ?? k;

  function openPanel() {
    const { order: o, hidden: h } = resolveColumnOrder(columns, settings?.table_columns?.[tabKey], lockedKey);
    setOrder(o);
    setHidden(h);
    setMsg(null);
    setOpen(true);
  }

  // Sluit het paneel bij een klik erbuiten.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function toggleHidden(key: string) {
    if (key === lockedKey) return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function onDragOver(e: DragEvent, overKey: string) {
    if (!dragKey || dragKey === overKey) return;
    if (dragKey === lockedKey || overKey === lockedKey) return;
    e.preventDefault();
    setOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(dragKey);
      const to = next.indexOf(overKey);
      if (from < 0 || to < 0) return prev;
      next.splice(from, 1);
      next.splice(to, 0, dragKey);
      return next;
    });
  }

  async function save() {
    if (!getToken()) {
      setMsg("Admin-token nodig om op te slaan.");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await saveTableColumns(tabKey, { order, hidden: [...hidden] });
      setMsg("Opgeslagen.");
      setTimeout(() => setOpen(false), 700);
    } catch (e) {
      setMsg(`Fout: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setOrder(columns.map((c) => c.key));
    setHidden(new Set());
  }

  const visibleCount = order.filter((k) => !hidden.has(k)).length;

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <Button size="sm" variant="secondary" onClick={() => (open ? setOpen(false) : openPanel())}>
        ⚙ Kolommen
      </Button>
      {open && (
        <div className="absolute right-0 mt-1 z-30 w-72 rounded-lg border border-ink-5 bg-ink-1 shadow-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-neutral-200">Kolommen</span>
            <span className="text-[10px] text-neutral-500">{visibleCount}/{order.length} zichtbaar</span>
          </div>
          <div className="text-[10px] text-neutral-500 leading-snug">
            Sleep met ⋮⋮ om te herordenen, vink uit om te verbergen.
          </div>
          <div className="space-y-1 max-h-[50vh] overflow-y-auto">
            {order.map((key) => {
              const isLocked = key === lockedKey;
              const isHidden = hidden.has(key);
              const isDragging = dragKey === key;
              return (
                <div
                  key={key}
                  draggable={!isLocked}
                  onDragStart={() => { if (!isLocked) setDragKey(key); }}
                  onDragOver={(e) => onDragOver(e, key)}
                  onDragEnd={() => setDragKey(null)}
                  onDrop={(e) => e.preventDefault()}
                  className={`flex items-center gap-2 px-1.5 py-1 rounded border text-xs transition-colors ${
                    isDragging
                      ? "border-fog-lime bg-fog-lime/10 opacity-50"
                      : isHidden
                      ? "border-ink-5 bg-ink-2/30 opacity-60"
                      : "border-ink-5 bg-ink-2/40"
                  }`}
                >
                  <span
                    className={isLocked ? "text-neutral-700 px-0.5 select-none" : "cursor-grab text-neutral-500 px-0.5 select-none"}
                    title={isLocked ? "Vaste kolom" : "Slepen om te verplaatsen"}
                  >
                    ⋮⋮
                  </span>
                  <label className="flex items-center gap-1.5 flex-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      disabled={isLocked}
                      onChange={() => toggleHidden(key)}
                      className="accent-fog-lime"
                    />
                    <span className="text-neutral-200">{labelOf(key)}</span>
                  </label>
                  {isLocked && <span className="text-[9px] uppercase text-neutral-600 font-bold">vast</span>}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 pt-2 border-t border-ink-5">
            <Button size="sm" variant="primary" onClick={save} disabled={saving}>
              {saving ? "Opslaan…" : "Opslaan"}
            </Button>
            <Button size="sm" variant="ghost" onClick={reset} disabled={saving}>
              Reset
            </Button>
            {msg && (
              <span className={`text-[10px] ${msg.startsWith("Fout") || msg.startsWith("Admin") ? "text-fog-loss" : "text-fog-lime"}`}>
                {msg}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
