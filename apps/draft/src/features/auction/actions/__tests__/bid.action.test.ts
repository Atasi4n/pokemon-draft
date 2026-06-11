import { describe, it, expect, vi, beforeEach } from 'vitest'
import { bidAction } from '../bid.action'
import { makeMockClient, q, EVENT_ID, PARTICIPANT_ID } from '@/test/helpers'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/features/auction/engine/placeBid', () => ({
  placeBid: vi.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { placeBid } from '@/features/auction/engine/placeBid'

const AUCTION_POKEMON_ID = 'auction-pokemon-uuid'
const INPUT = { eventId: EVENT_ID, auctionPokemonId: AUCTION_POKEMON_ID, amount: 100 }

function buildAuthClient(role = 'PARTICIPANT') {
  const { supabase } = makeMockClient({ user: { id: 'user-uuid' } })
  supabase.from
    .mockReturnValueOnce(q({ data: { role } }))            // users.role
    .mockReturnValueOnce(q({ data: { id: PARTICIPANT_ID } }))  // participants row
  return supabase
}

beforeEach(() => {
  vi.mocked(placeBid).mockResolvedValue({
    success: true,
    newTimerEndsAt: new Date(Date.now() + 30_000).toISOString(),
  })
})

describe('bidAction', () => {
  it('returns error when user is not authenticated', async () => {
    const { supabase } = makeMockClient({ user: null })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await bidAction(INPUT)

    expect(result).toEqual({ success: false, error: 'Not authenticated.' })
  })

  it('returns error when user role is COACH', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(buildAuthClient('COACH') as any)

    const result = await bidAction(INPUT)

    expect(result).toEqual({ success: false, error: 'Only participants can place bids.' })
  })

  it('returns error when user role is HOST', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(buildAuthClient('HOST') as any)

    const result = await bidAction(INPUT)

    expect(result).toEqual({ success: false, error: 'Only participants can place bids.' })
  })

  it('returns error when participant row is not found for this event', async () => {
    const { supabase } = makeMockClient()
    supabase.from
      .mockReturnValueOnce(q({ data: { role: 'PARTICIPANT' } }))
      .mockReturnValueOnce(q({ data: null, error: { message: 'Not found' } }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await bidAction(INPUT)

    expect(result).toEqual({ success: false, error: 'Participant not found for this event.' })
  })

  it('returns error from engine when placeBid fails validation', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(buildAuthClient() as any)
    vi.mocked(placeBid).mockResolvedValue({ success: false, error: 'Bidding is not currently open.' })

    const result = await bidAction(INPUT)

    expect(result).toEqual({ success: false, error: 'Bidding is not currently open.' })
  })

  it('delegates to placeBid engine with the resolved participant id', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(buildAuthClient() as any)

    await bidAction(INPUT)

    expect(placeBid).toHaveBeenCalledWith({
      eventId:          EVENT_ID,
      participantId:    PARTICIPANT_ID,
      auctionPokemonId: AUCTION_POKEMON_ID,
      amount:           100,
    })
  })

  it('returns success when the engine succeeds', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(buildAuthClient() as any)

    const result = await bidAction(INPUT)

    expect(result).toEqual({ success: true })
  })
})
