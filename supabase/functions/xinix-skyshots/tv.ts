// TradingView-dagkoersen via hun grafiekdienst (websocket). De scanner geeft alleen vandaag en
// gisteren; voor de controle van oudere skyshots is de hele reeks nodig. Deno's eigen WebSocket kan
// geen Origin-header meesturen en onderhandelt een protocol dat TradingView weigert
// ("NoApplicationProtocol"), dus de verbinding wordt hier zelf opgezet: TLS met ALPN http/1.1, de
// HTTP-upgrade en de websocket-frames.

const HOST = "data.tradingview.com";
const PATH = "/socket.io/websocket?from=chart%2F&type=chart";
const enc = new TextEncoder();
const dec = new TextDecoder();

export interface TvBar { t: number; o: number; h: number; l: number; c: number; v: number }
export interface TvHistory { bars: TvBar[]; timezone: string | null }

async function writeAll(conn: Deno.TlsConn, b: Uint8Array) {
  let o = 0;
  while (o < b.length) o += await conn.write(b.subarray(o));
}

class Socket {
  private buf = new Uint8Array(0);
  private constructor(private conn: Deno.TlsConn) {}

  static async open(): Promise<Socket> {
    const conn = await Deno.connectTls({ hostname: HOST, port: 443, alpnProtocols: ["http/1.1"] });
    const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    await writeAll(conn, enc.encode(
      `GET ${PATH} HTTP/1.1\r\nHost: ${HOST}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: https://www.tradingview.com\r\n` +
        `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36\r\n\r\n`,
    ));
    const s = new Socket(conn);
    const head = await s.readHead();
    if (!/^HTTP\/1\.1 101/.test(head)) {
      s.close();
      throw new Error(`TradingView weigert de verbinding: ${head.split("\r\n")[0]}`);
    }
    return s;
  }

  private async fill(): Promise<boolean> {
    const chunk = new Uint8Array(65536);
    const n = await this.conn.read(chunk);
    if (n === null) return false;
    const b = new Uint8Array(this.buf.length + n);
    b.set(this.buf);
    b.set(chunk.subarray(0, n), this.buf.length);
    this.buf = b;
    return true;
  }

  private async readHead(): Promise<string> {
    while (true) {
      const k = indexOfCrlf2(this.buf);
      if (k >= 0) {
        const head = dec.decode(this.buf.subarray(0, k));
        this.buf = this.buf.slice(k + 4);
        return head;
      }
      if (!(await this.fill())) throw new Error("TradingView sloot de verbinding tijdens het opzetten");
    }
  }

  async send(text: string, opcode = 1): Promise<void> {
    const payload = enc.encode(text);
    const len = payload.length;
    const hdr: number[] = [0x80 | opcode];
    if (len < 126) hdr.push(0x80 | len);
    else if (len < 65536) hdr.push(0x80 | 126, len >> 8, len & 255);
    else hdr.push(0x80 | 127, 0, 0, 0, 0, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255);
    const mask = crypto.getRandomValues(new Uint8Array(4));
    const out = new Uint8Array(hdr.length + 4 + len);
    out.set(hdr);
    out.set(mask, hdr.length);
    for (let i = 0; i < len; i++) out[hdr.length + 4 + i] = payload[i] ^ mask[i & 3];
    await writeAll(this.conn, out);
  }

  /** Het volgende tekstbericht (pings worden beantwoord); null als de verbinding dicht is. */
  async recv(): Promise<string | null> {
    const parts: Uint8Array[] = [];
    while (true) {
      while (this.buf.length < 2) if (!(await this.fill())) return null;
      const b0 = this.buf[0], b1 = this.buf[1];
      let len = b1 & 127, off = 2;
      if (len === 126) {
        while (this.buf.length < 4) if (!(await this.fill())) return null;
        len = (this.buf[2] << 8) | this.buf[3];
        off = 4;
      } else if (len === 127) {
        while (this.buf.length < 10) if (!(await this.fill())) return null;
        len = Number(new DataView(this.buf.buffer, this.buf.byteOffset + 2, 8).getBigUint64(0));
        off = 10;
      }
      const masked = (b1 & 128) !== 0;
      const maskAt = off;
      if (masked) off += 4;
      while (this.buf.length < off + len) if (!(await this.fill())) return null;
      let payload = this.buf.slice(off, off + len);
      if (masked) {
        const m = this.buf.slice(maskAt, maskAt + 4);
        payload = payload.map((x, i) => x ^ m[i & 3]);
      }
      this.buf = this.buf.slice(off + len);
      const op = b0 & 15;
      if (op === 8) return null;
      if (op === 9) {
        await this.send(dec.decode(payload), 10);
        continue;
      }
      if (op === 10) continue;
      parts.push(payload);
      if (b0 & 128) {
        const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
        let k = 0;
        for (const p of parts) {
          all.set(p, k);
          k += p.length;
        }
        return dec.decode(all);
      }
    }
  }

  close() {
    try {
      this.conn.close();
    } catch { /* al dicht */ }
  }
}

function indexOfCrlf2(b: Uint8Array): number {
  for (let i = 0; i + 3 < b.length; i++) if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return i;
  return -1;
}

// Berichten van TradingView: "~m~<lengte>~m~<json>", eventueel meerdere in één frame; "~h~N" is een hartslag.
const pack = (obj: unknown) => {
  const s = typeof obj === "string" ? obj : JSON.stringify(obj);
  return `~m~${s.length}~m~${s}`;
};
function unpack(data: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (data.startsWith("~m~", i)) {
    const j = data.indexOf("~m~", i + 3);
    if (j < 0) break;
    const len = Number(data.slice(i + 3, j));
    out.push(data.slice(j + 3, j + 3 + len));
    i = j + 3 + len;
  }
  return out;
}

/** Eén verbinding die voor meerdere symbolen na elkaar dagkoersen ophaalt. */
export class TvClient {
  private sock: Socket | null = null;
  private seq = 0;

  /** Dagkoersen (oudste eerst) van één symbool, bv. "NASDAQ:STAK"; null als TradingView het symbool niet kent. */
  async daily(symbol: string, bars: number, timeoutMs = 20_000): Promise<TvHistory | null> {
    if (!this.sock) {
      this.sock = await Socket.open();
      await this.sock.send(pack({ m: "set_auth_token", p: ["unauthorized_user_token"] }));
    }
    const sock = this.sock;
    const cs = `cs_${++this.seq}${Math.random().toString(36).slice(2, 10)}`;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      sock.close();
    }, timeoutMs);
    try {
      await sock.send(pack({ m: "chart_create_session", p: [cs, ""] }));
      await sock.send(pack({ m: "resolve_symbol", p: [cs, "sym_1", "=" + JSON.stringify({ symbol, adjustment: "splits", session: "regular" })] }));
      await sock.send(pack({ m: "create_series", p: [cs, "s1", "s1", "sym_1", "1D", bars, ""] }));
      const out: TvBar[] = [];
      let timezone: string | null = null;
      while (true) {
        const frame = await sock.recv();
        if (frame === null) throw new Error(timedOut ? `TradingView gaf binnen ${timeoutMs / 1000} s geen antwoord` : "TradingView sloot de verbinding");
        for (const p of unpack(frame)) {
          if (p.startsWith("~h~")) {
            await sock.send(pack(p));
            continue;
          }
          let m: { m?: string; p?: unknown[] };
          try {
            m = JSON.parse(p);
          } catch {
            continue;
          }
          if (m.m === "critical_error" || m.m === "protocol_error") throw new Error(`TradingView: ${m.m} ${JSON.stringify(m.p ?? []).slice(0, 120)}`);
          if (!m.m || m.p?.[0] !== cs) continue;
          if (m.m === "symbol_resolved") {
            const info = m.p?.[2] as { timezone?: unknown } | undefined;
            if (typeof info?.timezone === "string") timezone = info.timezone;
          } else if (m.m === "timescale_update") {
            const s = (m.p?.[1] as { s1?: { s?: Array<{ v: number[] }> } } | undefined)?.s1?.s;
            if (Array.isArray(s)) for (const b of s) out.push({ t: b.v[0], o: b.v[1], h: b.v[2], l: b.v[3], c: b.v[4], v: b.v[5] ?? 0 });
          } else if (m.m === "series_completed") {
            await sock.send(pack({ m: "chart_delete_session", p: [cs] }));
            out.sort((a, b) => a.t - b.t);
            return { bars: out, timezone };
          } else if (m.m === "symbol_error") {
            await sock.send(pack({ m: "chart_delete_session", p: [cs] }));
            return null;
          } else if (m.m === "series_error") {
            await sock.send(pack({ m: "chart_delete_session", p: [cs] }));
            return { bars: [], timezone };
          }
        }
      }
    } catch (e) {
      this.close();
      throw timedOut ? new Error(`TradingView gaf binnen ${timeoutMs / 1000} s geen antwoord`) : e;
    } finally {
      clearTimeout(timer);
    }
  }

  close() {
    this.sock?.close();
    this.sock = null;
  }
}
