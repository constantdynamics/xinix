// Breedte-schakelaar: kiest per tabblad hoe breed de pagina mag worden.
// 'normaal' is de oude 1280px, 'breed' geeft ruimte aan extra kolommen en
// 'vol' gebruikt de volle schermbreedte. De keuze wordt server-side bewaard
// (ui_settings.tab_width) zodat 'ie over devices meegaat.

import { useState } from "react";
import { getToken, type TabWidth } from "../api";
import { saveTabWidth, useTabWidth } from "../hooks/useUiSettings";

const OPTIES: Array<{ value: TabWidth; label: string; title: string }> = [
  { value: "normaal", label: "▯", title: "Normaal (1280px)" },
  { value: "breed", label: "▭", title: "Breed (1800px) — meer kolommen" },
  { value: "vol", label: "▬", title: "Volledige schermbreedte" },
];

export function WidthPicker({ tabKey, className }: { tabKey: string; className?: string }) {
  const current = useTabWidth(tabKey);
  const [saving, setSaving] = useState(false);
  const isAdmin = !!getToken();
  if (!isAdmin) return null;

  async function pick(w: TabWidth) {
    if (w === current || saving) return;
    setSaving(true);
    try {
      await saveTabWidth(tabKey, w);
    } catch (err) {
      console.error("saveTabWidth failed", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`inline-flex items-center rounded-pill border border-ink-5 overflow-hidden ${className ?? ""}`}
      title="Paginabreedte voor dit tabblad"
    >
      {OPTIES.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => pick(o.value)}
          disabled={saving}
          title={o.title}
          className={
            "px-2 py-0.5 text-[11px] leading-5 transition-colors " +
            (current === o.value
              ? "bg-fog-lime text-black font-bold"
              : "text-neutral-500 hover:text-neutral-200 hover:bg-ink-3")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
