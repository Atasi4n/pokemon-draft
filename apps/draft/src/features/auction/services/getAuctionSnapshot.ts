import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { AuctionSnapshot, AuctionPokemonRow, BidRow, ParticipantWithTeam } from '@/types/auction.types'

export async function getAuctionSnapshot(
  eventId: string,
): Promise<AuctionSnapshot | null> {
  const supabase = await createSupabaseServerClient()

  // Fetch all base data in one round-trip.
  const [
    eventResult,
    stateResult,
    participantsResult,
    teamResult,
    coachesResult,
    coachAssignmentsResult,
    turnsResult,
  ] = await Promise.all([
    supabase.from('events').select('*').eq('id', eventId).single(),
    supabase.from('auction_state').select('*').eq('event_id', eventId).single(),
    supabase.from('participants').select('*').eq('event_id', eventId),
    supabase.from('team_pokemon').select('*').eq('event_id', eventId),
    supabase.from('coaches').select('*').eq('event_id', eventId),
    supabase.from('coach_participants').select('*').eq('event_id', eventId),
    supabase.from('auction_turns').select('*').eq('event_id', eventId).order('position', { ascending: true }),
  ])

  if (eventResult.error || !eventResult.data)  return null
  if (stateResult.error  || !stateResult.data)  return null

  const participants    = participantsResult.data    ?? []
  const teamPokemon     = teamResult.data            ?? []
  const coaches         = coachesResult.data         ?? []
  const coachAssignments = coachAssignmentsResult.data ?? []
  const turns           = turnsResult.data           ?? []

  const participantsWithTeam: ParticipantWithTeam[] = participants.map((p) => {
    const team       = teamPokemon.filter((t) => t.participant_id === p.id)
    const assignment = coachAssignments.find((ca) => ca.participant_id === p.id)
    const coach      = assignment
      ? (coaches.find((c) => c.id === assignment.coach_id) ?? null)
      : null
    return { ...p, team, coach }
  })

  // Second round-trip only if there is an active auction.
  let currentPokemon: AuctionPokemonRow | null = null
  let currentBids:    BidRow[]                 = []

  const currentPokemonId = stateResult.data.current_auction_pokemon_id

  if (currentPokemonId) {
    const [pokemonResult, bidsResult] = await Promise.all([
      supabase
        .from('auction_pokemon')
        .select('*')
        .eq('id', currentPokemonId)
        .single(),
      supabase
        .from('bids')
        .select('*')
        .eq('auction_pokemon_id', currentPokemonId)
        .order('placed_at', { ascending: true }),
    ])
    currentPokemon = pokemonResult.data ?? null
    currentBids    = bidsResult.data    ?? []
  }

  return {
    event:          eventResult.data,
    state:          stateResult.data,
    participants:   participantsWithTeam,
    currentPokemon,
    currentBids,
    turns,
  }
}
