// Bouwt een Google Finance URL op basis van Yahoo‑style ticker.
// Yahoo gebruikt suffixen (.V, .TO, .AX, .L) — Google verwacht TICKER:EXCHANGE.
const SUFFIX_TO_EXCHANGE: Record<string, string> = {
  V: "CVE", // TSX Venture
  TO: "TSE", // Toronto Stock Exchange
  CN: "CNSX", // Canadian Securities Exchange
  AX: "ASX", // Australian Securities Exchange
  L: "LON", // London
  HK: "HKG",
  T: "TYO",
  PA: "EPA",
  DE: "ETR",
  AS: "AMS",
  BR: "EBR",
  MI: "BIT",
  MC: "BME",
  ST: "STO",
  HE: "HEL",
  SW: "SWX",
};

export function googleFinanceUrl(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  const dot = t.indexOf(".");
  if (dot === -1) {
    // Geen suffix → US. Google laat de exchange weg en redirect zelf.
    return `https://www.google.com/finance/quote/${encodeURIComponent(t)}`;
  }
  const base = t.slice(0, dot);
  const suffix = t.slice(dot + 1);
  const exch = SUFFIX_TO_EXCHANGE[suffix];
  if (!exch) {
    return `https://www.google.com/finance/quote/${encodeURIComponent(t)}`;
  }
  return `https://www.google.com/finance/quote/${encodeURIComponent(base)}:${exch}`;
}
