import { createSupabaseServerClient } from '@/lib/supabase/server'
import { AUCTION_CONFIG } from '@/lib/config/auction.config'

type ValidateBidInput = {
  eventId:       string
  participantId: string
  amount:        number
}

type ValidateBidResult =
  | { valid: true }
  | { valid: false; reason: string }

export async function validateBid({ eventId, participantId, amount }: ValidateBidInput): Promise<ValidateBidResult> {
  const supabase = await createSupabaseServerClient()

  // Auction must be in BIDDING status
  const { data: state, error: stateError } = await supabase
    .from('auction_state')
    .select('status, current_auction_pokemon_id')
    .eq('event_id', eventId)
    .single()

  if (stateError || !state) return { valid: false, reason: 'Auction state not found.' }
  if (state.status !== 'BIDDING') return { valid: false, reason: 'Bidding is not currently open.' }

  if (!state.current_auction_pokemon_id) {
    return { valid: false, reason: 'No active auction pokemon.' }
  }

  if (amount < AUCTION_CONFIG.MIN_BID) {
    return { valid: false, reason: `Minimum bid is $${AUCTION_CONFIG.MIN_BID}.` }
  }

  if (amount > AUCTION_CONFIG.MAX_BID) {
    return { valid: false, reason: `Maximum bid is $${AUCTION_CONFIG.MAX_BID}.` }
  }

  const { data: highestBidRow } = await supabase
    .from('bids')
    .select('amount')
    .eq('auction_pokemon_id', state.current_auction_pokemon_id)
    .order('amount', { ascending: false })
    .limit(1)
    .maybeSingle()

  const highestBid  = highestBidRow?.amount ?? 0
  const minRequired = highestBid > 0
    ? highestBid + AUCTION_CONFIG.MIN_INCREMENT
    : AUCTION_CONFIG.MIN_BID

  if (amount < minRequired) {
    return { valid: false, reason: `Minimum bid is $${minRequired} (current highest: $${highestBid}).` }
  }

  // anti-spam — participant's last bid must be > BID_COOLDOWN_SECS ago
  const { data: lastBid } = await supabase
    .from('bids')
    .select('placed_at')
    .eq('event_id', eventId)
    .eq('participant_id', participantId)
    .order('placed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastBid) {
    const secondsElapsed = (Date.now() - new Date(lastBid.placed_at).getTime()) / 1000
    if (secondsElapsed < AUCTION_CONFIG.BID_COOLDOWN_SECS) {
      const remaining = (AUCTION_CONFIG.BID_COOLDOWN_SECS - secondsElapsed).toFixed(1)
      return { valid: false, reason: `Please wait ${remaining}s before bidding again.` }
    }
  }

  // Budget protection
  const [participantResult, teamCountResult] = await Promise.all([
    supabase
      .from('participants')
      .select('budget')
      .eq('id', participantId)
      .single(),
    supabase
      .from('team_pokemon')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('participant_id', participantId),
  ])

  if (participantResult.error || !participantResult.data) {
    return { valid: false, reason: 'Participant not found.' }
  }

  const { budget }     = participantResult.data
  const teamSize       = teamCountResult.count ?? 0
  const slotsRemaining = AUCTION_CONFIG.TEAM_SIZE - teamSize
  const minReserve     = slotsRemaining * AUCTION_CONFIG.MIN_BID

  if (budget - amount < minReserve) {
    const slotLabel = slotsRemaining === 1 ? 'slot' : 'slots'
    return {
      valid:  false,
      reason: `Insufficient budget. You must keep $${minReserve} in reserve for your ${slotsRemaining} remaining team ${slotLabel}.`,
    }
  }

  return { valid: true }
}
