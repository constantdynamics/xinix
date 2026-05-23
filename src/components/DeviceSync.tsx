// Apparaat-koppeling. Favorieten/markeringen staan server-side, maar een
// apparaat ziet ze pas na invoer van het admin-token. Met een kortlevende
// koppelcode haalt de telefoon het token op zonder het over te typen:
//  - apparaat mét token (laptop)  -> genereert een code
//  - apparaat zónder token (tel.) -> wisselt een code in
import { useEffect, useState } from "react";
import { Button, Input } from "./ui";
import { getToken, setToken, createPairingCode, redeemPairingCode } from "../api";

function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

function GenerateCode() {
  const [code, setCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [genId, setGenId] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Aftelinterval gekoppeld aan genId — zo herstart de timer betrouwbaar bij
  // elke nieuwe code, ook in het onwaarschijnlijke geval dat de server
  // dezelfde code teruggeeft.
  useEffect(() => {
    if (genId === 0) return;
    const id = setInterval(() => setSecondsLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [genId]);

  async function generate() {
    setBusy(true);
    setErr(null);
    try {
      const c = await createPairingCode();
      const ttl = Math.round((new Date(c.expires_at).getTime() - Date.now()) / 1000);
      setCode(c.code);
      setSecondsLeft(ttl > 0 ? ttl : c.ttl_minutes * 60);
      setGenId((n) => n + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Mislukt");
    } finally {
      setBusy(false);
    }
  }

  if (code && secondsLeft > 0) {
    const mm = Math.floor(secondsLeft / 60);
    const ss = String(secondsLeft % 60).padStart(2, "0");
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[11px] text-neutral-400">Koppelcode voor je telefoon:</span>
        <span className="font-mono text-lg font-bold tracking-[0.25em] text-emerald-300">
          {formatCode(code)}
        </span>
        <span className="text-[11px] text-neutral-500">
          verloopt over {mm}:{ss}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void generate()} disabled={busy}>
          Nieuw
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button size="sm" variant="primary" onClick={() => void generate()} disabled={busy}>
        {busy ? "Bezig…" : "Koppel telefoon"}
      </Button>
      <span className="text-[11px] text-neutral-500">
        Genereert een code van 5 min — voer 'm op je telefoon in via ditzelfde balkje.
      </span>
      {err && <span className="text-[11px] text-fog-loss">{err}</span>}
    </div>
  );
}

function RedeemCode() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function redeem() {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length !== 6) {
      setErr("Voer de 6-tekens koppelcode in.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const token = await redeemPairingCode(clean);
      setToken(token);
      // Volledige reload — bootstrapt het token, favorieten en de rest schoon.
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Koppelen mislukt");
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-neutral-400">Telefoon koppelen?</span>
      <Input
        placeholder="Koppelcode"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void redeem();
        }}
        className="w-32 font-mono uppercase tracking-widest"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <Button size="sm" variant="primary" onClick={() => void redeem()} disabled={busy}>
        {busy ? "Bezig…" : "Koppel"}
      </Button>
      <span className="text-[11px] text-neutral-500">
        Genereer de code op je laptop onder "Koppel telefoon".
      </span>
      {err && <span className="text-[11px] text-fog-loss">{err}</span>}
    </div>
  );
}

export function DeviceSync() {
  return getToken() != null ? <GenerateCode /> : <RedeemCode />;
}
