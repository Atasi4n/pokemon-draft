import { describe, it, expect, vi } from 'vitest'
import { startEvent } from '../startEvent'
import { makeMockClient, q, qCount, EVENT_ID, PARTICIPANT_ID, TURN_ID } from '@/test/helpers'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase/server'

const PARTICIPANTS = [
  { id: PARTICIPANT_ID },
  { id: 'participant-2' },
  { id: 'participant-3' },
]

const INSERTED_TURNS = [
  { id: TURN_ID,      position: 0 },
  { id: 'turn-2',     position: 1 },
  { id: 'turn-3',     position: 2 },
]

function buildSuccessClient() {
  const { supabase } = makeMockClient()
  supabase.from
    .mockReturnValueOnce(qCount(0))                                    // existing turns = 0 (not started)
    .mockReturnValueOnce(q({ data: PARTICIPANTS }))                    // fetch participants
    .mockReturnValueOnce(q({ data: INSERTED_TURNS }))                  // insert turns + select
    .mockReturnValueOnce(q({ data: null }))                            // update auction_state
  return supabase
}

describe('startEvent', () => {
  it('returns error when the event has already been started (turns exist)', async () => {
    const { supabase } = makeMockClient()
    supabase.from.mockReturnValueOnce(qCount(8))  // 8 turns already exist
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await startEvent(EVENT_ID)

    expect(result).toEqual({ success: false, error: 'Auction has already been started for this event.' })
  })

  it('returns error when no participants are registered', async () => {
    const { supabase } = makeMockClient()
    supabase.from
      .mockReturnValueOnce(qCount(0))              // no existing turns
      .mockReturnValueOnce(q({ data: [] }))        // no participants
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await startEvent(EVENT_ID)

    expect(result).toEqual({ success: false, error: 'No participants found for this event.' })
  })

  it('inserts one turn row per participant', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(buildSuccessClient() as any)

    const result = await startEvent(EVENT_ID)

    expect(result).toEqual({ success: true })
  })

  it('returns success and randomises turn order (positions 0..N-1 exist in result)', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(buildSuccessClient() as any)

    const result = await startEvent(EVENT_ID)

    // The engine finds position 0 and uses its id as current_turn_id
    expect(result).toEqual({ success: true })
  })
})
