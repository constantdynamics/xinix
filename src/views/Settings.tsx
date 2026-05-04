import { useEffect, useState } from "react";
import { fetchSettings, saveSettings } from "../api";
import type { Settings, Severity } from "../types";

export function SettingsView() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings()
      .then(setS)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function save() {
    if (!s) return;
    try {
      await saveSettings(s);
      setMsg("Opgeslagen");
      setTimeout(() => setMsg(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (error) return <div className="text-red-400">Fout: {error}</div>;
  if (!s) return <div className="text-slate-400">Laden...</div>;

  return (
    <div className="max-w-2xl space-y-4 bg-slate-900 border border-slate-800 rounded p-4">
      <h2 className="text-lg font-semibold">Alert instellingen</h2>

      <Field label="E-mail (Resend stuurt naar dit adres)">
        <input
          type="email"
          value={s.email ?? ""}
          onChange={(e) => setS({ ...s, email: e.target.value })}
          className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          placeholder="jij@voorbeeld.nl"
        />
      </Field>

      <Field label="ntfy.sh topic (telefoon push)">
        <input
          type="text"
          value={s.ntfy_topic ?? ""}
          onChange={(e) => setS({ ...s, ntfy_topic: e.target.value })}
          className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          placeholder="biotech-signals-jouwgeheim"
        />
        <p className="text-xs text-slate-400 mt-1">
          Verzin een lange willekeurige naam. Installeer de ntfy app, open en
          abonneer op deze topic.
        </p>
      </Field>

      <Field label="ntfy server">
        <input
          type="text"
          value={s.ntfy_server}
          onChange={(e) => setS({ ...s, ntfy_server: e.target.value })}
          className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="E-mail drempel">
          <SeveritySelect
            value={s.alert_email_threshold}
            onChange={(v) => setS({ ...s, alert_email_threshold: v })}
          />
        </Field>
        <Field label="Push drempel">
          <SeveritySelect
            value={s.alert_ntfy_threshold}
            onChange={(v) => setS({ ...s, alert_ntfy_threshold: v })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Quiet hours start (uur UTC, leeg = uit)">
          <input
            type="number"
            min={0}
            max={23}
            value={s.quiet_hours_start ?? ""}
            onChange={(e) =>
              setS({
                ...s,
                quiet_hours_start: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          />
        </Field>
        <Field label="Quiet hours eind (uur UTC)">
          <input
            type="number"
            min={0}
            max={23}
            value={s.quiet_hours_end ?? ""}
            onChange={(e) =>
              setS({
                ...s,
                quiet_hours_end: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
          />
        </Field>
      </div>

      <button
        onClick={save}
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-white"
      >
        Opslaan
      </button>
      {msg && <span className="ml-3 text-emerald-400 text-sm">{msg}</span>}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}

function SeveritySelect({
  value,
  onChange,
}: {
  value: Severity;
  onChange: (v: Severity) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Severity)}
      className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm"
    >
      <option value="yellow">geel en hoger</option>
      <option value="orange">oranje en hoger</option>
      <option value="red">alleen rood</option>
    </select>
  );
}
