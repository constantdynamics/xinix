// Inlogpoort: een onbekend apparaat ziet alleen het inlogscherm. Een bekend
// apparaat ziet Xinix meteen; op de achtergrond vraagt de poort na of het niet
// is ingetrokken. Een herstellink (?reset=…) opent het scherm voor een nieuw wachtwoord.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button, Card, Input } from "./ui";
import { checkDevice, getDeviceToken, login, requestReset, resetPassword } from "../auth";

type Gate = "open" | "login" | "reset";

const resetTokenFromUrl = () => new URLSearchParams(window.location.search).get("reset");
function dropResetFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("reset");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AuthGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>(() => (resetTokenFromUrl() ? "reset" : getDeviceToken() ? "open" : "login"));

  useEffect(() => {
    if (gate !== "open") return;
    let alive = true;
    // Is de server niet bereikbaar, dan blijft een bekend apparaat gewoon binnen.
    checkDevice().then((r) => { if (alive && r === "invalid") setGate("login"); });
    return () => { alive = false; };
  }, [gate]);

  if (gate === "reset") {
    return (
      <ResetScreen
        token={resetTokenFromUrl() ?? ""}
        onDone={() => { dropResetFromUrl(); setGate("open"); }}
        onCancel={() => { dropResetFromUrl(); setGate(getDeviceToken() ? "open" : "login"); }}
      />
    );
  }
  if (gate === "login") return <LoginScreen onDone={() => setGate("open")} />;
  return <>{children}</>;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-1 text-neutral-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center"><span className="wordmark text-4xl leading-none select-none">Xinix</span></div>
        {children}
      </div>
    </div>
  );
}

function LoginScreen({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true); setErr(null); setInfo(null);
    const r = await login(pw);
    setBusy(false);
    if (r.ok) { onDone(); return; }
    setPw("");
    if (r.reason === "wrong") {
      setErr(r.attemptsLeft === 1
        ? "Onjuist wachtwoord. Nog 1 poging, daarna moet je een uur wachten."
        : `Onjuist wachtwoord. Nog ${r.attemptsLeft} pogingen.`);
    } else if (r.reason === "locked") {
      setErr(`Te veel foute pogingen. Probeer het opnieuw na ${fmtTime(r.lockedUntil)}.`);
    } else {
      setErr(r.message);
    }
  }

  async function forgot() {
    setBusy(true); setErr(null); setInfo(null);
    try {
      const r = await requestReset();
      setInfo(r.channel === "email"
        ? `Er staat een herstellink in je mail${r.to ? ` (${r.to})` : ""}. Hij werkt een uur.`
        : `De herstellink staat in een pushmelding op je telefoon, want ${r.emailProblem ?? "e-mail lukte niet"}. Hij werkt een uur.`);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Card className="p-5 space-y-4">
        <div>
          <h1 className="text-base font-semibold text-neutral-100">Inloggen</h1>
          <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
            Dit apparaat is nog niet bekend. Na het inloggen onthoudt Xinix het, tot je het intrekt bij
            Instellingen → Apparaten.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {/* Voor wachtwoordmanagers: die bewaren een wachtwoord liever bij een gebruikersnaam. */}
          <input type="text" name="username" autoComplete="username" value="xinix" readOnly hidden />
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            placeholder="Wachtwoord"
            aria-label="Wachtwoord"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="w-full"
          />
          <Button type="submit" variant="primary" className="w-full" disabled={!pw || busy}>
            {busy ? "Bezig…" : "Inloggen"}
          </Button>
        </form>
        {err && <p className="text-xs text-fog-loss">{err}</p>}
        {info && <p className="text-xs text-fog-lime leading-relaxed">{info}</p>}
        <button
          type="button"
          onClick={forgot}
          disabled={busy}
          className="text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-200 disabled:opacity-40"
        >
          Wachtwoord vergeten of wijzigen?
        </button>
      </Card>
    </Shell>
  );
}

function ResetScreen({ token, onDone, onCancel }: { token: string; onDone: () => void; onCancel: () => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (a.length < 8) { setErr("Kies een wachtwoord van minstens 8 tekens."); return; }
    if (a !== b) { setErr("De twee wachtwoorden zijn niet gelijk."); return; }
    setBusy(true); setErr(null);
    try {
      await resetPassword(token, a);
      onDone();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Card className="p-5 space-y-4">
        <div>
          <h1 className="text-base font-semibold text-neutral-100">Nieuw wachtwoord</h1>
          <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
            Kies een nieuw wachtwoord voor Xinix. Daarna ben je op dit apparaat meteen ingelogd; andere
            apparaten blijven ingelogd.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input type="text" name="username" autoComplete="username" value="xinix" readOnly hidden />
          <Input
            type="password"
            autoComplete="new-password"
            autoFocus
            placeholder="Nieuw wachtwoord (minstens 8 tekens)"
            aria-label="Nieuw wachtwoord"
            value={a}
            onChange={(e) => setA(e.target.value)}
            className="w-full"
          />
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="Herhaal het nieuwe wachtwoord"
            aria-label="Herhaal het nieuwe wachtwoord"
            value={b}
            onChange={(e) => setB(e.target.value)}
            className="w-full"
          />
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !a || !b}>
            {busy ? "Bezig…" : "Opslaan en inloggen"}
          </Button>
        </form>
        {err && <p className="text-xs text-fog-loss">{err}</p>}
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-200"
        >
          Annuleren
        </button>
      </Card>
    </Shell>
  );
}
