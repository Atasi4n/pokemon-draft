import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  startEventAction,
  skipTurnAction,
  cancelAuctionAction,
  editBudgetAction,
  assignPokemonAction,
  advancePhaseAction,
} from '../host.actions'
import {
  makeMockClient, q, qCount,
  EVENT_ID, PARTICIPANT_ID, TURN_ID,
  MOCK_STATE_BIDDING, MOCK_STATE_IDLE,
  MOCK_POKEMON_META, SPECIES_ID,
} from '@/test/helpers'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/features/auction/engine/startEvent', () => ({
  startEvent: vi.fn(),
}))

vi.mock('@/features/auction/engine/advanceTurn', () => ({
  advanceTurn: vi.fn(),
}))

vi.mock('@/features/auction/engine/checkMegaPhase', () => ({
  checkMegaPhase: vi.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { startEvent }    from '@/features/auction/engine/startEvent'
import { advanceTurn }   from '@/features/auction/engine/advanceTurn'
import { checkMegaPhase } from '@/features/auction/engine/checkMegaPhase'

// ---------------------------------------------------------------------------
// Shared auth setup helpers
// ---------------------------------------------------------------------------

function buildHostClient() {
  const { supabase } = makeMockClient()
  supabase.from.mockReturnValueOnce(q({ data: { role: 'HOST' } }))
  return supabase
}

function buildNonHostClient(role = 'PARTICIPANT') {
  const { supabase } = makeMockClient()
  supabase.from.mockReturnValueOnce(q({ data: { role } }))
  return supabase
}

beforeEach(() => {
  vi.mocked(startEvent).mockResolvedValue({ success: true })
  vi.mocked(advanceTurn).mockResolvedValue({ success: true })
  vi.mocked(checkMegaPhase).mockResolvedValue({ success: true, transitioned: false })
})

// ---------------------------------------------------------------------------
// Shared auth guard — tested once, applies to all actions
// ---------------------------------------------------------------------------
describe('requireHost guard', () => {
  it('returns error when user is not authenticated', async () => {
    const { supabase } = makeMockClient({ user: null })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await startEventAction(EVENT_ID)

    expect(result).toEqual({ success: false, error: 'Not authenticated.' })
  })

  it('returns error when user role is PARTICIPANT', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(buildNonHostClient('PARTICIPANT') as any)

    const result = await startEventAction(EVENT_ID)

    expect(result).toEqual({ success: false, error: 'Host access required.' })
  })

  it('returns error when user role is COACH', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(buildNonHostClient('COACH') as any)

    const result = await startEventAction(EVENT_ID)

    expect(result).toEqual({ success: false, error: 'Host access required.' })
  })
})

// ---------------------------------------------------------------------------
// startEventAction
// ---------------------------------------------------------------------------
describe('startEventAction', () => {
  it('delegates to startEvent engine and returns success', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(buildHostClient() as any)

    const result = await startEventAction(EVENT_ID)

    expect(startEvent).toHaveBeenCalledWith(EVENT_ID)
    expect(result).toEqual({ success: true })
  })

  it('propagates engine errors', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(buildHostClient() as any)
    vi.mocked(startEvent).mockResolvedValue({ success: false, error: 'Auction has already been started for this event.' })

    const result = await startEventAction(EVENT_ID)

    expect(result).toEqual({ success: false, error: 'Auction has already been started for this event.' })
  })
})

// ---------------------------------------------------------------------------
// skipTurnAction
// ---------------------------------------------------------------------------
describe('skipTurnAction', () => {
  it('returns error when an auction is currently in progress', async () => {
    const supabase = buildHostClient()
    supabase.from.mockReturnValueOnce(q({ data: { status: 'BIDDING' } }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await skipTurnAction(EVENT_ID)

    expect(result).toEqual({
      success: false,
      error:   'An auction is in progress. Cancel it before skipping the turn.',
    })
  })

  it('delegates to advanceTurn when no auction is running', async () => {
    const supabase = buildHostClient()
    supabase.from.mockReturnValueOnce(q({ data: { status: 'IDLE' } }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await skipTurnAction(EVENT_ID)

    expect(advanceTurn).toHaveBeenCalledWith(EVENT_ID)
    expect(result).toEqual({ success: true })
  })
})

// ---------------------------------------------------------------------------
// cancelAuctionAction
// ---------------------------------------------------------------------------
describe('cancelAuctionAction', () => {
  it('returns error when no auction is running', async () => {
    const supabase = buildHostClient()
    supabase.from.mockReturnValueOnce(q({ data: { status: 'IDLE', current_auction_pokemon_id: null } }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await cancelAuctionAction(EVENT_ID)

    expect(result).toEqual({ success: false, error: 'No active auction to cancel.' })
  })

  it('cancels auction_pokemon and resets state to IDLE', async () => {
    const supabase = buildHostClient()
    supabase.from
      .mockReturnValueOnce(q({ data: { status: 'BIDDING', current_auction_pokemon_id: 'pokemon-uuid' } }))
      .mockReturnValueOnce(q({ data: null }))  // update auction_pokemon → CANCELLED
      .mockReturnValueOnce(q({ data: null }))  // update auction_state → IDLE
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await cancelAuctionAction(EVENT_ID)

    expect(result).toEqual({ success: true })
  })
})

// ---------------------------------------------------------------------------
// editBudgetAction
// ---------------------------------------------------------------------------
describe('editBudgetAction', () => {
  it('returns error when newAmount is negative', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(buildHostClient() as any)

    const result = await editBudgetAction(EVENT_ID, PARTICIPANT_ID, -50)

    expect(result).toEqual({ success: false, error: 'Budget must be a non-negative integer.' })
  })

  it('returns error when newAmount is a float', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(buildHostClient() as any)

    const result = await editBudgetAction(EVENT_ID, PARTICIPANT_ID, 100.5)

    expect(result).toEqual({ success: false, error: 'Budget must be a non-negative integer.' })
  })

  it('updates participant budget and returns success', async () => {
    const supabase = buildHostClient()
    supabase.from.mockReturnValueOnce(q({ data: null }))  // update
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await editBudgetAction(EVENT_ID, PARTICIPANT_ID, 500)

    expect(result).toEqual({ success: true })
  })

  it('allows setting budget to 0', async () => {
    const supabase = buildHostClient()
    supabase.from.mockReturnValueOnce(q({ data: null }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await editBudgetAction(EVENT_ID, PARTICIPANT_ID, 0)

    expect(result).toEqual({ success: true })
  })
})

// ---------------------------------------------------------------------------
// assignPokemonAction
// ---------------------------------------------------------------------------
describe('assignPokemonAction', () => {
  it('returns error for a banned species', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(buildHostClient() as any)

    const result = await assignPokemonAction(EVENT_ID, 9, PARTICIPANT_ID)  // Blastoise

    expect(result).toEqual({ success: false, error: 'This Pokemon is banned from the auction.' })
  })

  it('returns error when pokemon is not in the Champions format', async () => {
    const supabase = buildHostClient()
    supabase.from.mockReturnValueOnce(q({ error: { message: 'Not found' } }))  // pokemon_meta miss
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await assignPokemonAction(EVENT_ID, 999, PARTICIPANT_ID)

    expect(result).toEqual({ success: false, error: 'Pokemon not found in the Champions format.' })
  })

  it('returns error when the species is already on this participant\'s team', async () => {
    const supabase = buildHostClient()
    supabase.from
      .mockReturnValueOnce(q({ data: MOCK_POKEMON_META }))  // pokemon_meta
      .mockReturnValueOnce(qCount(1))                        // already on team
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await assignPokemonAction(EVENT_ID, SPECIES_ID, PARTICIPANT_ID)

    expect(result).toEqual({ success: false, error: expect.stringContaining('already on') })
  })

  it('returns error when participant team is full', async () => {
    const supabase = buildHostClient()
    supabase.from
      .mockReturnValueOnce(q({ data: MOCK_POKEMON_META }))  // pokemon_meta
      .mockReturnValueOnce(qCount(0))                        // not already this species
      .mockReturnValueOnce(qCount(6))                        // team full (6 = TEAM_SIZE)
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await assignPokemonAction(EVENT_ID, SPECIES_ID, PARTICIPANT_ID)

    expect(result).toEqual({ success: false, error: expect.stringContaining('full') })
  })

  it('returns success and calls advanceTurn + checkMegaPhase on the happy path', async () => {
    const supabase = buildHostClient()
    supabase.from
      .mockReturnValueOnce(q({ data: MOCK_POKEMON_META }))              // pokemon_meta
      .mockReturnValueOnce(qCount(0))                                    // species not on team
      .mockReturnValueOnce(qCount(3))                                    // team size = 3 (room)
      .mockReturnValueOnce(q({ data: { status: 'IDLE', current_auction_pokemon_id: null } }))
      .mockReturnValueOnce(q({ data: { id: 'auction-pokemon-uuid' } })) // auction_pokemon insert
      .mockReturnValueOnce(q({ data: null }))                           // team_pokemon insert
      .mockReturnValueOnce(q({ data: null }))                           // reset auction_state
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await assignPokemonAction(EVENT_ID, SPECIES_ID, PARTICIPANT_ID)

    expect(advanceTurn).toHaveBeenCalledWith(EVENT_ID)
    expect(checkMegaPhase).toHaveBeenCalledWith(EVENT_ID)
    expect(result).toEqual({ success: true })
  })
})

// ---------------------------------------------------------------------------
// advancePhaseAction
// ---------------------------------------------------------------------------
describe('advancePhaseAction', () => {
  it('returns error when an auction is in progress', async () => {
    const supabase = buildHostClient()
    supabase.from.mockReturnValueOnce(q({ data: { phase: 'MAIN', status: 'BIDDING' } }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await advancePhaseAction(EVENT_ID)

    expect(result).toEqual({
      success: false,
      error:   'An auction is in progress. Cancel it before advancing the phase.',
    })
  })

  it('returns error when phase is already ENDED', async () => {
    const supabase = buildHostClient()
    supabase.from.mockReturnValueOnce(q({ data: { phase: 'ENDED', status: 'IDLE' } }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await advancePhaseAction(EVENT_ID)

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('ENDED') })
  })

  it.each([
    ['WAITING', 'MEGA'],
    ['MEGA',    'MAIN'],
    ['MAIN',    'SPECIAL'],
    ['SPECIAL', 'ENDED'],
  ])('advances from %s to %s', async (from, _to) => {
    const supabase = buildHostClient()
    supabase.from
      .mockReturnValueOnce(q({ data: { phase: from, status: 'IDLE' } }))
      .mockReturnValueOnce(q({ data: null }))  // update
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await advancePhaseAction(EVENT_ID)

    expect(result).toEqual({ success: true })
  })
})
