'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { validateNomination } from '@/features/auction/engine/validateNomination'
import { AUCTION_CONFIG } from '@/lib/config/auction.config'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { NominationType } from '@/types/auction.types'

type NominateActionInput = {
  eventId:  string
  speciesId: number
}

type NominateActionResult =
  | { success: true }
  | { success: false; error: string }

// Shared write sequence
async function openAuction(
  supabase:                    SupabaseClient<Database>,
  eventId:                     string,
  speciesId:                   number,
  nominatedBy:                 NominationType,
  nominatedByParticipantId:    string | null,
): Promise<NominateActionResult> {
  // Fetch snapshot data from pokemon_meta
  const { data: pokemon, error: pokemonError } = await supabase
    .from('pokemon_meta')
    .select('name, sprite_front, is_mega_capable')
    .eq('species_id', speciesId)
    .single()

  if (pokemonError || !pokemon) {
    return { success: false, error: 'Pokemon not found.' }
  }

  // Insert the auction_pokemon row
  const { data: auctionPokemon, error: insertError } = await supabase
    .from('auction_pokemon')
    .insert({
      event_id:                    eventId,
      species_id:                  speciesId,
      name_snapshot:               pokemon.name,
      sprite_snapshot:             pokemon.sprite_front,
      is_mega_capable:             pokemon.is_mega_capable,
      nominated_by:                nominatedBy,
      nominated_by_participant_id: nominatedByParticipantId,
      status:                      'ACTIVE',
    })
    .select('id')
    .single()

  if (insertError || !auctionPokemon) {
    return { success: false, error: 'Failed to create auction.' }
  }

  // Open bidding, timer begins
  const timerEndsAt = new Date(
    Date.now() + AUCTION_CONFIG.TIMER_SECONDS * 1000
  ).toISOString()

  const { error: stateError } = await supabase
    .from('auction_state')
    .update({
      status:                     'BIDDING',
      current_auction_pokemon_id: auctionPokemon.id,
      timer_ends_at:              timerEndsAt,
    })
    .eq('event_id', eventId)

  if (stateError) {
    return { success: false, error: 'Failed to open bidding.' }
  }

  return { success: true }
}

export async function nominateAction({
  eventId,
  speciesId,
}: NominateActionInput): Promise<NominateActionResult> {
  const supabase = await createSupabaseServerClient()

  // Authenticate
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated.' }

  // Verify role — participants and coaches only
  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!userRow || (userRow.role !== 'PARTICIPANT' && userRow.role !== 'COACH')) {
    return { success: false, error: 'Only participants and coaches can nominate.' }
  }

  // PARTICIPANT path
  if (userRow.role === 'PARTICIPANT') {
    const { data: participant } = await supabase
      .from('participants')
      .select('id')
      .eq('event_id', eventId)
      .eq('user_id', user.id)
      .single()

    if (!participant) {
      return { success: false, error: 'Participant not found for this event.' }
    }

    const validation = await validateNomination({
      eventId,
      speciesId,
      nominatedBy:              'PARTICIPANT',
      nominatedByParticipantId: participant.id,
    })

    if (!validation.valid) return { success: false, error: validation.reason }

    return openAuction(supabase, eventId, speciesId, 'PARTICIPANT', participant.id)
  }

  // COACH path 
  const { data: coach } = await supabase
    .from('coaches')
    .select('id')
    .eq('event_id', eventId)
    .eq('user_id', user.id)
    .single()

  if (!coach) {
    return { success: false, error: 'Coach not found for this event.' }
  }

  // Resolve which participant's turn it is
  const { data: state } = await supabase
    .from('auction_state')
    .select('current_turn_id')
    .eq('event_id', eventId)
    .single()

  if (!state?.current_turn_id) {
    return { success: false, error: 'No active turn.' }
  }

  const { data: currentTurn } = await supabase
    .from('auction_turns')
    .select('participant_id')
    .eq('id', state.current_turn_id)
    .single()

  if (!currentTurn) {
    return { success: false, error: 'Current turn not found.' }
  }

  // Fetch the assignment now
  const { data: assignment } = await supabase
    .from('coach_participants')
    .select('overrides_remaining')
    .eq('event_id', eventId)
    .eq('coach_id', coach.id)
    .eq('participant_id', currentTurn.participant_id)
    .single()

  // validateNomination will also check this, but we need the value for decrement
  if (!assignment) {
    return { success: false, error: 'Coach is not assigned to the current participant.' }
  }

  const validation = await validateNomination({
    eventId,
    speciesId,
    nominatedBy:              'COACH_OVERRIDE',
    nominatedByParticipantId: currentTurn.participant_id,
    coachId:                  coach.id,
  })

  if (!validation.valid) return { success: false, error: validation.reason }

  // Decrement override counter before opening the auction
  const { error: overrideError } = await supabase
    .from('coach_participants')
    .update({ overrides_remaining: assignment.overrides_remaining - 1 })
    .eq('event_id', eventId)
    .eq('coach_id', coach.id)
    .eq('participant_id', currentTurn.participant_id)

  if (overrideError) {
    return { success: false, error: 'Failed to record coach override.' }
  }

  return openAuction(
    supabase,
    eventId,
    speciesId,
    'COACH_OVERRIDE',
    currentTurn.participant_id,
  )
}
