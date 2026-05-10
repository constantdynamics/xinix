import { useEffect, useState } from "react";
import { fetchSettings, saveSettings } from "../api";
import type { Settings, Severity } from "../types";
import {
  loadTilePrefs,
  saveTilePrefs,
  DEFAULT_TILE_PREFS,
  TILE_PREF_LABELS,
  type TilePrefs,
} from "../tilePrefs";
import {
  Card,
  Button,
  Input,
  Select,
  SectionHeader,
} from "../components/ui";

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

  if (error)
    return (
      <div className="rounded-xl border border-fog-loss/40 bg-fog-loss/10 p-3 text-sm text-fog-loss">
        Fout: {error}
      </div>
    );
  if (!s) return <div className="text-neutral-500 text-sm">Laden…</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <SectionHeader
        eyebrow="Configuratie"
        title="Alert instellingen"
        subtitle="Welke meldingen je krijgt, op welke kanalen, en wanneer."
      />

      {/* Goud-events toggle als prominent feature card */}
      <Card
        className="p-4 cursor-pointer"
        glow={s.alert_only_goud_events ? "lime" : undefined}
      >
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={s.alert_only_goud_events}
            onChange={(e) =>
              setS({ ...s, alert_only_goud_events: e.target.checked })
            }
            className="mt-1 h-4 w-4 cursor-pointer"
          />
          <div className="flex-1">
            <div className="font-bold text-sm text-neutral-100">
              Alleen very-hot events alerten
            </div>
            <div className="text-xs text-neutral-400 mt-1.5 leading-relaxed">
              Aan = meldingen alléén voor onmiskenbare buy-triggers:
              <strong className="text-fog-pink"> jouw aankooplimiet geraakt</strong>,
              bonanza assays (Au/Ag/Cu), discovery announcement, mining permit,
              first pour, FDA approval, topline positive, phase success,
              breakthrough designation, definitive buyout (target).
              <br />
              <span className="text-neutral-400">
                Uit = óók news-regex matches (8-K filings, JV strategic),
                price-spikes, takeover bids waar jouw ticker de koper is,
                pre-catalyst countdowns, volume blips, near-low en macro tide.
                Verwacht 10-50× zo veel alerts.
              </span>
            </div>
          </div>
        </label>
      </Card>

      <Card className="p-4 space-y-4">
        <Field label="E-mail (Resend stuurt naar dit adres)">
          <Input
            type="email"
            value={s.email ?? ""}
            onChange={(e) => setS({ ...s, email: e.target.value })}
            placeholder="jij@voorbeeld.nl"
            className="w-full"
          />
        </Field>

        <Field label="ntfy.sh topic (telefoon push)">
          <Input
            type="text"
            value={s.ntfy_topic ?? ""}
            onChange={(e) => setS({ ...s, ntfy_topic: e.target.value })}
            placeholder="biotech-signals-jouwgeheim"
            className="w-full"
          />
          <p className="text-xs text-neutral-500 mt-1.5 leading-relaxed">
            Verzin een lange willekeurige naam. Installeer de{" "}
            <a
              href="https://ntfy.sh/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-fog-pink hover:underline"
            >
              ntfy app
            </a>
            , open en abonneer op deze topic.
          </p>
        </Field>

        <Field label="ntfy server">
          <Input
            type="text"
            value={s.ntfy_server}
            onChange={(e) => setS({ ...s, ntfy_server: e.target.value })}
            className="w-full"
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
            <Input
              type="number"
              min={0}
              max={23}
              value={s.quiet_hours_start ?? ""}
              onChange={(e) =>
                setS({
                  ...s,
                  quiet_hours_start:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className="w-full"
            />
          </Field>
          <Field label="Quiet hours eind (uur UTC)">
            <Input
              type="number"
              min={0}
              max={23}
              value={s.quiet_hours_end ?? ""}
              onChange={(e) =>
                setS({
                  ...s,
                  quiet_hours_end:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className="w-full"
            />
          </Field>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button variant="primary" onClick={save}>
            Opslaan
          </Button>
          {msg && <span className="text-fog-lime text-sm">{msg}</span>}
        </div>
      </Card>

      <TilePrefsCard />
    </div>
  );
}

function TilePrefsCard() {
  const [prefs, setPrefs] = useState<TilePrefs>(loadTilePrefs);
  const [saved, setSaved] = useState(false);

  function toggle(key: keyof TilePrefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    saveTilePrefs(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  function reset() {
    setPrefs(DEFAULT_TILE_PREFS);
    saveTilePrefs(DEFAULT_TILE_PREFS);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  const keys = Object.keys(TILE_PREF_LABELS) as (keyof TilePrefs)[];

  return (
    <>
      <SectionHeader
        eyebrow="Dashboard"
        title="Tegel inhoud"
        subtitle="Welke velden er op de dashboard tegels staan. Lokaal opgeslagen — geldt alleen voor deze browser."
      />
      <Card className="p-4 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          {keys.map((k) => (
            <label
              key={k}
              className="flex items-center gap-2 py-1.5 cursor-pointer hover:text-fog-pink transition"
            >
              <input
                type="checkbox"
                checked={prefs[k]}
                onChange={() => toggle(k)}
                className="h-4 w-4 cursor-pointer"
              />
              <span className="text-sm text-neutral-300">
                {TILE_PREF_LABELS[k]}
              </span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3 pt-2 border-t border-ink-5">
          <Button size="sm" variant="ghost" onClick={reset}>
            Reset naar defaults
          </Button>
          {saved && (
            <span className="text-fog-lime text-xs animate-fade-up">
              Opgeslagen
            </span>
          )}
          <span className="ml-auto text-[11px] text-neutral-400">
            Wijzigingen verschijnen direct in Dashboard tab
          </span>
        </div>
      </Card>
    </>
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
      <div className="text-[10px] uppercase tracking-wider font-bold text-neutral-500 mb-1.5">
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
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value as Severity)}
      className="w-full"
    >
      <option value="yellow">geel en hoger</option>
      <option value="orange">oranje en hoger</option>
      <option value="red">alleen rood</option>
    </Select>
  );
}
