# Supabase deploy — wat ik al heb gedaan, en wat jij nog moet doen

Project: **`zfcjugqgufsyltxhvkuu`** (naam: *maikel*, regio eu-west-1)
Functions URL: `https://zfcjugqgufsyltxhvkuu.supabase.co/functions/v1`

## ✅ Al gedaan via Supabase MCP

1. **pg_cron + pg_net extensies geïnstalleerd** in de database.
2. **`public.invoke_edge(fn TEXT)` helper** aangemaakt — leest functions_url + cron_secret uit een `_xinix_config` tabel en doet `net.http_post`.
3. **`_xinix_config` tabel** gemaakt met RLS aan (geen policies, dus alleen service-role kan lezen) en gevuld:
   - `functions_url` = `https://zfcjugqgufsyltxhvkuu.supabase.co/functions/v1`
   - `cron_secret` = `d59af9416c38aa6c25f9647efb51f21a7d8233ac6b3fc41891f3918322d75718`
4. **11 pg_cron jobs gescheduled** met de zelfde cron expressies als Netlify:
   - `xinix-poll-prices` `0 22 * * 1-5`
   - `xinix-poll-trials` `0 6 * * *`
   - `xinix-poll-edgar` `*/30 * * * *`
   - `xinix-poll-fda` `0 */6 * * *`
   - `xinix-poll-biotech-news` `20 */2 * * *`
   - `xinix-poll-mining-news` `15 */2 * * *`
   - `xinix-poll-metals` `30 22 * * 1-5`
   - `xinix-compute-signals` `0 5 * * *`
   - `xinix-compute-scores` `0 6 * * *`
   - `xinix-forward-returns` `30 7 * * *`
   - `xinix-dispatch-alerts` `*/15 * * * *`
5. **7 Edge Functions gedeployed** (zonder JWT verify, zoals afgesproken):
   - `dashboard`, `trigger`, `settings`, `scores`, `backtest`, `ticker-lookup`, `tickers`

## 🟡 Wat jij nog moet doen (~10 min)

De Supabase MCP kan geen secrets zetten en geen massa‑deploy. De
overgebleven 14 functions deploy je in één keer met de CLI, en de
secrets moeten ook via de CLI of dashboard.

### 1. Supabase CLI

```bash
# macOS
brew install supabase/tap/supabase

# of
npm install -g supabase
```

```bash
supabase login
supabase link --project-ref zfcjugqgufsyltxhvkuu
```

### 2. Secrets zetten (ADMIN_TOKEN, RESEND, CRON_SECRET)

**Belangrijk:** zonder ADMIN_TOKEN kunnen jouw frontend admin acties
niet werken (watchlist toevoegen, settings opslaan). Zonder
RESEND_API_KEY krijg je geen email alerts. CRON_SECRET móét matchen
met wat in de DB staat — kopieer exact.

```bash
supabase secrets set \
  ADMIN_TOKEN="<dezelfde admin token als nu in Netlify>" \
  CRON_SECRET="d59af9416c38aa6c25f9647efb51f21a7d8233ac6b3fc41891f3918322d75718" \
  RESEND_API_KEY="<huidige Resend key>" \
  RESEND_FROM="Xinix Signal <onboarding@resend.dev>" \
  SEC_USER_AGENT="Xinix contact@example.com"
```

`SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY` worden automatisch
geïnjecteerd door Supabase — niet apart zetten.

### 3. Alle functies (her)deployen

```bash
cd <repo>
supabase functions deploy --no-verify-jwt
```

Dit upload **alle 21 functies** tegelijk (inclusief de 7 die ik al
gedeployed heb — geen probleem, het is een upsert). Duurt ~30 sec.

### 4. Frontend env zetten

Op GitHub: **Repo settings → Secrets and variables → Actions →
Variables**:
- Name: `VITE_API_BASE_URL`
- Value: `https://zfcjugqgufsyltxhvkuu.supabase.co/functions/v1`

### 5. Push de branch

De GitHub Action (`pages.yml` — al aanwezig) bouwt automatisch en
deployt naar `https://constantdynamics.github.io/xinix/`.

### 6. Netlify auto‑deploy uitzetten

Netlify dashboard → Site settings → Build & deploy → **Stop builds**.

## ✅ Verifiëren

Na step 3 (deploy):

```bash
# Test dashboard endpoint
curl -i https://zfcjugqgufsyltxhvkuu.supabase.co/functions/v1/dashboard
```

Test de cron handmatig:
```sql
-- in Supabase SQL editor
SELECT public.invoke_edge('poll-prices-background');
-- check signal_runs een paar minuten later voor de nieuwe rij
```

Of vanuit de UI: Settings tab → admin token invullen → Dashboard
`⚙ jobs` popover → klik bv. `Prijzen` → kijk in `signal_runs`.

## Kosten / limits

| Resource | Free tier |
|---|---|
| Edge Function invocations | 500K / maand |
| Edge Function wall clock | 150s max per call |
| pg_cron jobs | onbeperkt |
| Database storage | 500 MB |

11 cron jobs × ~30 calls/dag = ~3K calls/dag = ~90K/maand. Ruim
binnen budget.

## Troubleshooting

**Cron draait niet:**
```sql
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```

**`invoke_edge` faalt:**
```sql
SELECT * FROM public._xinix_config;
-- moet 2 rijen geven: functions_url + cron_secret
```

**CORS error in browser:**
- `_shared/cors.ts` ALLOWED set moet je origin bevatten.
- Dat staat al goed: `https://constantdynamics.github.io` + localhost.

**Function geeft 401 op CORS preflight:**
- Check dat de deploy met `--no-verify-jwt` ging. Als niet, redeploy.
