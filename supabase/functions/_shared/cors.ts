// Shared CORS helper. Frontend draait op constantdynamics.github.io,
// dus Edge Functions moeten CORS expliciet uitvuren — er is geen
// edge layer zoals bij Netlify.

const ALLOWED = new Set([
  "https://constantdynamics.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
]);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED.has(origin) ? origin : "null";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers":
      "authorization, content-type, x-requested-with, apikey",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function jsonResponse(
  req: Request,
  body: unknown,
  init: ResponseInit = {}
): Response {
  const headers = {
    ...corsHeaders(req),
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function textResponse(
  req: Request,
  body: string,
  init: ResponseInit = {}
): Response {
  const headers = {
    ...corsHeaders(req),
    "content-type": "text/plain",
    ...(init.headers as Record<string, string> | undefined),
  };
  return new Response(body, { ...init, headers });
}
