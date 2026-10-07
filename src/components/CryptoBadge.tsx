// Rood CRYPTO-label (keuze gebruiker 10b, 2026-10-07) in de Favorieten-tabel en
// de 5-sterren-scanner. De labels komen van de wekelijkse crypto-scan
// (signal_tickers.crypto_cat plus alles wat de scan vond) en worden één keer
// per pagina-load opgehaald.
import { useEffect, useState } from "react";
import { fetchCryptoLabels, type CryptoCat } from "../api";

export const CRYPTO_CAT_LABEL: Record<CryptoCat, string> = {
  miner: "MINER",
  treasury: "SCHATKIST",
  exchange: "BEURS",
  tech: "TECH",
};
export const CRYPTO_CAT_UITLEG: Record<CryptoCat, string> = {
  miner: "miner of datacenter (ook miners die naar AI zijn omgeschakeld)",
  treasury: "schatkistbedrijf: houdt bitcoin, ether of een andere munt aan",
  exchange: "beurs, broker of wallet",
  tech: "blockchain-, stablecoin- of tokenisatietechniek, of mininghardware",
};

let labels: Record<string, CryptoCat> | null = null;
let loading = false;
const listeners = new Set<() => void>();

function load() {
  if (labels || loading) return;
  loading = true;
  fetchCryptoLabels()
    .then((l) => {
      labels = Object.fromEntries(Object.entries(l).map(([t, c]) => [t.toUpperCase(), c]));
    })
    .catch(() => {
      labels = {};
    })
    .finally(() => {
      loading = false;
      listeners.forEach((f) => f());
    });
}

/** Ticker → crypto-categorie; leeg zolang de labels nog niet binnen zijn. */
export function useCryptoLabels(): Record<string, CryptoCat> {
  const [, setTick] = useState(0);
  useEffect(() => {
    const f = () => setTick((n) => n + 1);
    listeners.add(f);
    load();
    return () => {
      listeners.delete(f);
    };
  }, []);
  return labels ?? {};
}

export function CryptoBadge({ cat }: { cat: CryptoCat | null | undefined }) {
  if (!cat) return null;
  return (
    <span
      className="crypto-badge ml-1.5 inline-block align-middle rounded border border-red-500/60 bg-red-500/10 px-1 py-px text-[9px] font-extrabold uppercase leading-none tracking-wider text-red-500"
      title={`Crypto-aandeel: ${CRYPTO_CAT_UITLEG[cat]}`}
    >
      CRYPTO
    </span>
  );
}
