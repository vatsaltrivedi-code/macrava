# Macro Budget Planner

Plans protein, kcal, carbs and fat within a daily ₹ budget, for hostel and PG students in India.

The app is one static page: `macro-budget-planner.html` (a copy is saved as `index.html` for hosting).

## Build

```
python3 build_local.py
```

This combines `template2.html` + `plan.js` + `foods.json` + `rest.json` + `vendor/*.js` into one page.

With a `config.json` (see `config.example.json` and `SETUP.md`), login and sync are switched on. Without it, the app runs guest-only.

## Accounts (Supabase)

- `supabase/schema.sql`: the table and security rules. Run it once in Supabase's SQL editor.
- `SETUP.md`: the click-by-click setup for Supabase and Google.
- Only the project URL and publishable key go in `config.json`. Never commit the secret/service_role key; `config.json` is git-ignored.

## Tests

```
npm install && bash tests/run-all.sh
```

- Needs Playwright with Chromium, plus local Postgres for `tests/schema.test.sh`.
- `qa.js` is the 539-check UI pass, and `sec.js` covers the security checks.

## Publishing

Every push to `main` builds the app and publishes it to https://macro-budget.pages.dev
(see `.github/workflows/deploy.yml`). `config.public.json` holds only public values
(Supabase URL + publishable key, Cloudflare Web Analytics token). Never commit the
Supabase secret/service_role key or the Cloudflare API token; the token lives in the
repository's Actions secrets.
