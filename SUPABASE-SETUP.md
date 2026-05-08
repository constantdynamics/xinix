# Volledige migratie naar Supabase + GitHub Pages

Doel: Netlify volledig laten varen. Frontend op GitHub Pages, backend
en cron op Supabase. Geen Netlify build minutes meer nodig.

## Eindplaatje

| Onderdeel | Host |
|---|---|
| Frontend (HTML/JS/CSS) | GitHub Pages — `constantdynamics.github.io/xinix/` |
| API (`/dashboard`, `/scores`, `/tickers`, …) | Supabase Edge Functions |
| Background jobs (poll-prices, dispatch-alerts, …) | Supabase Edge Functions, gestart door pg_cron |
| Database | Supabase Postgres (al in gebruik) |
| Cron schedules | Supabase pg_cron via `pg_net.http_post` |

## 1. Supabase CLI installeren (eenmalig, lokaal)

```bash
# macOS
brew install supabase/tap/supabase

# of via npm
npm install -g supabase
```

Inloggen + linken aan je project:
```bash
supabase login
supabase link --project-ref <jouw-project-ref>
```

Project-ref vind je in de Supabase dashboard URL: `https://supabase.com/dashboard/project/<ref>`.

## 2. Function secrets zetten

Supabase Edge Functions hebben hun eigen env-store. Vul:

```bash
supabase secrets set ADMIN_TOKEN="<dezelfde admin token als nu in Netlify>"
supabase secrets set CRON_SECRET="<willekeurig geheim, bv. openssl rand -hex 32>"
supabase secrets set RESEND_API_KEY="<huidige Resend key>"
supabase secrets set RESEND_FROM="Xinix Signal <onboarding@resend.dev>"
supabase secrets set SEC_USER_AGENT="Xinix contact@example.com"
# SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY worden automatisch geïnjecteerd
# door Supabase — niet apart zetten.
```

## 3. Functions deployen

Eén commando deployt alle 21 functies. Cruciaal: `--no-verify-jwt` zodat
GitHub Pages frontend ze direct kan aanroepen (we doen onze eigen auth
in de function code zelf).

```bash
cd <repo>
supabase functions deploy --no-verify-jwt
```

Check in dashboard → Edge Functions of alle 21 erop staan.

## 4. Database migraties draaien

De pg_cron migratie installeert `pg_cron` + `pg_net` extensies en
plant alle 11 schedules in.

```bash
supabase db push
```

Daarna éénmalig de runtime config zetten zodat pg_cron de functions
kan aanroepen (in SQL editor van het dashboard):

```sql
-- Vervang <project-ref> en het secret door je eigen waarden
ALTER DATABASE postgres SET xinix.functions_url
  = 'https://<project-ref>.supabase.co/functions/v1';
ALTER DATABASE postgres SET xinix.cron_secret
  = '<dezelfde CRON_SECRET als bij stap 2>';
```

Deze waarden worden uit `current_setting('xinix.functions_url')` gelezen
in de `invoke_edge` helper. ALTER DATABASE blijft tussen restarts staan.

Verifieer met:
```sql
SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'xinix-%';
-- moet 11 rijen geven
```

## 5. RLS-aware service code

De Edge Functions gebruiken de service-role key (auto geïnjecteerd) en
bypassen RLS — net als de Netlify functions deden. Geen RLS-aanpassing
nodig.

## 6. Frontend wijzen naar Supabase

GitHub repo settings → **Variables** (zelfde tab als bij Pages setup):
- `VITE_API_BASE_URL` → `https://<project-ref>.supabase.co/functions/v1`
  (zonder trailing slash)

De volgende push naar de branch triggert de Pages workflow, bouwt met
deze URL ingebakken, en publiceert.

## 7. Verifiëren

1. Open `https://constantdynamics.github.io/xinix/` — dashboard moet
   laden zonder CORS errors (Network tab kijken).
2. Trigger handmatig een job: Settings tab → admin token invullen,
   dan in Dashboard `⚙ jobs` popover → klik bv. `Prijzen`. Check
   `signal_runs` tabel of er een nieuwe rij komt.
3. Wacht 15 min — cron-bestuurde `dispatch-alerts` zou moeten draaien.
   Check `signal_runs` voor ok=true.

## 8. Netlify uitfaseren

Als alles werkt:
- Netlify dashboard → Site settings → **Stop builds**.
- Eventueel Domain mapping verwijderen / site archiveren.
- DNS niet meer naar Netlify pointen (als je dat had).
- `netlify/` directory en `netlify.toml` mogen blijven staan voor
  eventuele rollback; ze doen niets als de site niet meer deployt.

## Kosten / limits

| Resource | Free tier |
|---|---|
| Edge Function invocations | 500K / maand |
| Edge Function CPU | 50ms / invocation gemiddeld |
| Edge Function wall clock | 150s max per call |
| pg_cron jobs | onbeperkt |
| Database storage | 500 MB |
| Bandwidth (egress) | 5 GB / maand |

Onze 11 cron jobs tezamen ≈ ~3000 calls/dag worst case. Goed binnen
de 500K/mnd budget. Heaviest functions (compute-scores, backtest,
forward-returns) zijn lang maar bevatten alleen Yahoo throttling —
zouden binnen 150s moeten passen voor een watchlist <50 tickers.

## Troubleshooting

**Cron job draait niet:**
```sql
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
-- toont laatste runs en eventuele errors
```

**Function geeft 401:**
- Check dat het deploy commando `--no-verify-jwt` had.
- Anders: dashboard → Edge Functions → die functie → Settings → "Verify JWT" uit.

**CORS errors in browser:**
- Check `_shared/cors.ts` allowlist; `constantdynamics.github.io` moet erin staan.
- Een kleine mismatch (bv. trailing slash op origin) breekt CORS.

**Email/ntfy gaat niet:**
- `supabase secrets list` om te bevestigen dat RESEND_API_KEY etc gezet zijn.
- `signal_alerts_sent` tabel kijken voor failure rows met error kolom.
