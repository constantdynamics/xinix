import { useEffect, useState } from "react";
import { fetchSettings, fetchUiSettings, saveSettings, saveUiSettings, unbenchAll, getToken, runDataExport, downloadDataExport } from "../api";
import { DEFAULT_TABS, type Tab, type TabDef } from "../tabsConfig";
import type { Settings, Severity, Dashboard } from "../types";
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
  Dot,
} from "../components/ui";

export function SettingsView({ data }: { data?: Dashboard }) {
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
              Aan = meldingen alléén voor onmiskenbare actie‑triggers:
              <strong className="text-fog-pink"> aankooplimiet bereikt</strong>{" "}
              of binnen{" "}
              <strong className="text-fog-pink">25%</strong> /{" "}
              <strong className="text-fog-pink">10%</strong> boven jouw limit
              (eenmaal per 6 maanden per drempel),{" "}
              <strong className="text-fog-warn">
                40%+ daling onder de 1y high
              </strong>
              , bonanza assays (Au/Ag/Cu), discovery announcement, mining
              permit, first pour, FDA approval, topline positive, phase
              success, breakthrough designation, definitive buyout (target).
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

      <TabsCustomizerCard />

      <DataExportCard />

      {data?.poll_status && <ScanRulesCard data={data} />}
    </div>
  );
}

// Volledige data-export — kennisbehoud. Wekelijks automatisch; hier handmatig
// te draaien of te downloaden.
function DataExportCard() {
  const [busy, setBusy] = useState<"export" | "download" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const isAdmin = !!getToken();

  async function runExport() {
    setBusy("export"); setErr(null); setMsg(null);
    try {
      const r = await runDataExport();
      setMsg(`Klaar — ${r.total_rows.toLocaleString("nl-NL")} rijen geëxporteerd${r.github_committed ? " en naar de Git-repo gecommit" : ""}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  async function download() {
    setBusy("download"); setErr(null); setMsg(null);
    try {
      await downloadDataExport();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <SectionHeader
        eyebrow="Kennisbehoud"
        title="Volledige data-export"
        subtitle="Alle opgebouwde data + uitleg, wekelijks automatisch bewaard."
      />
      <Card className="p-4 space-y-3 text-sm">
        <p className="text-neutral-300 leading-relaxed">
          Elke maandag wordt automatisch een volledige export gemaakt van alle
          waardevolle data — de watchlist, de 200 strategieën met posities, de
          single portfolio, signalen, catalysts, scores en kennis-exports —
          inclusief een uitleg per tabel. De export wordt naar de Git-repo
          gecommit (<code className="text-neutral-400">docs/data-export/</code>),
          die los staat van deze site. Zo blijft alle kennis behouden, ook als
          de website ooit verdwijnt.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={download} disabled={busy !== null}>
            {busy === "download" ? "Bezig…" : "↓ Download laatste export"}
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={runExport} disabled={busy !== null}>
              {busy === "export" ? "Bezig… (~1 min)" : "Export nu"}
            </Button>
          )}
        </div>
        {msg && <p className="text-fog-lime text-xs">{msg}</p>}
        {err && <p className="text-fog-loss text-xs">{err}</p>}
      </Card>
    </div>
  );
}

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.floor(ms / 60000)} min geleden`;
  if (h < 48) return `${h} uur geleden`;
  return `${Math.floor(h / 24)} dagen geleden`;
}

function ScanRulesCard({ data }: { data: Dashboard }) {
  const ps = data.poll_status!;
  const benchedTickers = data.cards
    .filter((c) => c.price_benched)
    .sort((a, b) => (a.price_last_error ?? "").localeCompare(b.price_last_error ?? ""));
  const fullCycleHours = Math.round(
    (ps.total / Math.max(1, ps.batch_size)) * (ps.interval_minutes / 60)
  );

  return (
    <>
      <SectionHeader
        eyebrow="Systeem"
        title="Prijs-scan regels"
        subtitle="Hoe de koersdata vers blijft, en welke tickers vastlopen."
      />
      <Card className="p-4 space-y-3 text-sm">
        <ul className="space-y-1.5 text-neutral-300 leading-relaxed">
          <li>
            • <strong>Round-robin</strong>: elke run pakt de{" "}
            <strong>{ps.batch_size}</strong> tickers die het langst geleden
            gescand zijn (nooit-gescand komt eerst). Cron draait elke{" "}
            <strong>{ps.interval_minutes} min</strong> → hele watchlist (
            {ps.total} tickers) volledig ververst in ~
            <strong>{fullCycleHours} uur</strong>.
          </li>
          <li>
            • <strong>Bench</strong>: faalt een ticker{" "}
            <strong>{ps.bench_after_fails}×</strong> achter elkaar bij het
            ophalen (404, geen data, etc), dan gaat hij <em>op de bank</em> —
            wordt overgeslagen in de cyclus tot je 'm handmatig vrijgeeft. Zo
            blokkeert een handvol kapotte tickers niet de hele scan.
          </li>
          <li>
            • <strong>Alerts</strong>: <code>buy_limit_*</code> en{" "}
            <code>big_drop</code> vuren alléén voor tickers waar je een
            aankooplimiet bij hebt staan. Generieke price-spike / volume /
            90d-low signalen vuren voor alle tickers maar alleen de red-variant
            (+30% met 3× volume) gaat naar je telefoon.
          </li>
        </ul>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-ink-5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">
              In watchlist
            </div>
            <div className="text-lg font-bold tabular text-neutral-100">
              {ps.total}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">
              Nog nooit gescand
            </div>
            <div className="text-lg font-bold tabular text-fog-warn">
              {ps.never_polled}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">
              Op de bank
            </div>
            <div className="text-lg font-bold tabular text-fog-loss">
              {ps.benched}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">
              Oudste scan
            </div>
            <div className="text-sm font-medium text-neutral-300">
              {fmtAgo(ps.oldest_polled_at)}
            </div>
          </div>
        </div>

        {ps.last_run && (
          <div className="text-[11px] text-neutral-400 pt-2 border-t border-ink-5">
            Laatste run: {fmtAgo(ps.last_run.started_at)} —{" "}
            <span
              className={ps.last_run.ok ? "text-fog-lime" : "text-fog-loss"}
            >
              {ps.last_run.message ?? "?"}
            </span>
          </div>
        )}

        {benchedTickers.length > 0 && <BenchPanel tickers={benchedTickers} />}
      </Card>
    </>
  );
}

function BenchPanel({ tickers }: { tickers: Dashboard["cards"] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function unbenchAllNow() {
    if (!confirm(`${tickers.length} tickers van de bank halen en opnieuw proberen?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await unbenchAll();
      setMsg(`${r.unbenched} vrijgegeven — worden in de volgende runs opnieuw geprobeerd. Refresh over een uurtje.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Groepeer op foutmelding-prefix zodat patronen zichtbaar zijn
  const byError = new Map<string, string[]>();
  for (const c of tickers) {
    const key = (c.price_last_error ?? "onbekend").split(":")[0].slice(0, 40);
    if (!byError.has(key)) byError.set(key, []);
    byError.get(key)!.push(c.ticker);
  }
  const groups = [...byError.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="rounded-lg border border-fog-loss/40 bg-fog-loss/10 p-3 text-xs space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 font-bold text-fog-loss"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>{tickers.length} tickers op de bank</span>
      </button>
      {open && (
        <div className="space-y-2">
          {groups.map(([err, tks]) => (
            <div key={err} className="leading-relaxed">
              <span className="text-fog-warn font-mono">{err}</span>{" "}
              <span className="text-neutral-400">({tks.length})</span>:{" "}
              <span className="font-mono text-neutral-300">
                {tks.slice(0, 30).join(", ")}
                {tks.length > 30 ? ` … +${tks.length - 30}` : ""}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <Button
              size="sm"
              variant="primary"
              onClick={unbenchAllNow}
              disabled={busy}
            >
              {busy ? "Bezig…" : "Alles van de bank halen"}
            </Button>
            {msg && (
              <span className="text-[11px] text-neutral-300">{msg}</span>
            )}
          </div>
          <p className="text-[10px] text-neutral-400 leading-relaxed">
            Meeste oorzaken: verkeerde beurssuffix (.TRV bestaat niet),
            HK-ticker zonder .HK, gedelist, of een tijdelijke Yahoo-storing.
            Plak de lijst hierboven in de chat om ze gericht te fixen, of
            verwijder ze uit de Watchlist tab.
          </p>
        </div>
      )}
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

// ── Tabs aanpassen ──────────────────────────────────────────────────────────
// Hernoemen, verbergen, en drag-and-drop volgorde. Sync over devices via DB.
function TabsCustomizerCard() {
  const [order, setOrder] = useState<Tab[]>(DEFAULT_TABS.map((t) => t.key));
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<Set<Tab>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<Tab | null>(null);

  useEffect(() => {
    fetchUiSettings()
      .then((s) => {
        const validOrder = (s.tab_order ?? []).filter((k): k is Tab => DEFAULT_TABS.some((t) => t.key === k));
        const missing = DEFAULT_TABS.map((t) => t.key).filter((k) => !validOrder.includes(k));
        setOrder([...validOrder, ...missing]);
        setLabels(s.tab_labels ?? {});
        setHidden(new Set((s.tab_hidden ?? []).filter((k): k is Tab => DEFAULT_TABS.some((t) => t.key === k))));
      })
      .catch(() => { /* fallback defaults */ })
      .finally(() => setLoading(false));
  }, []);

  function defaultLabel(key: Tab): string {
    return DEFAULT_TABS.find((t) => t.key === key)?.label ?? key;
  }

  function toggleHidden(key: Tab) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function updateLabel(key: Tab, value: string) {
    setLabels((prev) => {
      const next = { ...prev };
      if (value === defaultLabel(key) || value.trim() === "") delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function onDragStart(key: Tab) {
    setDragKey(key);
  }
  function onDragOver(e: React.DragEvent, overKey: Tab) {
    if (!dragKey || dragKey === overKey) return;
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
  function onDragEnd() {
    setDragKey(null);
  }

  async function save() {
    if (!getToken()) {
      setMsg("Admin-token nodig om op te slaan.");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await saveUiSettings({
        tab_order: order,
        tab_labels: labels,
        tab_hidden: [...hidden],
      });
      setMsg("Opgeslagen — andere devices zien het bij hun volgende refresh.");
      window.dispatchEvent(new Event("xinix-ui-settings-updated"));
    } catch (e) {
      setMsg(`Fout: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    if (!confirm("Alle tabaanpassingen herstellen naar de standaard?")) return;
    setOrder(DEFAULT_TABS.map((t) => t.key));
    setLabels({});
    setHidden(new Set());
  }

  return (
    <>
      <SectionHeader
        eyebrow="UI"
        title="Tabs aanpassen"
        subtitle="Volgorde slepen, namen hernoemen, of tabs verbergen. Synchroniseert over devices (DB-opslag). Verborgen tabs blijven bereikbaar via de '+ verborgen'-knop in de tabbalk."
      />
      <Card className="p-4 space-y-3">
        {loading ? (
          <div className="text-sm text-neutral-500">Laden…</div>
        ) : (
          <>
            <div className="space-y-1">
              {order.map((key) => {
                const isHidden = hidden.has(key);
                const isDragging = dragKey === key;
                return (
                  <div
                    key={key}
                    draggable
                    onDragStart={() => onDragStart(key)}
                    onDragOver={(e) => onDragOver(e, key)}
                    onDragEnd={onDragEnd}
                    onDrop={(e) => e.preventDefault()}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded border transition-colors ${
                      isDragging
                        ? "border-emerald-500 bg-emerald-500/10 opacity-50"
                        : isHidden
                        ? "border-ink-5 bg-ink-2/30 opacity-60"
                        : "border-ink-5 bg-ink-2/40 hover:border-ink-5/80"
                    }`}
                  >
                    <span className="cursor-grab text-neutral-500 select-none px-1" title="Slepen om te verplaatsen">⋮⋮</span>
                    <span className="text-[10px] text-neutral-600 font-mono w-24 truncate" title={key}>{key}</span>
                    <Input
                      type="text"
                      value={labels[key] ?? defaultLabel(key)}
                      onChange={(e) => updateLabel(key, e.target.value)}
                      placeholder={defaultLabel(key)}
                      className="flex-1 text-sm"
                    />
                    <label className="flex items-center gap-1 text-xs text-neutral-400 cursor-pointer select-none whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        onChange={() => toggleHidden(key)}
                        className="accent-emerald-500"
                      />
                      Zichtbaar
                    </label>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-ink-5">
              <Button onClick={save} disabled={saving}>
                {saving ? "Opslaan…" : "Opslaan"}
              </Button>
              <Button onClick={reset} variant="secondary" disabled={saving}>
                Reset naar standaard
              </Button>
              {msg && (
                <span className={`text-xs ${msg.startsWith("Fout") || msg.startsWith("Admin") ? "text-fog-loss" : "text-fog-lime"}`}>
                  {msg}
                </span>
              )}
              <span className="ml-auto text-[11px] text-neutral-500">
                {hidden.size > 0 ? `${hidden.size} verborgen` : "Alle tabs zichtbaar"}
              </span>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
