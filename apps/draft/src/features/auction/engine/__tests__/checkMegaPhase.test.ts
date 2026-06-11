import { describe, it, expect, vi } from 'vitest'
import { checkMegaPhase } from '../checkMegaPhase'
import { makeMockClient, q, qCount, EVENT_ID } from '@/test/helpers'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase/server'

describe('checkMegaPhase', () => {
  it('returns transitioned: false without touching DB when phase is not MEGA', async () => {
    const { supabase } = makeMockClient()
    supabase.from.mockReturnValueOnce(q({ data: { phase: 'MAIN' } }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await checkMegaPhase(EVENT_ID)

    expect(result).toEqual({ success: true, transitioned: false })
    expect(supabase.from).toHaveBeenCalledTimes(1)  // only the state check
  })

  it('returns transitioned: false when some participants still lack a mega', async () => {
    const { supabase } = makeMockClient()
    supabase.from
      .mockReturnValueOnce(q({ data: { phase: 'MEGA' } }))
      .mockReturnValueOnce(qCount(8))   // 8 total participants
      .mockReturnValueOnce(qCount(5))   // 5 have a mega — not all
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await checkMegaPhase(EVENT_ID)

    expect(result).toEqual({ success: true, transitioned: false })
  })

  it('transitions to MAIN when all participants have a mega', async () => {
    const { supabase } = makeMockClient()
    const updateChain = q({ data: null })  // update returns no error
    supabase.from
      .mockReturnValueOnce(q({ data: { phase: 'MEGA' } }))
      .mockReturnValueOnce(qCount(8))    // 8 total
      .mockReturnValueOnce(qCount(8))    // 8 have mega → all done
      .mockReturnValueOnce(updateChain)  // auction_state update
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await checkMegaPhase(EVENT_ID)

    expect(result).toEqual({ success: true, transitioned: true })
  })

  it('returns error when the DB update fails', async () => {
    const { supabase } = makeMockClient()
    const updateChain = q({ error: { message: 'DB error' } })
    supabase.from
      .mockReturnValueOnce(q({ data: { phase: 'MEGA' } }))
      .mockReturnValueOnce(qCount(8))
      .mockReturnValueOnce(qCount(8))
      .mockReturnValueOnce(updateChain)
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await checkMegaPhase(EVENT_ID)

    expect(result).toEqual({ success: false, error: 'DB error' })
  })
})
