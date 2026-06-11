import { describe, it, expect, vi } from 'vitest'
import { advanceTurn } from '../advanceTurn'
import { makeMockClient, q, EVENT_ID, TURN_ID } from '@/test/helpers'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase/server'

describe('advanceTurn', () => {
  it('returns error when auction state is missing', async () => {
    const { supabase } = makeMockClient()
    supabase.from.mockReturnValueOnce(q({ error: { message: 'Not found' } }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await advanceTurn(EVENT_ID)

    expect(result).toEqual({ success: false, error: 'Auction state not found.' })
  })

  it('returns error when there is no active turn', async () => {
    const { supabase } = makeMockClient()
    supabase.from.mockReturnValueOnce(q({ data: { current_turn_id: null } }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await advanceTurn(EVENT_ID)

    expect(result).toEqual({ success: false, error: 'No active turn.' })
  })

  it('advances to the next position normally', async () => {
    const { supabase } = makeMockClient()
    supabase.from
      .mockReturnValueOnce(q({ data: { current_turn_id: TURN_ID } }))   // state
      .mockReturnValueOnce(q({ data: { position: 2 } }))                 // current turn (pos 2)
      .mockReturnValueOnce(q({ data: { position: 7 } }))                 // max position = 7
      .mockReturnValueOnce(q({ data: { id: 'turn-next' } }))             // next turn at pos 3
      .mockReturnValueOnce(q({ data: null }))                            // update state
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await advanceTurn(EVENT_ID)

    expect(result).toEqual({ success: true })
  })

  it('wraps back to position 0 when at the last turn', async () => {
    const { supabase } = makeMockClient()
    supabase.from
      .mockReturnValueOnce(q({ data: { current_turn_id: TURN_ID } }))   // state
      .mockReturnValueOnce(q({ data: { position: 7 } }))                 // current turn (pos 7 = max)
      .mockReturnValueOnce(q({ data: { position: 7 } }))                 // max position = 7
      .mockReturnValueOnce(q({ data: { id: 'turn-first' } }))            // turn at pos 0
      .mockReturnValueOnce(q({ data: null }))                            // update state
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await advanceTurn(EVENT_ID)

    expect(result).toEqual({ success: true })
  })
})
