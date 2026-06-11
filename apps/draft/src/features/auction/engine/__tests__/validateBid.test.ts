import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateBid } from '../validateBid'
import {
  makeMockClient, q, qCount,
  EVENT_ID, PARTICIPANT_ID, POKEMON_ID,
  MOCK_STATE_BIDDING,
} from '@/test/helpers'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase/server'

const VALID_AMOUNT = 50  // exactly MIN_BID, no existing bids

function buildValidClient() {
  const { supabase } = makeMockClient()
  supabase.from
    // Rule 1: auction state → BIDDING
    .mockReturnValueOnce(q({ data: MOCK_STATE_BIDDING }))
    // Rule 4: highest bid → none (so MIN_BID threshold applies)
    .mockReturnValueOnce(q({ data: null }))
    // Rule 5: anti-spam → no recent bid
    .mockReturnValueOnce(q({ data: null }))
    // Rule 6: participant budget
    .mockReturnValueOnce(q({ data: { budget: 1000 } }))
    // Rule 6: team pokemon count (3 pokemon → 3 slots remaining, reserve = $150)
    .mockReturnValueOnce(qCount(3))
  return supabase
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockResolvedValue(buildValidClient() as any)
})

describe('validateBid', () => {
  describe('Rule 1 — auction must be BIDDING', () => {
    it('returns error when auction_state row is missing', async () => {
      const { supabase } = makeMockClient()
      supabase.from.mockReturnValueOnce(q({ error: { message: 'Not found' } }))
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateBid({ eventId: EVENT_ID, participantId: PARTICIPANT_ID, amount: 50 })

      expect(result).toEqual({ valid: false, reason: 'Auction state not found.' })
    })

    it('returns error when status is IDLE', async () => {
      const { supabase } = makeMockClient()
      supabase.from.mockReturnValueOnce(q({ data: { ...MOCK_STATE_BIDDING, status: 'IDLE' } }))
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateBid({ eventId: EVENT_ID, participantId: PARTICIPANT_ID, amount: 50 })

      expect(result).toEqual({ valid: false, reason: 'Bidding is not currently open.' })
    })

    it('returns error when status is RESOLVING', async () => {
      const { supabase } = makeMockClient()
      supabase.from.mockReturnValueOnce(q({ data: { ...MOCK_STATE_BIDDING, status: 'RESOLVING' } }))
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateBid({ eventId: EVENT_ID, participantId: PARTICIPANT_ID, amount: 50 })

      expect(result).toEqual({ valid: false, reason: 'Bidding is not currently open.' })
    })
  })

  describe('Rule 2 — amount >= MIN_BID ($50)', () => {
    it('returns error when amount is below MIN_BID', async () => {
      const { supabase } = makeMockClient()
      supabase.from.mockReturnValueOnce(q({ data: MOCK_STATE_BIDDING }))
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateBid({ eventId: EVENT_ID, participantId: PARTICIPANT_ID, amount: 49 })

      expect(result).toEqual({ valid: false, reason: 'Minimum bid is $50.' })
    })
  })

  describe('Rule 3 — amount <= MAX_BID ($750)', () => {
    it('returns error when amount exceeds MAX_BID', async () => {
      const { supabase } = makeMockClient()
      supabase.from.mockReturnValueOnce(q({ data: MOCK_STATE_BIDDING }))
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateBid({ eventId: EVENT_ID, participantId: PARTICIPANT_ID, amount: 751 })

      expect(result).toEqual({ valid: false, reason: 'Maximum bid is $750.' })
    })
  })

  describe('Rule 4 — amount >= highest bid + MIN_INCREMENT ($25)', () => {
    it('returns error when bid does not beat the current highest by MIN_INCREMENT', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_BIDDING }))
        .mockReturnValueOnce(q({ data: { amount: 200 } }))  // highest bid is $200
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      // Needs at least $225; bidding $224 fails
      const result = await validateBid({ eventId: EVENT_ID, participantId: PARTICIPANT_ID, amount: 224 })

      expect(result.valid).toBe(false)
      expect(result).toMatchObject({ valid: false, reason: expect.stringContaining('225') })
    })

    it('allows bid that exactly meets the current highest + increment', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_BIDDING }))
        .mockReturnValueOnce(q({ data: { amount: 200 } }))  // highest bid $200 → need $225
        .mockReturnValueOnce(q({ data: null }))              // no recent bid for anti-spam
        .mockReturnValueOnce(q({ data: { budget: 1000 } })) // budget check
        .mockReturnValueOnce(qCount(3))                      // team size → 3 slots left
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateBid({ eventId: EVENT_ID, participantId: PARTICIPANT_ID, amount: 225 })

      expect(result).toEqual({ valid: true })
    })
  })

  describe('Rule 5 — anti-spam: cooldown between bids', () => {
    it('returns error when last bid was placed too recently', async () => {
      const recentBidTime = new Date(Date.now() - 500).toISOString()  // 0.5s ago
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_BIDDING }))
        .mockReturnValueOnce(q({ data: null }))
        .mockReturnValueOnce(q({ data: { placed_at: recentBidTime } }))
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateBid({ eventId: EVENT_ID, participantId: PARTICIPANT_ID, amount: 50 })

      expect(result.valid).toBe(false)
      expect(result).toMatchObject({ valid: false, reason: expect.stringContaining('wait') })
    })

    it('allows bid after cooldown has passed', async () => {
      const oldBidTime = new Date(Date.now() - 3_000).toISOString()  // 3s ago (> 2s cooldown)
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_BIDDING }))
        .mockReturnValueOnce(q({ data: null }))              // no current highest bid
        .mockReturnValueOnce(q({ data: { placed_at: oldBidTime } }))
        .mockReturnValueOnce(q({ data: { budget: 1000 } }))
        .mockReturnValueOnce(qCount(3))
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateBid({ eventId: EVENT_ID, participantId: PARTICIPANT_ID, amount: 50 })

      expect(result).toEqual({ valid: true })
    })
  })

  describe('Rule 6 — budget protection', () => {
    it('returns error when spending would leave insufficient reserve', async () => {
      // 2 slots remaining → must keep $100 reserve
      // budget = $200, bidding $110 → remaining = $90 < $100 reserve
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_BIDDING }))
        .mockReturnValueOnce(q({ data: null }))
        .mockReturnValueOnce(q({ data: null }))
        .mockReturnValueOnce(q({ data: { budget: 200 } }))
        .mockReturnValueOnce(qCount(4))  // 4 pokemon → 2 slots left → $100 reserve
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateBid({ eventId: EVENT_ID, participantId: PARTICIPANT_ID, amount: 110 })

      expect(result.valid).toBe(false)
      expect(result).toMatchObject({ valid: false, reason: expect.stringContaining('reserve') })
    })

    it('allows bid that exactly meets the reserve requirement', async () => {
      // 2 slots remaining → $100 reserve, budget $250, bid $150 → left = $100 = reserve ✓
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_BIDDING }))
        .mockReturnValueOnce(q({ data: null }))
        .mockReturnValueOnce(q({ data: null }))
        .mockReturnValueOnce(q({ data: { budget: 250 } }))
        .mockReturnValueOnce(qCount(4))
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateBid({ eventId: EVENT_ID, participantId: PARTICIPANT_ID, amount: 150 })

      expect(result).toEqual({ valid: true })
    })

    it('returns error when participant row is missing', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_BIDDING }))
        .mockReturnValueOnce(q({ data: null }))
        .mockReturnValueOnce(q({ data: null }))
        .mockReturnValueOnce(q({ error: { message: 'Not found' } }))  // participant missing
        .mockReturnValueOnce(qCount(3))
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateBid({ eventId: EVENT_ID, participantId: PARTICIPANT_ID, amount: 50 })

      expect(result).toEqual({ valid: false, reason: 'Participant not found.' })
    })
  })

  it('returns valid: true when all rules pass', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(buildValidClient() as any)

    const result = await validateBid({ eventId: EVENT_ID, participantId: PARTICIPANT_ID, amount: VALID_AMOUNT })

    expect(result).toEqual({ valid: true })
  })
})
