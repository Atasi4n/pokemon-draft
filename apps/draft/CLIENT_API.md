# Client API — Pokémon Paralímpico

How the frontend talks to the backend. All mutations go through **Server Actions**. All reads come from the **Zustand store**, which is hydrated and kept live by `useAuctionRealtime`.

---

## Quick start — wiring up a page

Every page that needs live auction data follows the same two steps:

```tsx
'use client'

import { useAuctionRealtime } from '@/features/auction/realtime/useAuctionRealtime'
import { useAuctionStore }    from '@/features/auction/hooks/useAuctionStore'

export default function AuctionPage({ eventId }: { eventId: string }) {
  // 1. Mount once — fetches snapshot, subscribes to realtime.
  useAuctionRealtime(eventId)

  // 2. Read whatever you need from the store.
  const state        = useAuctionStore((s) => s.state)
  const participants = useAuctionStore((s) => s.participants)

  // ...
}
```

`useAuctionRealtime` handles everything: initial HTTP fetch, Supabase Realtime subscriptions, and cleanup on unmount. You never need to call it more than once per page.

---

## Reading state — the Zustand store

Import: `import { useAuctionStore } from '@/features/auction/hooks/useAuctionStore'`

| Field | Type | Description |
|---|---|---|
| `event` | `EventRow \| null` | Event metadata (slug, display name, status) |
| `state` | `AuctionStateRow \| null` | Current phase, status, timer, active turn |
| `participants` | `ParticipantWithTeam[]` | All 8 participants with their team and coach attached |
| `currentPokemon` | `AuctionPokemonRow \| null` | The pokemon currently up for auction |
| `currentBids` | `BidRow[]` | Bids for `currentPokemon`, in chronological order |
| `turns` | `AuctionTurnRow[]` | Full turn order, sorted by position |

### `AuctionStateRow` — the fields you'll use most

```ts
state.phase   // 'WAITING' | 'MEGA' | 'MAIN' | 'SPECIAL' | 'ENDED'
state.status  // 'IDLE' | 'NOMINATING' | 'BIDDING' | 'RESOLVING'
state.current_turn_id            // uuid — who nominates next
state.current_auction_pokemon_id // uuid — what's being auctioned right now
state.timer_ends_at              // ISO string — when the bid timer expires
```

### Deriving common values

```ts
const store = useAuctionStore.getState()

// Whose turn is it?
const currentTurn        = store.turns.find(t => t.id === store.state?.current_turn_id)
const currentParticipant = store.participants.find(p => p.id === currentTurn?.participant_id)

// Am I the participant whose turn it is?
// (compare against your own participant id, fetched separately or stored in context)

// Highest bid
const highestBid = store.currentBids.at(-1)?.amount ?? 0

// Countdown — always diff against local clock, never store the timer
const secondsLeft = store.state?.timer_ends_at
  ? Math.max(0, Math.floor((new Date(store.state.timer_ends_at).getTime() - Date.now()) / 1000))
  : 0
```

### Budget protection formula (client-side display only — also enforced server-side)

```ts
const TEAM_SIZE = 6
const MIN_BID   = 50

function maxBidAllowed(participant: ParticipantRow): number {
  const slotsRemaining = TEAM_SIZE - participant.team.length  // use ParticipantWithTeam
  const minReserve     = slotsRemaining * MIN_BID
  return Math.min(participant.budget - minReserve, 750)
}
```

---

## Server Actions

All actions return `{ success: true }` or `{ success: false, error: string }`.

Call them from a `'use client'` component with `startTransition` or directly from a `<form action={...}>`.

### Error handling pattern

```ts
import { startTransition } from 'react'

startTransition(async () => {
  const result = await someAction(...)
  if (!result.success) {
    setError(result.error)  // show to user
    return
  }
  // success — store updates automatically via Realtime
})
```

You never need to manually refresh the store after a successful action — Supabase Realtime delivers the change and the store updates itself.

---

### `bidAction` — place a bid

**Who:** PARTICIPANT only  
**When:** `state.status === 'BIDDING'`

```ts
import { bidAction } from '@/features/auction/actions/bid.action'

const result = await bidAction({
  eventId:          string,  // the event UUID
  auctionPokemonId: string,  // store.currentPokemon.id
  amount:           number,  // integer, 50–750, increments of 25
})
```

**Validation enforced server-side:**
- Status must be BIDDING
- Amount ≥ current highest + $25 (or ≥ $50 if no bids yet)
- Amount ≤ $750
- Budget protection: must keep enough budget for remaining roster slots × $50
- 2-second cooldown between bids per participant

---

### `nominateAction` — nominate a pokemon

**Who:** PARTICIPANT (on their turn) or COACH (uses an override)  
**When:** `state.status === 'IDLE'` and it is the caller's turn

```ts
import { nominateAction } from '@/features/auction/actions/nominate.action'

const result = await nominateAction({
  eventId:  string,  // the event UUID
  speciesId: number, // national dex number (e.g. 1 = Bulbasaur)
})
```

**Notes:**
- In MEGA phase, only mega-capable species are accepted
- Banned species are always rejected (9, 94, 121, 448, 964)
- Coaches automatically spend one of their 2 lifetime overrides
- On success, `auction_state.status` becomes `BIDDING` and the timer starts — the store updates via Realtime

---

### Host-only actions

Import: `import { ... } from '@/features/auction/actions/host.actions'`

All require HOST role. All return `{ success, error? }`.

#### `startEventAction`

Randomises turn order, writes auction_turns, transitions WAITING → MEGA.

```ts
const result = await startEventAction(eventId)
```

Call once, at the beginning of the event. Idempotent guard — fails if turns already exist.

---

#### `skipTurnAction`

Advances to the next participant's turn without nominating.

```ts
const result = await skipTurnAction(eventId)
```

Fails if `state.status === 'BIDDING'` — cancel the auction first.

---

#### `cancelAuctionAction`

Cancels the active auction. The same participant nominates again (turn does **not** advance).

```ts
const result = await cancelAuctionAction(eventId)
```

Fails if no auction is currently active.

---

#### `editBudgetAction`

Directly sets a participant's budget (for corrections).

```ts
const result = await editBudgetAction(
  eventId,       // string
  participantId, // string
  newAmount,     // non-negative integer
)
```

---

#### `assignPokemonAction`

Manually assigns a pokemon to a participant at $0. Cancels any active auction, inserts a team_pokemon row, and advances the turn.

```ts
const result = await assignPokemonAction(
  eventId,       // string
  speciesId,     // number
  participantId, // string
)
```

---

#### `advancePhaseAction`

Manually moves the auction to the next phase.

```ts
const result = await advancePhaseAction(eventId)
```

Valid transitions: `WAITING → MEGA → MAIN → SPECIAL → ENDED`  
Fails if `state.status === 'BIDDING'` — cancel the auction first.

---

### Auth actions

Import: `import { loginAction, logoutAction } from '@/features/auth/actions/auth.actions'`

#### `loginAction`

```ts
const result = await loginAction(username, password)
// username is bare — 'alice', not 'alice@paralimpico.local'
```

On success, navigate to the role-appropriate route — middleware redirects automatically:
- HOST → `/host`
- PARTICIPANT → `/auction`  
- COACH → `/auction`

#### `logoutAction`

```ts
const result = await logoutAction()
// On success, navigate to '/login'
```

---

## Route access

| Route | Who can access |
|---|---|
| `/stream` | Public (no login required) |
| `/login` | Public; redirects if already logged in |
| `/auction` | PARTICIPANT, COACH |
| `/mobile` | PARTICIPANT, COACH |
| `/host` | HOST only |

Middleware enforces this automatically — no need to check roles in page components.

---

## Auction state machine

```
WAITING
  └─ startEvent() ──────────────────────────────► MEGA (phase)
                                                    │
                                    all participants have has_mega
                                                    │
                                                    ▼
                                               MAIN (phase)
                                                    │
                                       all teams full (6 pokemon)
                                                    │
                                                    ▼
                                             SPECIAL (phase)
                                                    │
                                        all special items resolved
                                                    │
                                                    ▼
                                              ENDED (phase)

Within any phase — status cycle per nomination:

  IDLE ──► nominateAction() ──► BIDDING ──► timer expires ──► (server resolves) ──► IDLE
             │                      │
             │                 cancelAuction()
             │                      │
             └──────────────────────┘
                   back to IDLE, same turn
```

**Rule of thumb for the UI:**
- Show the bid interface when `state.status === 'BIDDING'`
- Show the nomination interface when `state.status === 'IDLE'` and it's the user's turn
- Show a waiting state otherwise

---

## Key types (abbreviated)

```ts
// src/types/auction.types.ts

type AuctionPhase  = 'WAITING' | 'MEGA' | 'MAIN' | 'SPECIAL' | 'ENDED'
type AuctionStatus = 'IDLE' | 'NOMINATING' | 'BIDDING' | 'RESOLVING'

type ParticipantWithTeam = ParticipantRow & {
  team:  TeamPokemonRow[]
  coach: CoachRow | null
}

type AuctionSnapshot = {
  event:          EventRow
  state:          AuctionStateRow
  participants:   ParticipantWithTeam[]
  currentPokemon: AuctionPokemonRow | null
  currentBids:    BidRow[]
  turns:          AuctionTurnRow[]
}
```

Full types: [`src/types/auction.types.ts`](src/types/auction.types.ts)
