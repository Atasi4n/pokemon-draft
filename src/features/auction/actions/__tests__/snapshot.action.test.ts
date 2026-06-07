import { describe, it, expect, vi } from 'vitest'
import { getSnapshotAction } from '../snapshot.action'
import { makeMockClient, EVENT_ID } from '@/test/helpers'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/features/auction/services/getAuctionSnapshot', () => ({
  getAuctionSnapshot: vi.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAuctionSnapshot } from '@/features/auction/services/getAuctionSnapshot'

const MOCK_SNAPSHOT = { event: { id: EVENT_ID }, state: {}, participants: [], currentPokemon: null, currentBids: [], turns: [] }

describe('getSnapshotAction', () => {
  it('returns error when user is not authenticated', async () => {
    const { supabase } = makeMockClient({ user: null })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

    const result = await getSnapshotAction(EVENT_ID)

    expect(result).toEqual({ success: false, error: 'Not authenticated.' })
  })

  it('returns error when getAuctionSnapshot returns null', async () => {
    const { supabase } = makeMockClient()
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)
    vi.mocked(getAuctionSnapshot).mockResolvedValue(null)

    const result = await getSnapshotAction(EVENT_ID)

    expect(result).toEqual({ success: false, error: 'Failed to load auction data.' })
  })

  it('returns the snapshot when authenticated and data loads successfully', async () => {
    const { supabase } = makeMockClient()
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)
    vi.mocked(getAuctionSnapshot).mockResolvedValue(MOCK_SNAPSHOT as any)

    const result = await getSnapshotAction(EVENT_ID)

    expect(result).toEqual({ success: true, data: MOCK_SNAPSHOT })
  })

  it('passes the eventId through to getAuctionSnapshot', async () => {
    const { supabase } = makeMockClient()
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)
    vi.mocked(getAuctionSnapshot).mockResolvedValue(MOCK_SNAPSHOT as any)

    await getSnapshotAction(EVENT_ID)

    expect(getAuctionSnapshot).toHaveBeenCalledWith(EVENT_ID)
  })
})
