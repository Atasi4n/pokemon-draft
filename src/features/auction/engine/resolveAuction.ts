import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkMegaPhase } from './checkMegaPhase'

type ResolveAuctionResult =
  | { success: true; winnerId: string | null; pokemonName: string | null }
  | { success: false; error: string }

type ResolveAuctionRpcResponse = {
  success:      boolean
  error?:       string
  winner_id?:   string | null
  pokemon_name?: string | null
}

export async function resolveAuction(eventId: string): Promise<ResolveAuctionResult> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('resolve_auction', {
    p_event_id: eventId,
  })

  if (error) return { success: false, error: error.message }

  const result = data as ResolveAuctionRpcResponse

  if (!result.success) {
    return { success: false, error: result.error ?? 'Failed to resolve auction.' }
  }

  // If a winner was assigned, check whether the mega phase is now complete
  if (result.winner_id) {
    await checkMegaPhase(eventId)
  }

  return {
    success:     true,
    winnerId:    result.winner_id ?? null,
    pokemonName: result.pokemon_name ?? null,
  }
}
