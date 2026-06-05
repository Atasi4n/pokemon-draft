# Pokemon Draft Auction App

Realtime web app for running a pokemon draft auction event. 8 participants each draft a team of 6 pokemon through a live bidding system with coaches, turn order, mega rounds, and a special training session auction.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS v4, shadcn/ui |
| State | Zustand |
| Database | Supabase (PostgreSQL) |
| Realtime | Supabase Realtime |
| Auth | Supabase Auth |
| Deployment | Vercel |

---

## Interfaces

| Route | Audience | Description |
|---|---|---|
| `/stream` | Public | OBS/broadcast view — read-only, fullscreen layout |
| `/host` | Host only | Start event, skip turns, edit budgets, manual assignment |
| `/auction` | Participants, Coaches | Place bids, nominate pokemon, view roster |
| `/mobile` | Participants, Coaches | Minimal companion — timer, bid button, nomination |
| `/login` | All | Username + password login |


---

## Environment variables

Create `.env.local` in the project root:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

`SUPABASE_SERVICE_ROLE_KEY` is only used by seed scripts.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Link Supabase CLI to your project

```bash
npx supabase link --project-ref your-project-id
```

### 3. Apply migrations

```bash
npx supabase db push
```

### 4. Seed pokemon reference data

Run once ever — fetches ~1000 pokemon from PokéAPI and populates `pokemon_meta`. Takes ~5 minutes.

```bash
npx ts-node --project tsconfig.seed.json supabase/seeds/seed_pokemon_meta.ts
```

### 5. Configure the event roster

`src/lib/config/event.config.ts` is gitignored (it contains plaintext passwords). Create it from the template in CLAUDE.md, fill in usernames and passwords for all participants, coaches, and the host.

### 6. Seed event accounts

Run once per event — creates auth users, participant/coach rows, and initial auction state.

```bash
npx ts-node --project tsconfig.seed.json supabase/seeds/seed_event.ts
```

### 7. Activate the event

Log in as the host at `/login` and activate the event from the host interface (`/host`). This makes the event visible to participants.

### 8. Run the dev server

```bash
npm run dev
```

---

## Auction rules summary

- **Budget:** $1000 per participant
- **Bids:** $50 min, $750 max, $25 minimum increment
- **Team size:** 6 pokemon per participant
- **Timer:** 30 seconds per auction, extended by 5s on each new bid
- **Mega round:** Auction opens with mega-capable pokemon only. All participants must secure at least one before the main draft begins.
- **Coach overrides:** Each coach has 2 nomination overrides for the entire event.
- **Budget protection:** A participant must always retain enough budget to fill their remaining roster slots at minimum bid.
- **Auto-assign:** If a nominated pokemon receives zero bids, it goes to the nominator for $50.


## Regenerate TypeScript types

After schema changes, re-generate `database.types.ts`:

```bash
npx supabase gen types typescript --project-id your-project-id > src/types/database.types.ts
```

---

## Commands reference

```bash
npm run dev          Start development server
npm run build        Production build
npm run lint         Run ESLint

npx supabase db push                                          Apply migrations
npx supabase gen types typescript --project-id <id> > ...     Regenerate DB types
npx ts-node --project tsconfig.seed.json supabase/seeds/seed_pokemon_meta.ts
npx ts-node --project tsconfig.seed.json supabase/seeds/seed_event.ts
```
