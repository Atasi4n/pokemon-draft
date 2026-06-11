'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { placeBid } from '@/features/auction/engine/placeBid'

type BidActionInput = {
  eventId:          string
  auctionPokemonId: string
  amount:           number
}

type BidActionResult =
  | { success: true }
  | { success: false; error: string }

export async function bidAction({
  eventId,
  auctionPokemonId,
  amount,
}: BidActionInput): Promise<BidActionResult> {
  const supabase = await createSupabaseServerClient()

  // Authenticate
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated.' }

  // Verify role
  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!userRow || userRow.role !== 'PARTICIPANT') {
    return { success: false, error: 'Only participants can place bids.' }
  }

  // Resolve participant identity for this event
  const { data: participant } = await supabase
    .from('participants')
    .select('id')
    .eq('event_id', eventId)
    .eq('user_id', user.id)
    .single()

  if (!participant) {
    return { success: false, error: 'Participant not found for this event.' }
  }

  // Delegate to engine
  const result = await placeBid({
    eventId,
    participantId:    participant.id,
    auctionPokemonId,
    amount,
  })

  if (!result.success) {
    return { success: false, error: result.error }
  }

  return { success: true }
}
