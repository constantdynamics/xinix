// CORS edge layer. Frontend op constantdynamics.github.io/xinix moet
// de Netlify Functions kunnen aanroepen op een ander origin. Edge
// functies tellen niet mee voor build minutes; CORS hier afhandelen
// houdt de 21 functions zelf vrij van CORS-boilerplate.
//
// Werkt zo: voor elke /api/* request:
// - OPTIONS preflight → direct 204 met CORS headers (functie wordt niet
//   geraakt, scheelt invocations)
// - anders → ctx.next() laat de echte function draaien, en we plakken
//   Access-Control-Allow-Origin op het antwoord

import type { Context } from "https://edge.netlify.com";

const ALLOWED_ORIGINS = new Set([
  "https://constantdynamics.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
]);

function pickOrigin(req: Request): string | null {
  const o = req.headers.get("origin");
  if (!o) return null;
  if (ALLOWED_ORIGINS.has(o)) return o;
  return null;
}

export default async (req: Request, ctx: Context) => {
  const origin = pickOrigin(req);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": origin ?? "null",
        "access-control-allow-methods":
          "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "access-control-allow-headers":
          "authorization, content-type, x-requested-with",
        "access-control-max-age": "86400",
        vary: "origin",
      },
    });
  }

  const res = await ctx.next();
  if (origin) {
    const headers = new Headers(res.headers);
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "origin");
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }
  return res;
};

export const config = {
  path: "/api/*",
};
