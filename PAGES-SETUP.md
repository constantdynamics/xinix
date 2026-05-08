# GitHub Pages deploy

De frontend draait op **constantdynamics.github.io/xinix/** en spreekt
de bestaande Netlify Functions aan voor data. GitHub Pages bouwt
gratis via Actions, dus build minutes op Netlify zijn niet meer nodig.

## Eenmalige setup (5 min)

### 1. Pages aanzetten in de repo
1. Repo settings → **Pages**
2. Source: **GitHub Actions** (niet "Deploy from a branch")

### 2. Pages variable configureren
Repo settings → **Secrets and variables** → **Actions** → tab **Variables**

Maak een nieuwe variable:
- Name: `VITE_API_BASE_URL`
- Value: `https://<jouw-netlify-site>.netlify.app`
  (de URL waar je Netlify Functions nu live op staan, zonder trailing slash)

### 3. CORS toestaan op Netlify
Een edge function (`netlify/edge-functions/cors.ts`) handelt CORS af.
Check de allowlist in dat bestand — `constantdynamics.github.io` staat
er al in. Eén Netlify deploy is nodig om deze edge function live te
krijgen — daarna nooit meer.

### 4. Push de branch
De Action triggert automatisch op push naar `main` of de
`claude/biotech-signal-detector-3ajql` branch. Workflow genaamd
**Deploy to GitHub Pages** in de Actions tab.

Na ~1 min staat de site live op
`https://constantdynamics.github.io/xinix/`.

## Netlify auto-deploy uitzetten (optioneel maar aanbevolen)

Anders blijft elke push aan de branch óók een Netlify build triggeren
en blijven die credits weglopen.

Netlify dashboard → **Site settings** → **Build & deploy** →
**Continuous deployment** → **Build settings** → **Stop builds**.

Of: in dezelfde sectie, **Branches and deploy contexts** → set production
branch naar een non-bestaande branch zoals `archive`. Dan triggert
GitHub niets meer op Netlify.

De **functions** blijven gewoon werken op je Netlify URL — die
hoeven niet opnieuw gedeployt te worden tot je iets aan de backend
verandert. Function invocations vallen onder een aparte (ruime) meter.

## Lokaal testen

```bash
# Tegen je Netlify functions praten:
VITE_API_BASE_URL=https://<jouw-netlify-site>.netlify.app npm run dev

# Of zonder API base = same-origin (alleen werkend als Netlify dev runt):
npm run dev
```

## Wat staat waar

| | |
|---|---|
| Frontend (HTML/CSS/JS) | GitHub Pages — `constantdynamics.github.io/xinix/` |
| API (`/api/*`) | Netlify Functions — `<site>.netlify.app/api/*` |
| Database | Supabase |
| Cron jobs | Netlify scheduled functions (poll-prices etc) |

## Vervolgstap (optioneel, later)

Voor een echte Netlify-loze setup: port de 21 functions naar
**Supabase Edge Functions** (Deno, 500K calls/maand free) en zet de
crons op `pg_cron` in Supabase. ~2-3 uur werk. Dan kun je het Netlify
account opzeggen.
