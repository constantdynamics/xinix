// Admin auth check. Fail closed wanneer ADMIN_TOKEN niet is gezet —
// dan kan niemand schrijven. Match exact gedrag van de Netlify versie.

export function checkAuth(req: Request): boolean {
  const required = Deno.env.get("ADMIN_TOKEN");
  if (!required) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${required}`;
}

// Voor cron-aanroepen vanuit pg_cron: we sturen een speciale header
// `x-cron-secret` mee in de http_post. Geeft toegang tot job-trigger
// functies zonder de admin token in de DB te plaatsen.
export function checkCron(req: Request): boolean {
  const required = Deno.env.get("CRON_SECRET");
  if (!required) return false;
  const got = req.headers.get("x-cron-secret") ?? "";
  return got === required;
}

export function checkAdminOrCron(req: Request): boolean {
  return checkAuth(req) || checkCron(req);
}
