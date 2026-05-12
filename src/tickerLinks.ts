// Bouwt een Google Finance URL op basis van een Yahoo-style ticker.
// Yahoo gebruikt landsuffixen (.V, .TO, .AX, .HK, .NS …) — Google Finance
// verwacht TICKER:EXCHANGE. Zonder de juiste exchange-code laat Google een
// "kies-een-suggestie" pagina zien i.p.v. direct de quote.
//
// Voor US-tickers heeft Yahoo geen suffix; daar gebruiken we (indien bekend)
// de opgeslagen Yahoo `exchange` (fullExchangeName) om de Google-code te kiezen
// — anders valt 'ie terug op de kale quote-URL (werkt voor de meeste, maar
// niet alle, US-tickers).
const SUFFIX_TO_EXCHANGE: Record<string, string> = {
  // Canada
  TO: "TSE", // Toronto Stock Exchange
  V: "CVE", // TSX Venture
  CN: "CNSX", // Canadian Securities Exchange
  NE: "NEO", // Cboe Canada (NEO)
  // Verenigd Koninkrijk
  L: "LON", // London Stock Exchange
  // Duitsland / Zwitserland / Oostenrijk
  DE: "ETR", // Xetra
  F: "FRA", // Börse Frankfurt
  SG: "STU", // Stuttgart
  MU: "MUN", // München
  BE: "BER", // Berlin
  DU: "DUS", // Düsseldorf
  HM: "HAM", // Hamburg
  SW: "SWX", // SIX Swiss Exchange
  VI: "VIE", // Wiener Börse
  // Euronext + rest van Europa
  PA: "EPA", // Euronext Paris
  AS: "AMS", // Euronext Amsterdam
  BR: "EBR", // Euronext Brussels
  LS: "ELI", // Euronext Lisbon
  MI: "BIT", // Borsa Italiana
  MC: "BME", // Bolsa de Madrid
  ST: "STO", // Nasdaq Stockholm
  OL: "OSL", // Oslo Børs
  CO: "CPH", // Nasdaq Copenhagen
  HE: "HEL", // Nasdaq Helsinki
  WA: "WSE", // Warsaw Stock Exchange
  AT: "ATH", // Athens Exchange
  // Azië-Pacific
  HK: "HKG", // Hong Kong Exchanges
  T: "TYO", // Tokyo Stock Exchange
  SS: "SHA", // Shanghai
  SZ: "SHE", // Shenzhen
  KS: "KRX", // Korea Exchange (KOSPI)
  KQ: "KOSDAQ", // KOSDAQ
  TW: "TPE", // Taiwan Stock Exchange
  TWO: "TPE", // Taipei Exchange (OTC)
  NS: "NSE", // National Stock Exchange of India
  BO: "BOM", // BSE (Bombay)
  SI: "SGX", // Singapore Exchange
  JK: "IDX", // Indonesia Stock Exchange
  KL: "KLSE", // Bursa Malaysia
  BK: "BKK", // Stock Exchange of Thailand
  AX: "ASX", // Australian Securities Exchange
  NZ: "NZE", // New Zealand Exchange
  // Midden-Oosten / Afrika / Latijns-Amerika
  TA: "TLV", // Tel Aviv Stock Exchange
  IS: "IST", // Borsa İstanbul
  SR: "TADAWUL", // Saudi Exchange
  JO: "JSE", // Johannesburg Stock Exchange
  SA: "BVMF", // B3 (Brazilië)
  MX: "BMV", // Bolsa Mexicana de Valores
  BA: "BCBA", // Bolsa de Comercio de Buenos Aires
  SN: "SGO", // Bolsa de Santiago
};

// Yahoo `fullExchangeName` / `exchangeName` -> Google Finance exchange-code.
// Voornamelijk voor US-tickers (zonder landsuffix); de afkortingen (NMS/NYQ/…)
// zijn de korte `exchangeName`-waardes als fallback.
export function googleExchangeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  if (e.includes("nasdaq") || e === "nms" || e === "ngm" || e === "ncm") return "NASDAQ";
  if (e.includes("arca") || e === "pcx") return "NYSEARCA";
  if (e.includes("amex") || e === "ase" || e.includes("nyse mkt") || e.includes("nyse american")) return "NYSEAMERICAN";
  if (e === "nyse" || e === "nyq" || e === "new york stock exchange") return "NYSE";
  if (e.includes("cboe") || e.includes("bats") || e === "bts" || e === "bzx") return "BATS";
  if (e.includes("otc") || e.includes("pink") || e === "pnk") return "OTCMKTS";
  // niet-US fallbacks (de suffix dekt dit normaal al):
  if (e.includes("toronto") && e.includes("vent")) return "CVE";
  if (e === "toronto") return "TSE";
  if (e.includes("nyse") && e.includes("arca")) return "NYSEARCA";
  return null;
}

export function googleFinanceUrl(ticker: string, exchange?: string | null): string {
  const t = ticker.trim().toUpperCase();
  const dot = t.indexOf(".");
  if (dot === -1) {
    // Geen suffix → US. Met bekende exchange direct linken, anders de kale
    // ticker (Google redirect die meestal — maar niet altijd — zelf).
    const code = googleExchangeCode(exchange);
    if (code) return `https://www.google.com/finance/quote/${encodeURIComponent(t)}:${code}`;
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
