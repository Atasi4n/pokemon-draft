import { createSupabaseServerClient } from '@/lib/supabase/server'

type StartEventResult =
  | { success: true }
  | { success: false; error: string }

function fisherYates<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export async function startEvent(eventId: string): Promise<StartEventResult> {
  const supabase = await createSupabaseServerClient()

  const { count, error: countError } = await supabase
    .from('auction_turns')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)

  if (countError) return { success: false, error: countError.message }
  if (count && count > 0) return { success: false, error: 'Auction has already been started for this event.' }

  // Fetch participants
  const { data: participants, error: participantsError } = await supabase
    .from('participants')
    .select('id')
    .eq('event_id', eventId)

  if (participantsError) return { success: false, error: participantsError.message }
  if (!participants || participants.length === 0) return { success: false, error: 'No participants found for this event.' }

  // Shuffle and build turn rows
  const shuffledIds = fisherYates(participants.map((p: { id: string }) => p.id))
  const turnRows = shuffledIds.map((participantId, position) => ({
    event_id:       eventId,
    participant_id: participantId,
    position,
  }))

  // Insert all turns, get back ids and positions
  const { data: insertedTurns, error: turnsError } = await supabase
    .from('auction_turns')
    .insert(turnRows)
    .select('id, position')

  if (turnsError) return { success: false, error: turnsError.message }
  if (!insertedTurns) return { success: false, error: 'Failed to insert auction turns.' }

  const firstTurn = insertedTurns.find((t: { id: string; position: number }) => t.position === 0)
  if (!firstTurn) return { success: false, error: 'Failed to locate the first turn after insert.' }

  // Transition auction_state to MEGA phase
  const { error: stateError } = await supabase
    .from('auction_state')
    .update({
      phase:           'MEGA',
      status:          'IDLE',
      current_turn_id: firstTurn.id,
    })
    .eq('event_id', eventId)

  if (stateError) return { success: false, error: stateError.message }

  return { success: true }
}
