# Axoloto

A pnpm + Turborepo monorepo for the **Axoloto** Pokémon project. Multiple apps share a single Supabase database.

| App | Domain | Status | Description |
|---|---|---|---|
| `apps/draft` | `draft.axoloto.app` | Active | Realtime auction app for a draft event. 8 participants draft teams of 6 via live bidding with coaches. |
| `apps/team` | `team.axoloto.app` | Planned | Pokémon swiper / wishlist builder |
| `apps/web` | `axoloto.app` | Planned | Landing page. |

`packages/supabase` (`@axoloto/supabase`) holds the shared database types and the anon browser client. `supabase/` (migrations, edge functions, seeds) is shared infrastructure for the one Postgres database both apps read.

---

## Tech stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS v4, shadcn/ui |
| State | Zustand (draft app) |
| Database | Supabase  |
| Realtime | Supabase Realtime |
| Auth | Supabase Auth |
| Deployment | Vercel |

---

## Prerequisites

- Node.js 22+
- **pnpm 9** — pinned via `packageManager`. The repo uses Corepack:
  ```bash
  corepack enable pnpm
  ```
  If the global `pnpm` shim can't be installed, invoke it through Corepack instead: `corepack pnpm@9.15.0 <args>`.

---

## Setup

### 1. Install dependencies (from the repo root)

```bash
pnpm install
```

### 2. Configure environment variables

Create `apps/draft/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 3. Set up the database

```bash
npx supabase link --project-ref your-project-id   # once
npx supabase db push                              # apply migrations
```

### 4. Seed Pokémon reference data (once ever, ~1–2 min)

```bash
pnpm seed:pokemon
```

### 5. Configure and seed the event (draft app)

`apps/draft/src/lib/config/event.config.ts` is gitignored (it holds plaintext passwords). Create it with the roster — usernames and passwords for all participants, coaches, and the host — then:

```bash
pnpm seed:event        # creates auth users + event rows (once per event)
```

### 6. Run

```bash
pnpm --filter @axoloto/draft dev
```

Log in as the host at `/login`, then activate the event from `/host` to make it visible to participants.

---

## Commands

```bash
pnpm install                         # install workspace
pnpm --filter @axoloto/draft dev     # run the draft app
pnpm --filter @axoloto/draft test    # run draft tests (vitest)
pnpm build                           # turbo: build all apps
pnpm lint                            # turbo: lint all apps
pnpm test                            # turbo: test all apps
pnpm seed:pokemon                    # seed pokemon_meta
pnpm seed:event                      # seed event accounts

# Database (Supabase CLI)
npx supabase db push
npx supabase gen types typescript --project-id <id> > packages/supabase/src/database.types.ts
```

Regenerate database types into `packages/supabase/src/database.types.ts` after any schema change — both apps consume them from there.

---

## Draft app — interfaces

| Route | Audience | Description |
|---|---|---|
| `/stream` | Public | OBS/broadcast view — read-only, fullscreen |
| `/host` | Host | Start event, skip turns, edit budgets, manual assignment |
| `/auction` | Participants, Coaches | Place bids, nominate, view roster |
| `/mobile` | Participants, Coaches | Minimal companion — timer, bid, nominate |
| `/login` | All | Username + password login |

## Draft app — auction rules

- **Budget** $1000 per participant · **Bids** $50 min / $750 max / $25 increment · **Team size** 6
- **Timer** 30s per auction, +5s on each new bid (capped at 30s)
- **Mega round** opens the draft with mega-capable Pokémon only; every participant must secure one before the main draft
- **Coach overrides** 2 per coach for the whole event
- **Budget protection** participants always retain enough to fill remaining slots at minimum bid
- **Auto-assign** a Pokémon with zero bids goes to its nominator for $50

---