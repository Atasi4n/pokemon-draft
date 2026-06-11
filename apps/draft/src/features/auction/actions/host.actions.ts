'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { startEvent }    from '@/features/auction/engine/startEvent'
import { advanceTurn }   from '@/features/auction/engine/advanceTurn'
import { checkMegaPhase } from '@/features/auction/engine/checkMegaPhase'
import { AUCTION_CONFIG } from '@/lib/config/auction.config'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { AuctionPhase } from '@/types/auction.types'

type ActionResult =
  | { success: true }
  | { success: false; error: string }

// ---------------------------------------------------------------------------
// Shared auth guard — all host actions run this first.
// Returns the authenticated supabase client or an error result.
// ---------------------------------------------------------------------------
async function requireHost(): Promise<
  | { ok: true;  supabase: SupabaseClient<Database> }
  | { ok: false; error: string }
> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!userRow || userRow.role !== 'HOST') {
    return { ok: false, error: 'Host access required.' }
  }

  return { ok: true, supabase }
}

// ---------------------------------------------------------------------------
// startEvent — randomises turn order, transitions WAITING → MEGA.
// ---------------------------------------------------------------------------
export async function startEventAction(eventId: string): Promise<ActionResult> {
  const auth = await requireHost()
  if (!auth.ok) return { success: false, error: auth.error }

  const result = await startEvent(eventId)
  if (!result.success) return { success: false, error: result.error }

  return { success: true }
}

// ---------------------------------------------------------------------------
// skipTurn — advances current_turn_id to next position.
// Requires no active auction (cancel first if needed).
// ---------------------------------------------------------------------------
export async function skipTurnAction(eventId: string): Promise<ActionResult> {
  const auth = await requireHost()
  if (!auth.ok) return { success: false, error: auth.error }

  const { data: state } = await auth.supabase
    .from('auction_state')
    .select('status')
    .eq('event_id', eventId)
    .single()

  if (state?.status === 'BIDDING') {
    return {
      success: false,
      error:   'An auction is in progress. Cancel it before skipping the turn.',
    }
  }

  const result = await advanceTurn(eventId)
  if (!result.success) return { success: false, error: result.error }

  return { success: true }
}

// ---------------------------------------------------------------------------
// cancelAuction — cancels the active auction_pokemon and resets to IDLE.
// Turn does NOT advance — the same participant nominates again.
// ---------------------------------------------------------------------------
export async function cancelAuctionAction(eventId: string): Promise<ActionResult> {
  const auth = await requireHost()
  if (!auth.ok) return { success: false, error: auth.error }

  const { data: state, error: stateError } = await auth.supabase
    .from('auction_state')
    .select('status, current_auction_pokemon_id')
    .eq('event_id', eventId)
    .single()

  if (stateError || !state) {
    return { success: false, error: 'Auction state not found.' }
  }

  if (state.status !== 'BIDDING') {
    return { success: false, error: 'No active auction to cancel.' }
  }

  if (!state.current_auction_pokemon_id) {
    return { success: false, error: 'No active auction pokemon found.' }
  }

  // Mark the auction_pokemon as CANCELLED
  const { error: cancelError } = await auth.supabase
    .from('auction_pokemon')
    .update({ status: 'CANCELLED' })
    .eq('id', state.current_auction_pokemon_id)

  if (cancelError) {
    return { success: false, error: 'Failed to cancel auction.' }
  }

  // Reset auction_state to IDLE — same turn, no timer
  const { error: resetError } = await auth.supabase
    .from('auction_state')
    .update({
      status:                     'IDLE',
      current_auction_pokemon_id: null,
      timer_ends_at:              null,
    })
    .eq('event_id', eventId)

  if (resetError) {
    return { success: false, error: 'Failed to reset auction state.' }
  }

  return { success: true }
}

// ---------------------------------------------------------------------------
// editBudget — directly sets a participant's budget.
// Use for corrections; the host may also use assignPokemon which costs $0.
// ---------------------------------------------------------------------------
export async function editBudgetAction(
  eventId:       string,
  participantId: string,
  newAmount:     number,
): Promise<ActionResult> {
  const auth = await requireHost()
  if (!auth.ok) return { success: false, error: auth.error }

  if (!Number.isInteger(newAmount) || newAmount < 0) {
    return { success: false, error: 'Budget must be a non-negative integer.' }
  }

  const { error } = await auth.supabase
    .from('participants')
    .update({ budget: newAmount })
    .eq('event_id', eventId)
    .eq('id', participantId)

  if (error) return { success: false, error: 'Failed to update budget.' }

  return { success: true }
}

// ---------------------------------------------------------------------------
// assignPokemon — host manually assigns a pokemon to a participant.
// Creates a HOST auction_pokemon (status=SOLD, price=$0) + team_pokemon row.
// Cancels any currently active auction first, then advances the turn.
// ---------------------------------------------------------------------------
export async function assignPokemonAction(
  eventId:       string,
  speciesId:     number,
  participantId: string,
): Promise<ActionResult> {
  const auth = await requireHost()
  if (!auth.ok) return { success: false, error: auth.error }

  // Banned species check
  if ((AUCTION_CONFIG.BANNED_SPECIES_IDS as readonly number[]).includes(speciesId)) {
    return { success: false, error: 'This Pokemon is banned from the auction.' }
  }

  // Fetch snapshot data from pokemon_meta
  const { data: pokemon, error: pokemonError } = await auth.supabase
    .from('pokemon_meta')
    .select('name, sprite_front, is_mega_capable')
    .eq('species_id', speciesId)
    .single()

  if (pokemonError || !pokemon) {
    return { success: false, error: 'Pokemon not found in the Champions format.' }
  }

  // Ensure not already on this participant's team
  const { count: teamCount } = await auth.supabase
    .from('team_pokemon')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('participant_id', participantId)
    .eq('species_id', speciesId)

  if (teamCount && teamCount > 0) {
    return { success: false, error: 'This Pokemon is already on this participant\'s team.' }
  }

  // Ensure participant's team has room
  const { count: currentTeamSize } = await auth.supabase
    .from('team_pokemon')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('participant_id', participantId)

  if ((currentTeamSize ?? 0) >= AUCTION_CONFIG.TEAM_SIZE) {
    return { success: false, error: 'This participant\'s team is already full.' }
  }

  // If there is an active auction running, cancel it first
  const { data: state } = await auth.supabase
    .from('auction_state')
    .select('status, current_auction_pokemon_id')
    .eq('event_id', eventId)
    .single()

  if (state?.status === 'BIDDING' && state.current_auction_pokemon_id) {
    const { error: cancelError } = await auth.supabase
      .from('auction_pokemon')
      .update({ status: 'CANCELLED' })
      .eq('id', state.current_auction_pokemon_id)

    if (cancelError) {
      return { success: false, error: 'Failed to cancel the active auction before assigning.' }
    }
  }

  // Create an auction_pokemon record for this host assignment (SOLD immediately)
  const { data: auctionPokemon, error: apError } = await auth.supabase
    .from('auction_pokemon')
    .insert({
      event_id:                    eventId,
      species_id:                  speciesId,
      name_snapshot:               pokemon.name,
      sprite_snapshot:             pokemon.sprite_front,
      is_mega_capable:             pokemon.is_mega_capable,
      nominated_by:                'HOST',
      nominated_by_participant_id: null,
      status:                      'SOLD',
      sold_to:                     participantId,
      sold_price:                  0,
    })
    .select('id')
    .single()

  if (apError || !auctionPokemon) {
    return { success: false, error: 'Failed to create auction record.' }
  }

  // Assign the pokemon to the participant's team at $0 (host override)
  const { error: teamError } = await auth.supabase
    .from('team_pokemon')
    .insert({
      event_id:           eventId,
      participant_id:     participantId,
      species_id:         speciesId,
      name_snapshot:      pokemon.name,
      sprite_snapshot:    pokemon.sprite_front,
      is_mega_capable:    pokemon.is_mega_capable,
      purchase_price:     0,
      auction_pokemon_id: auctionPokemon.id,
    })

  if (teamError) {
    return { success: false, error: 'Failed to assign pokemon to team.' }
  }

  // Fulfil mega requirement if applicable
  if (pokemon.is_mega_capable) {
    await auth.supabase
      .from('participants')
      .update({ has_mega: true })
      .eq('id', participantId)
  }

  // Reset auction_state, then advance to the next turn
  await auth.supabase
    .from('auction_state')
    .update({
      status:                     'IDLE',
      current_auction_pokemon_id: null,
      timer_ends_at:              null,
    })
    .eq('event_id', eventId)

  const turnResult = await advanceTurn(eventId)
  if (!turnResult.success) {
    return { success: false, error: turnResult.error }
  }

  // Check if mega phase is now complete
  await checkMegaPhase(eventId)

  return { success: true }
}

// ---------------------------------------------------------------------------
// advancePhase — manually move the auction to the next phase.
// Valid transitions: WAITING→MEGA, MEGA→MAIN, MAIN→SPECIAL, SPECIAL→ENDED.
// Requires no active auction (cancel first if needed).
// ---------------------------------------------------------------------------
const NEXT_PHASE: Partial<Record<AuctionPhase, AuctionPhase>> = {
  WAITING: 'MEGA',
  MEGA:    'MAIN',
  MAIN:    'SPECIAL',
  SPECIAL: 'ENDED',
}

export async function advancePhaseAction(eventId: string): Promise<ActionResult> {
  const auth = await requireHost()
  if (!auth.ok) return { success: false, error: auth.error }

  const { data: state, error: stateError } = await auth.supabase
    .from('auction_state')
    .select('phase, status')
    .eq('event_id', eventId)
    .single()

  if (stateError || !state) {
    return { success: false, error: 'Auction state not found.' }
  }

  if (state.status === 'BIDDING') {
    return {
      success: false,
      error:   'An auction is in progress. Cancel it before advancing the phase.',
    }
  }

  const nextPhase = NEXT_PHASE[state.phase as AuctionPhase]
  if (!nextPhase) {
    return { success: false, error: `Cannot advance from phase: ${state.phase}.` }
  }

  const { error: updateError } = await auth.supabase
    .from('auction_state')
    .update({
      phase:  nextPhase,
      status: 'IDLE',
    })
    .eq('event_id', eventId)

  if (updateError) {
    return { success: false, error: 'Failed to advance phase.' }
  }

  return { success: true }
}
