import { createSupabaseServerClient } from '@/lib/supabase/server'
import { AUCTION_CONFIG } from '@/lib/config/auction.config'

// Discriminated union — TypeScript enforces the right fields per nomination type
type ValidateNominationInput =
  | { eventId: string; speciesId: number; nominatedBy: 'PARTICIPANT';     nominatedByParticipantId: string }
  | { eventId: string; speciesId: number; nominatedBy: 'COACH_OVERRIDE';  nominatedByParticipantId: string; coachId: string }
  | { eventId: string; speciesId: number; nominatedBy: 'HOST' }

type ValidateNominationResult =
  | { valid: true }
  | { valid: false; reason: string }

export async function validateNomination(input: ValidateNominationInput): Promise<ValidateNominationResult> {
  const { eventId, speciesId, nominatedBy } = input
  const supabase = await createSupabaseServerClient()

  // Species is not banned
  if ((AUCTION_CONFIG.BANNED_SPECIES_IDS as readonly number[]).includes(speciesId)) {
    return { valid: false, reason: 'This Pokemon is banned from the auction.' }
  }

  // Fetch auction_state and pokemon_meta
  const [stateResult, pokemonResult] = await Promise.all([
    supabase
      .from('auction_state')
      .select('phase, current_turn_id')
      .eq('event_id', eventId)
      .single(),
    supabase
      .from('pokemon_meta')
      .select('is_mega_capable')
      .eq('species_id', speciesId)
      .single(),
  ])

  // Species exists in pokemon_meta
  if (pokemonResult.error || !pokemonResult.data) {
    return { valid: false, reason: 'Pokemon not found in the Champions format.' }
  }

  if (stateResult.error || !stateResult.data) {
    return { valid: false, reason: 'Auction state not found.' }
  }

  const state   = stateResult.data
  const pokemon = pokemonResult.data

  // Rule 3: mega phase requires a mega-capable pokemon
  if (state.phase === 'MEGA' && !pokemon.is_mega_capable) {
    return { valid: false, reason: 'Only Mega-capable Pokemon can be nominated during the Mega round.' }
  }

  // Fetch team ownership and active auction status in parallel
  const [teamResult, activeResult] = await Promise.all([
    supabase
      .from('team_pokemon')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('species_id', speciesId),
    supabase
      .from('auction_pokemon')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('species_id', speciesId)
      .eq('status', 'ACTIVE'),
  ])

  // Not already on any participant's team
  if (teamResult.count && teamResult.count > 0) {
    return { valid: false, reason: 'This Pokemon is already on a team.' }
  }

  // Nnot currently active in an ongoing auction
  if (activeResult.count && activeResult.count > 0) {
    return { valid: false, reason: 'This Pokemon is already being auctioned.' }
  }

  // If PARTICIPANT, it must be their turn
  if (nominatedBy === 'PARTICIPANT') {
    if (!state.current_turn_id) {
      return { valid: false, reason: 'No active turn found.' }
    }

    const { data: currentTurn, error: turnError } = await supabase
      .from('auction_turns')
      .select('participant_id')
      .eq('id', state.current_turn_id)
      .single()

    if (turnError || !currentTurn) {
      return { valid: false, reason: 'Could not verify current turn.' }
    }

    if (currentTurn.participant_id !== input.nominatedByParticipantId) {
      return { valid: false, reason: 'It is not your turn to nominate.' }
    }
  }

  // if COACH_OVERRIDE, coach must be assigned to the participant and have overrides left
  if (nominatedBy === 'COACH_OVERRIDE') {
    const { data: assignment, error: assignmentError } = await supabase
      .from('coach_participants')
      .select('overrides_remaining')
      .eq('event_id', eventId)
      .eq('coach_id', input.coachId)
      .eq('participant_id', input.nominatedByParticipantId)
      .single()

    if (assignmentError || !assignment) {
      return { valid: false, reason: 'Coach is not assigned to this participant.' }
    }

    if (assignment.overrides_remaining <= 0) {
      return { valid: false, reason: 'No nomination overrides remaining.' }
    }
  }

  return { valid: true }
}
