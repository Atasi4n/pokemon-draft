import { createSupabaseServerClient } from '@/lib/supabase/server'
import { validateBid } from './validateBid'

type PlaceBidInput = {
  eventId:          string
  participantId:    string
  auctionPokemonId: string
  amount:           number
}

type PlaceBidResult =
  | { success: true;  newTimerEndsAt: string }
  | { success: false; error: string }

// Shape of the jsonb returned by the place_bid RPC
type PlaceBidRpcResponse = {
  success:           boolean
  error?:            string
  new_timer_ends_at?: string
}

export async function placeBid({
  eventId,
  participantId,
  auctionPokemonId,
  amount,
}: PlaceBidInput): Promise<PlaceBidResult> {
  // Pre-flight validation — no DB write if invalid
  const validation = await validateBid({ eventId, participantId, amount })
  if (!validation.valid) {
    return { success: false, error: validation.reason }
  }

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('place_bid', {
    p_event_id:            eventId,
    p_participant_id:      participantId,
    p_auction_pokemon_id:  auctionPokemonId,
    p_amount:              amount,
  })

  if (error) return { success: false, error: error.message }

  const result = data as PlaceBidRpcResponse

  if (!result.success) {
    return { success: false, error: result.error ?? 'Failed to place bid.' }
  }

  if (!result.new_timer_ends_at) {
    return { success: false, error: 'RPC did not return a timer value.' }
  }

  return { success: true, newTimerEndsAt: result.new_timer_ends_at }
}
