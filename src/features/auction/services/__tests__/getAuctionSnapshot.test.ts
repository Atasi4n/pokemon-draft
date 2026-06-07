import { describe, it, expect, vi } from 'vitest'
import { getAuctionSnapshot } from '../getAuctionSnapshot'
import { makeMockClient, q, EVENT_ID, PARTICIPANT_ID, TURN_ID, POKEMON_ID, COACH_ID } from '@/test/helpers'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_EVENT       = { id: EVENT_ID, slug: 'test', status: 'ACTIVE' }
const MOCK_STATE       = { event_id: EVENT_ID, phase: 'MAIN', status: 'IDLE', current_auction_pokemon_id: null }
const MOCK_STATE_LIVE  = { ...MOCK_STATE, status: 'BIDDING', current_auction_pokemon_id: POKEMON_ID }
const MOCK_PARTICIPANT = { id: PARTICIPANT_ID, event_id: EVENT_ID, user_id: 'u1', budget: 1000, has_mega: false }
const MOCK_COACH       = { id: COACH_ID, event_id: EVENT_ID, user_id: 'u2' }
const MOCK_ASSIGNMENT  = { coach_id: COACH_ID, participant_id: PARTICIPANT_ID, event_id: EVENT_ID }
const MOCK_TURN        = { id: TURN_ID, participant_id: PARTICIPANT_ID, position: 0 }
const MOCK_TEAM_POKE   = { id: 'tp-1', participant_id: PARTICIPANT_ID, species_id: 1 }
const MOCK_AUC_POKE    = { id: POKEMON_ID, species_id: 1, name_snapshot: 'Bulbasaur', status: 'ACTIVE' }
const MOCK_BID         = { id: 'bid-1', participant_id: PARTICIPANT_ID, amount: 100 }

// Provides mocks for the 7 concurrent round-trip-1 queries, in call order.
function setupBaseFromMocks(
  supabase: ReturnType<typeof makeMockClient>['supabase'],
  overrides: {
    event?:           unknown
    state?:           unknown
    participants?:    unknown[]
    teamPokemon?:     unknown[]
    coaches?:         unknown[]
    assignments?:     unknown[]
    turns?:           unknown[]
  } = {},
) {
  supabase.from
    .mockReturnValueOnce(q({ data: overrides.event        ?? MOCK_EVENT }))
    .mockReturnValueOnce(q({ data: overrides.state        ?? MOCK_STATE }))
    .mockReturnValueOnce(q({ data: overrides.participants ?? [MOCK_PARTICIPANT] }))
    .mockReturnValueOnce(q({ data: overrides.teamPokemon  ?? [] }))
    .mockReturnValueOnce(q({ data: overrides.coaches      ?? [] }))
    .mockReturnValueOnce(q({ data: overrides.assignments  ?? [] }))
    .mockReturnValueOnce(q({ data: overrides.turns        ?? [MOCK_TURN] }))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getAuctionSnapshot', () => {
  it('returns null when the event query fails', async () => {
    const { supabase } = makeMockClient()
    setupBaseFromMocks(supabase, { event: undefined })
    // override the first call with an error
    supabase.from.mockReset()
    supabase.from
      .mockReturnValueOnce(q({ error: { message: 'Not found' } }))
      .mockReturnValueOnce(q({ data: MOCK_STATE }))
      .mockReturnValueOnce(q({ data: [MOCK_PARTICIPANT] }))
      .mockReturnValueOnce(q({ data: [] }))
      .mockReturnValueOnce(q({ data: [] }))
      .mockReturnValueOnce(q({ data: [] }))
      .mockReturnValueOnce(q({ data: [MOCK_TURN] }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await getAuctionSnapshot(EVENT_ID)

    expect(result).toBeNull()
  })

  it('returns null when the auction_state query fails', async () => {
    const { supabase } = makeMockClient()
    supabase.from
      .mockReturnValueOnce(q({ data: MOCK_EVENT }))
      .mockReturnValueOnce(q({ error: { message: 'Not found' } }))
      .mockReturnValueOnce(q({ data: [] }))
      .mockReturnValueOnce(q({ data: [] }))
      .mockReturnValueOnce(q({ data: [] }))
      .mockReturnValueOnce(q({ data: [] }))
      .mockReturnValueOnce(q({ data: [] }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await getAuctionSnapshot(EVENT_ID)

    expect(result).toBeNull()
  })

  it('returns a snapshot with participants, turns, and null currentPokemon when no auction is active', async () => {
    const { supabase } = makeMockClient()
    setupBaseFromMocks(supabase)
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await getAuctionSnapshot(EVENT_ID)

    expect(result).not.toBeNull()
    expect(result!.event).toEqual(MOCK_EVENT)
    expect(result!.state).toEqual(MOCK_STATE)
    expect(result!.participants).toHaveLength(1)
    expect(result!.turns).toEqual([MOCK_TURN])
    expect(result!.currentPokemon).toBeNull()
    expect(result!.currentBids).toEqual([])
  })

  it('does not make a second round-trip when current_auction_pokemon_id is null', async () => {
    const { supabase } = makeMockClient()
    setupBaseFromMocks(supabase, { state: MOCK_STATE })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    await getAuctionSnapshot(EVENT_ID)

    expect(supabase.from).toHaveBeenCalledTimes(7)
  })

  it('fetches currentPokemon and bids in a second round-trip when an auction is active', async () => {
    const { supabase } = makeMockClient()
    setupBaseFromMocks(supabase, { state: MOCK_STATE_LIVE })
    supabase.from
      .mockReturnValueOnce(q({ data: MOCK_AUC_POKE }))   // auction_pokemon
      .mockReturnValueOnce(q({ data: [MOCK_BID] }))       // bids
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await getAuctionSnapshot(EVENT_ID)

    expect(result!.currentPokemon).toEqual(MOCK_AUC_POKE)
    expect(result!.currentBids).toEqual([MOCK_BID])
    expect(supabase.from).toHaveBeenCalledTimes(9)
  })

  it('attaches team pokemon to the owning participant', async () => {
    const { supabase } = makeMockClient()
    setupBaseFromMocks(supabase, { teamPokemon: [MOCK_TEAM_POKE] })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await getAuctionSnapshot(EVENT_ID)

    expect(result!.participants[0].team).toEqual([MOCK_TEAM_POKE])
  })

  it('attaches the assigned coach to the participant', async () => {
    const { supabase } = makeMockClient()
    setupBaseFromMocks(supabase, {
      coaches:     [MOCK_COACH],
      assignments: [MOCK_ASSIGNMENT],
    })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await getAuctionSnapshot(EVENT_ID)

    expect(result!.participants[0].coach).toEqual(MOCK_COACH)
  })

  it('leaves coach null for participants with no assignment', async () => {
    const { supabase } = makeMockClient()
    setupBaseFromMocks(supabase, { coaches: [MOCK_COACH], assignments: [] })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await getAuctionSnapshot(EVENT_ID)

    expect(result!.participants[0].coach).toBeNull()
  })
})
