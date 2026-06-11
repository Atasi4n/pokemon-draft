import { vi } from 'vitest'

// ---------------------------------------------------------------------------
// Query builder factories
// ---------------------------------------------------------------------------

/**
 * Standard chainable query builder: ends with .single() or .maybeSingle().
 * Pass `data` for success, `error` for a DB error.
 */
export function q(result: { data?: unknown; error?: unknown } = {}) {
  const resolved = { data: result.data ?? null, error: result.error ?? null }
  const chain: Record<string, unknown> = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    neq:         vi.fn().mockReturnThis(),
    order:       vi.fn().mockReturnThis(),
    limit:       vi.fn().mockReturnThis(),
    insert:      vi.fn().mockReturnThis(),
    update:      vi.fn().mockReturnThis(),
    delete:      vi.fn().mockReturnThis(),
    gte:         vi.fn().mockReturnThis(),
    single:      vi.fn().mockResolvedValue(resolved),
    maybeSingle: vi.fn().mockResolvedValue(resolved),
    // Thenable so `await q(...)` works for array selects, updates, and inserts
    // that don't end with .single() or .maybeSingle().
    then: (onFulfilled: (v: typeof resolved) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolved).then(onFulfilled, onRejected),
  }
  return chain
}

/**
 * Count query builder: awaited directly (no .single()).
 * Resolves to { count, data: null, error }.
 */
export function qCount(count: number | null, error: unknown = null) {
  const resolve = { data: null, count, error }
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    gte:    vi.fn().mockReturnThis(),
    // thenable so `await qCount(...)` resolves directly
    then: (onFulfilled: (v: typeof resolve) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve).then(onFulfilled, onRejected),
  }
  return chain
}

// ---------------------------------------------------------------------------
// Full Supabase client mock
// ---------------------------------------------------------------------------

export type MockFromFn = ReturnType<typeof vi.fn>

/**
 * Builds a mock Supabase client where `.from()` calls can be configured
 * using mockReturnValueOnce chains.
 *
 * Example:
 *   const { supabase } = makeMockClient()
 *   supabase.from
 *     .mockReturnValueOnce(q({ data: { status: 'BIDDING' } }))   // call 1
 *     .mockReturnValueOnce(q({ data: { amount: 100 } }))          // call 2
 */
export function makeMockClient(opts: {
  user?: { id: string } | null
  rpc?: { data?: unknown; error?: unknown }
} = {}) {
  const user = opts.user !== undefined ? opts.user : { id: 'user-uuid' }

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: 'Not authenticated' },
      }),
    },
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({
      data:  opts.rpc?.data  ?? null,
      error: opts.rpc?.error ?? null,
    }),
  }

  return { supabase }
}

// ---------------------------------------------------------------------------
// Common test data fixtures
// ---------------------------------------------------------------------------

export const EVENT_ID       = 'event-uuid'
export const PARTICIPANT_ID = 'participant-uuid'
export const COACH_ID       = 'coach-uuid'
export const POKEMON_ID     = 'pokemon-uuid'
export const TURN_ID        = 'turn-uuid'
export const USER_ID        = 'user-uuid'
export const SPECIES_ID     = 1  // Bulbasaur — not banned, not mega-capable
export const MEGA_SPECIES_ID = 3 // Venusaur — mega-capable

export const MOCK_STATE_BIDDING = {
  phase:                      'MAIN',
  status:                     'BIDDING',
  current_auction_pokemon_id: POKEMON_ID,
  current_turn_id:            TURN_ID,
  timer_ends_at:              new Date(Date.now() + 30_000).toISOString(),
}

export const MOCK_STATE_IDLE = {
  phase:                      'MAIN',
  status:                     'IDLE',
  current_auction_pokemon_id: null,
  current_turn_id:            TURN_ID,
  timer_ends_at:              null,
}

export const MOCK_STATE_MEGA = {
  phase:                      'MEGA',
  status:                     'IDLE',
  current_auction_pokemon_id: null,
  current_turn_id:            TURN_ID,
  timer_ends_at:              null,
}

export const MOCK_PARTICIPANT = {
  id:           PARTICIPANT_ID,
  budget:       1000,
  has_mega:     false,
}

export const MOCK_POKEMON_META = {
  species_id:      SPECIES_ID,
  name:            'Bulbasaur',
  sprite_front:    'https://example.com/bulbasaur.png',
  is_mega_capable: false,
}

export const MOCK_MEGA_POKEMON_META = {
  species_id:      MEGA_SPECIES_ID,
  name:            'Venusaur',
  sprite_front:    'https://example.com/venusaur.png',
  is_mega_capable: true,
}
