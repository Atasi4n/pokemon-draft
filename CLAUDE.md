@AGENTS.md
# Axoloto — Pokémon monorepo

Read this fully before writing code. It is the contract for how this repo works.

## What this is

A pnpm + Turborepo monorepo for the **Axoloto** Pokémon project. Two apps share one Supabase database:

- **`apps/draft`** (`draft.axoloto.app`) — realtime auction app for the one-off **Pokémon Paralímpico** event: 8 participants, 8 coaches, 1 host bidding live for teams of 6. This is the mature app.
- **`apps/team`** (`team.axoloto.app`) — Tinder-style Pokémon swiper / wishlist builder. Read-only, no auth, no DB writes. (Not built yet.)
- **`apps/web`** (`axoloto.app`) — landing page. (Not built yet.)

Each app deploys as its own Vercel project (Root Directory = `apps/<name>`). The `supabase/` dir is shared infra, deployed by neither.

## Monorepo layout

```
axoloto/
├── apps/
│   ├── draft/        ← auction app (Next.js 16, App Router)
│   ├── team/         ← swiper app (not built)
│   └── web/          ← landing (not built)
├── packages/
│   └── supabase/     ← @axoloto/supabase: shared DB types + anon browser client
├── supabase/         ← migrations, edge functions, seeds (shared DB — STAYS at root)
├── pnpm-workspace.yaml, turbo.json, tsconfig.seed.json
└── package.json      ← workspace root (turbo + seed scripts)
```

**`@axoloto/supabase`** exports only the `Database` type + `createBrowserSupabaseClient()` (anon key). The service-role/server clients live in `apps/draft` and must NEVER be exported to a package or shipped to the browser. `apps/draft` re-exports `Database` via a shim at `src/types/database.types.ts` so its `@/types/database.types` imports stay valid — regenerate types into `packages/supabase/src/database.types.ts`.

## Core architectural rules — never break these

1. **ALL auction logic runs server-side.** The client never decides bid validity, winners, timer expiry, or phase changes. Clients display data, send actions, subscribe to realtime.
2. **Realtime is sync only.** Subscriptions update UI. They contain no business logic.
3. **Feature-based structure.** Logic lives in `src/features/`, not global `components/`/`services/`/`hooks/`.
4. **Never trust client input.** Every client action is re-validated server-side before any DB write.
5. **The engine is the heart.** All auction rules live in `apps/draft/src/features/auction/engine/`. UI never contains rules and never imports the engine directly — only Server Actions do.
6. **`apps/team` never writes to the DB.** Anon key, read-only, fully client-side after initial fetch.

## Draft app structure (`apps/draft/src/`)

```
app/            login/ auction/ stream/ host/ mobile/ api/
features/
  auction/      actions/ components/ engine/ hooks/ realtime/ services/ types/ utils/ validators/
  auth/ host/ participants/ pokemon/ teams/
lib/
  config/       auction.config.ts (rules/constants), event.config.ts (roster + creds, GITIGNORED)
  supabase/     client.ts (browser), server.ts (cookies, respects RLS), admin.ts (service role — seeds ONLY)
server/         auction/ auth/ database/ realtime/   (server-only helpers)
types/          auction.types.ts (DB rows + enums), database.types.ts (shim → @axoloto/supabase)
```

| Supabase client | File | RLS | Use |
|---|---|---|---|
| Browser | `lib/supabase/client.ts` | yes | React components |
| Server | `lib/supabase/server.ts` | yes | Server Actions, Route Handlers |
| Admin | `lib/supabase/admin.ts` | **bypasses** | Seed scripts ONLY — never browser-reachable |

## Auction config (source of truth: `auction.config.ts`)

```
INITIAL_BUDGET 1000   MIN_BID 50   MAX_BID 750   MIN_INCREMENT 25   TEAM_SIZE 6
TIMER_SECONDS 30   BID_EXTENSION_SECS 5 (never exceeds TIMER)   BID_COOLDOWN_SECS 2
COACH_OVERRIDES 2 (per coach, whole event)   BAN_VIOLATION_PENALTY 100
BANNED_SPECIES_IDS [9, 94, 121, 448, 964]  (by species_id → covers all forms)
```

**Budget protection:** `max_bid_allowed = min(budget - (TEAM_SIZE - team_size) * MIN_BID, MAX_BID)`. A participant must always retain enough to fill remaining slots at MIN_BID.

## Event rules

**Phases:** WAITING → MEGA → MAIN → SPECIAL → ENDED
- **MEGA**: only `is_mega_capable` pokemon nominable; ends when all participants have `has_mega = true`. Players draft the BASE form (mega evolves in battle). Banned species never appear, even here.
- **MAIN**: turn-based nomination draft. Mega-capable pokemon may still be drafted.
- **SPECIAL**: after all teams hit 6 pokemon — one training-session item per coach; each participant wins at most 1; no bids → FREE ($0) to the coach's paired participant.

**Turns:** order randomized once at start (`auction_turns`, never mutated). Nominator picks; zero bids → auto-assigned to nominator at MIN_BID. Coach may override (2/event); participant may delegate to host.

**Bidding:** starts at MIN_BID; each bid ≥ current + MIN_INCREMENT, ≤ MAX_BID; timer extends BID_EXTENSION_SECS (capped at TIMER); 2s server-side cooldown; host can undo last bid.

## Engine files (`features/auction/engine/`, server-only)

`validateNomination` · `validateBid` · `placeBid` (validate + atomic RPC) · `resolveAuction` (timer expiry: winner, budget, has_mega, advance turn) · `advanceTurn` · `checkMegaPhase` (auto MEGA→MAIN) · `startEvent` (randomize order, WAITING→MEGA) · `finishAuction` (SPECIAL→ENDED).

**Two operations MUST be atomic Postgres RPCs** (race safety):
- `place_bid()` — lock auction_state FOR UPDATE, validate > highest, insert bid, extend timer.
- `resolve_auction()` — highest bid → team_pokemon, deduct budget, update has_mega, mark SOLD, advance turn. **Must be idempotent.**

**Server Actions** (`features/auction/actions/`) are thin wrappers: authenticate → resolve identity → call engine → return `{ success, data?, error? }`. Never leak internal errors to the client.

## Timer

Lives in `auction_state.timer_ends_at` (timestamptz). Clients diff against local clock to display; they never store or trigger expiry. Expiry is resolved server-side (Supabase edge function on cron / `pg_cron` → `resolve_auction()`). Client at 0 just shows 0 and waits for the realtime broadcast.

## Realtime

On load: fetch full snapshot over HTTP first, THEN subscribe. Never rely on realtime for initial state. Subscribed tables (UI updates only): `auction_state`, `bids` (filtered by current pokemon), `participants`, `team_pokemon`.

## Database schema (Postgres / Supabase)

**Global:** `users` (id=auth.users.id, username, role HOST|PARTICIPANT|COACH) · `pokemon_meta` (species_id PK = national dex, name, is_mega_capable, sprite, types[], `ability`) · `events` (slug, status DRAFT|ACTIVE|ARCHIVED, config_key).

**Event-scoped** (all carry `event_id`):
- `participants` — budget (default 1000, CHECK ≥0), has_mega, special_session_won, connection_status. UNIQUE(event_id, user_id).
- `coaches`, `coach_participants` (join, overrides_remaining default 2).
- `auction_turns` — written once at start; UNIQUE(event_id, position) & (event_id, participant_id).
- `auction_state` — exactly ONE row/event, mutated in place. phase, status (IDLE|NOMINATING|BIDDING|RESOLVING), current_turn_id, current_auction_pokemon_id, timer_ends_at, host_override_active.
- `auction_pokemon` — species_id + name/sprite snapshot (PokéAPI-downtime resilient), nominated_by, status ACTIVE|SOLD|CANCELLED, sold_to/sold_price.
- `bids` — append-only, never updated/deleted. amount CHECK 50–750. placed_at = DB default.
- `team_pokemon` — written by resolve_auction. species_id, snapshots, is_mega_capable, purchase_price. UNIQUE(event_id, participant_id, species_id) enforces one-form-per-line.
- `special_auction_items` — one per coach, status PENDING|ACTIVE|SOLD|FREE.

Key conventions: snapshot name+sprite at nomination time; identity keyed by `species_id` (all forms of a line share it); banned list in config (version-controlled), not DB.

## Auth

No public signup. Credentials seeded before the event. Auth email format `username@paralimpico.local`. Role in `users.role` (read via `auth_user_role()` SQL helper). `middleware.ts`: `/host/*`→HOST, `/auction/*` & `/mobile/*`→PARTICIPANT|COACH, `/stream/*` & `/login`→public.

## Commands

Package manager is **pnpm 9** (pinned via `packageManager`). If the global `pnpm` shim is missing, invoke as `corepack pnpm@9.15.0 …` (or run `corepack enable pnpm` once in an elevated shell).

```bash
pnpm install                              # install workspace
pnpm --filter @axoloto/draft dev          # run draft app
pnpm --filter @axoloto/draft test         # vitest (draft)
pnpm build                                # turbo build all apps
pnpm seed:pokemon                         # seed pokemon_meta (once ever, ~1–2 min)
pnpm seed:event                           # seed event accounts (once per event)

npx supabase db push                      # apply migrations
npx supabase gen types typescript --project-id <id> > packages/supabase/src/database.types.ts
```

## Env vars

`apps/draft/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (seeds only). `apps/team` will need only the two `NEXT_PUBLIC_*` vars. Never commit `.env*` or `event.config.ts`.
