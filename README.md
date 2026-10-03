# Cardfile

Scan, file and follow up on business cards. Photograph the front and back of a card, let Claude read it, review the details, and file the contact in a shared team database, or keep it private. Every contact keeps a timeline of meetings, calls and recorded conversations, with AI summaries.

- **Web app:** React 18 + Vite, mobile-first (`src/`)
- **Backend:** Supabase Auth, Postgres with row level security, private Storage and Edge Functions (`supabase/`)
- **AI:** Claude reads cards and summarises meetings. OpenAI Whisper transcribes recordings (optional).

Open `preview/cardfile-preview.html` in a browser to click through the app with sample data, no setup needed. `preview/cardfile-mobile.html` shows the same demo in a phone frame.

---

## Setup

You need a Supabase project, an Anthropic API key and Node 18+. The Supabase CLI makes steps 2 and 3 easier: `npm i -g supabase`, or use `npx supabase`.

### 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Authentication → Sign In / Providers → Email** and turn **Confirm email** off. Cardfile signs people in with a username. Behind the scenes, each username becomes `<username>@<VITE_USERNAME_DOMAIN>`, and no email is ever sent.

### 2. Create the database

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

You can also paste `supabase/migrations/0001_cardfile.sql` into the SQL editor and run it. The migration creates the tables, security rules, triggers, RPCs and the two private storage buckets (`cards`, `recordings`).

### 3. Deploy the edge functions

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# or, to pay through Vercel instead of an Anthropic account:
# supabase secrets set AI_GATEWAY_API_KEY=...             # see "Using Vercel AI Gateway" below
# optional:
supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5-5     # this is the default
supabase secrets set OPENAI_API_KEY=sk-...                 # enables "Transcribe recording"

supabase functions deploy scan-card meeting-notes admin-users
```

#### Using Vercel AI Gateway instead of an Anthropic key

1. In Vercel, open your team's **AI Gateway** tab → **API Keys** → **Create key**.
2. In Supabase, open **Edge Functions → Secrets**, add `AI_GATEWAY_API_KEY` with that key, and save.
3. Redeploy `scan-card` and `meeting-notes`, or wait for the next deploy. Secrets apply on the next cold start.

When `AI_GATEWAY_API_KEY` is set, it is used instead of `ANTHROPIC_API_KEY`, and Claude is called through the gateway. The model is `anthropic/claude-sonnet-5.5` by default, derived from `ANTHROPIC_MODEL`. Override it with `AI_GATEWAY_MODEL` if the gateway lists it under a different name.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the functions automatically. API keys stay in function secrets and never reach the browser.

### 4. Run the web app

```bash
cp .env.example .env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

You'll find both values under **Project Settings → API**. Use the anon/public key, never the service role key.

### 5. Make yourself super admin

Sign up in the app, then run this in the Supabase SQL editor:

```sql
update profiles set is_super_admin = true where username = 'your-username';
```

### 6. Deploy to Vercel

`vercel.json` is included. In Vercel, import this repository, or connect it to an existing project under **Settings → Git**. Then set these environment variables:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | anon/public key |
| `VITE_USERNAME_DOMAIN` | `users.cardfile.app` (or a domain you own) |

Every push to `main` then deploys. Netlify and Cloudflare Pages work the same way: build `npm run build`, output `dist`, and rewrite all paths to `/index.html`.

---

## Configuration

| Setting | Where |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `.env` / hosting env vars |
| `VITE_USERNAME_DOMAIN` (default `users.cardfile.app`) | `.env` / hosting env vars. Don't change it once people have signed up, because their logins are tied to it. |
| `ANTHROPIC_API_KEY` or `AI_GATEWAY_API_KEY` (one is required), `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `AI_GATEWAY_MODEL` (optional) | Edge function secrets |
| `OPENAI_API_KEY` (optional) | Edge function secret |
| Filter value lists | `src/taxonomy.js`. Run `npm run sync:taxonomy` and redeploy `scan-card` after editing. `npm run build` syncs automatically. |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build to `dist/` |
| `npm test` | Unit tests (filters, CSV, contact form, demo/API parity) |
| `npm run build:preview` | Rebuilds the single-file demo in `preview/` |
| `supabase/tests/run.sh` | Runs the migration and the RLS/trigger tests against a local Postgres 16 (set `PGHOST`/`PGPORT`/`PGUSER`) |

## How access works

- Every new account gets its own workspace and is its admin. Admins add people by username as **admin**, **editor** or **viewer**.
- **Private cards** are visible only to their owner, and that includes admins and super admins. A card's photos, notes and recordings follow its privacy.
- When an admin takes someone else's shared card private, the admin becomes its owner.
- **Super admins** can cancel or reinstate any account, suspend workspaces, revoke memberships and reset passwords. They cannot read cards: their dashboard only receives counts.
- All of this is enforced in Postgres (RLS and guard triggers), not just in the UI. `supabase/tests/rls_test.sql` checks it.

## Project layout

```
supabase/
  migrations/0001_cardfile.sql   schema, RLS, triggers, RPCs, storage policies
  functions/scan-card/           Claude vision → contact fields
  functions/meeting-notes/       Claude summary + optional Whisper transcription
  functions/admin-users/         suspend / reinstate / reset password (service role)
  functions/_shared/             helpers; taxonomy.js is synced from src/
  tests/                         Postgres stubs + RLS tests
src/
  api.js                         all Supabase access
  demo/                          in-memory api.js used by the preview build
  filters.js                     search, filters, grouping, counts (+ tests)
  components/                    UI
preview/                         clickable single-file demo
```

## Known limits (v1)

- Contacts load in full and are filtered in the browser. That stays smooth up to several thousand cards per workspace.
- Live transcription relies on the browser's speech recognition, which works in Chrome, Edge and Safari but not Firefox.
- No email password recovery. A super admin resets passwords.
- Some Supabase projects reject sign-up emails on domains with no mail records. If sign-up fails with "invalid email", set `VITE_USERNAME_DOMAIN` to a domain you own.
