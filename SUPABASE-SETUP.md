# Supabase deploy status

Project: **`zfcjugqgufsyltxhvkuu`** (regio eu-west-1)
Functions URL: `https://zfcjugqgufsyltxhvkuu.supabase.co/functions/v1`

## ✅ Wat draait

| Onderdeel | Status |
|---|---|
| pg_cron + pg_net extensies | ✅ |
| `_xinix_config` tabel + `invoke_edge()` helper | ✅ |
| 11 cron jobs gescheduled | ✅ |
| Edge Function secrets (ADMIN_TOKEN, CRON_SECRET, RESEND_API_KEY, RESEND_FROM) | ✅ via dashboard |
| **19 van 21** Edge Functions gedeployed | ✅ |

Geverifieerd via `signal_runs` tabel — pg_cron invoceert succesvol; functies schrijven log-entries (`ok: true`).

### Gedeployed (19)

API endpoints (8): `dashboard`, `tickers`, `settings`, `scores`, `track-record`, `backtest`, `ticker-lookup`, `trigger`

Background jobs (11): `poll-prices-background`, `poll-trials-background`, `poll-edgar-background`, `poll-fda-background`, `poll-biotech-news-background`, `poll-mining-news-background`, `poll-metals-background`, `compute-signals-background`, `forward-returns-background`, `dispatch-alerts-background`, `backtest-background`

## 🟡 Nog niet gedeployed (2)

Te groot om praktisch via MCP te uploaden — gebundelde files staan in
`supabase/dist/` en moet je via het Supabase dashboard plakken (~2
min totaal).

| Functie | Bundle | Belang |
|---|---|---|
| `compute-scores-background` | `supabase/bundles/compute-scores-background.bundle.ts` (56KB) | **Kritisch** — daily scoring engine. Zonder dit faalt cron `xinix-compute-scores` om 06:00 UTC. |
| `test-pairs` | `supabase/bundles/test-pairs.bundle.ts` (47KB) | Optioneel — dev tool om scoring/lookalike pairs handmatig te testen. |

### Hoe te plakken via dashboard

1. Open https://supabase.com/dashboard/project/zfcjugqgufsyltxhvkuu/functions
2. Klik **Deploy a new function**
3. **Function name**: `compute-scores-background`
4. Klik **Edit code**
5. Vervang de inhoud met de complete inhoud van
   `supabase/bundles/compute-scores-background.bundle.ts`
6. Klik **Deploy function**
7. Open de zojuist gedeploye functie → **Details** → schakel
   **Verify JWT** *uit* (als die aan staat — onze auth zit in de body)
8. Herhaal voor `test-pairs` als je 'm wilt

## 📋 Frontend nog koppelen (1 minuut)

1. https://github.com/constantdynamics/xinix/settings/variables/actions
2. **New repository variable**:
   - Name: `VITE_API_BASE_URL`
   - Value: `https://zfcjugqgufsyltxhvkuu.supabase.co/functions/v1`
3. Push de branch / mergen naar `main` → GitHub Action `pages.yml`
   bouwt automatisch en deployt naar
   `https://constantdynamics.github.io/xinix/`

## 🔒 Security cleanup

- [ ] **Revoke** de Personal Access Token op
  https://supabase.com/dashboard/account/tokens (`xinix-deploy`).
  Niet meer nodig na deploy en stond in de chat.
- [ ] Optioneel: Netlify Stop builds (Site config → Build & deploy)

## 🧪 Testen

```sql
-- in Supabase SQL editor — handmatig poll-prices triggeren
SELECT public.invoke_edge('poll-prices-background');

-- Een paar minuten later: check resultaat
SELECT id, job, started_at, finished_at, ok, message
FROM signal_runs
ORDER BY id DESC LIMIT 10;
```

```bash
# Vanaf je laptop: dashboard endpoint testen
curl -i https://zfcjugqgufsyltxhvkuu.supabase.co/functions/v1/dashboard
```

Of vanuit de UI (na frontend deploy): Settings tab → admin token
invullen → Dashboard "⚙ jobs" popover → klik op job naam.

## Scheduled jobs (alle UTC)

```
xinix-poll-prices         0 22 * * 1-5    (na US close)
xinix-poll-trials         0 6 * * *
xinix-poll-edgar          */30 * * * *    (elke 30 min)
xinix-poll-fda            0 */6 * * *
xinix-poll-biotech-news   20 */2 * * *
xinix-poll-mining-news    15 */2 * * *
xinix-poll-metals         30 22 * * 1-5
xinix-compute-signals     0 5 * * *
xinix-compute-scores      0 6 * * *       ⚠ wacht op compute-scores-background deploy
xinix-forward-returns     30 7 * * *
xinix-dispatch-alerts     */15 * * * *    (elk kwartier)
```

Check live status:
```sql
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
```

## Troubleshooting

**Cron secret mismatch:** zorg dat de waarde in `_xinix_config` rij
`cron_secret` exact hetzelfde is als de Edge Function secret
`CRON_SECRET`. Wijzigen:
```sql
UPDATE public._xinix_config SET value = '<new>' WHERE key = 'cron_secret';
```
…en `CRON_SECRET` updaten via dashboard.

**Function returns 401:** check dat de deploy met verify_jwt=false ging.
In dashboard zichtbaar onder de functie details. Onze auth (admin
token + cron secret) zit in de function body, niet in JWT.

**CORS error in browser:** `_shared/cors.ts` heeft een hardcoded
allowlist (`constantdynamics.github.io` + localhost). Voor andere
origins: bewerk de ALLOWED set in alle gedeploye functies — of beter:
gebruik die origins niet.
