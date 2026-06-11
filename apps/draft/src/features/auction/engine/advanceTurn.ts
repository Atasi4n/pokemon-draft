import { createSupabaseServerClient } from '@/lib/supabase/server'

type AdvanceTurnResult =
  | { success: true }
  | { success: false; error: string }

export async function advanceTurn(eventId: string): Promise<AdvanceTurnResult> {
  const supabase = await createSupabaseServerClient()

  // Fetch current turn position
  const { data: state, error: stateError } = await supabase
    .from('auction_state')
    .select('current_turn_id')
    .eq('event_id', eventId)
    .single()

  if (stateError || !state) return { success: false, error: 'Auction state not found.' }
  if (!state.current_turn_id) return { success: false, error: 'No active turn.' }

  const { data: currentTurn, error: turnError } = await supabase
    .from('auction_turns')
    .select('position')
    .eq('id', state.current_turn_id)
    .single()

  if (turnError || !currentTurn) return { success: false, error: 'Current turn not found.' }

  // Get the max position to determine wrap-around
  const { data: maxRow, error: maxError } = await supabase
    .from('auction_turns')
    .select('position')
    .eq('event_id', eventId)
    .order('position', { ascending: false })
    .limit(1)
    .single()

  if (maxError || !maxRow) return { success: false, error: 'Could not determine turn order.' }

  const nextPosition = currentTurn.position >= maxRow.position ? 0 : currentTurn.position + 1

  const { data: nextTurn, error: nextError } = await supabase
    .from('auction_turns')
    .select('id')
    .eq('event_id', eventId)
    .eq('position', nextPosition)
    .single()

  if (nextError || !nextTurn) return { success: false, error: 'Next turn not found.' }

  const { error: updateError } = await supabase
    .from('auction_state')
    .update({ current_turn_id: nextTurn.id })
    .eq('event_id', eventId)

  if (updateError) return { success: false, error: updateError.message }

  return { success: true }
}
