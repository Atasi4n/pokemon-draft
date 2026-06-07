'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAuctionSnapshot } from '@/features/auction/services/getAuctionSnapshot'
import type { AuctionSnapshot } from '@/types/auction.types'

type SnapshotResult =
  | { success: true;  data: AuctionSnapshot }
  | { success: false; error: string }

// Called by useAuctionRealtime on mount (and on reconnect) to hydrate the store.
// No role check — RLS on each table controls what the caller can read.
export async function getSnapshotAction(eventId: string): Promise<SnapshotResult> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated.' }

  const snapshot = await getAuctionSnapshot(eventId)
  if (!snapshot) return { success: false, error: 'Failed to load auction data.' }

  return { success: true, data: snapshot }
}
