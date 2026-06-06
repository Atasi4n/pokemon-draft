import { createSupabaseServerClient } from '@/lib/supabase/server'

type CheckMegaPhaseResult =
  | { success: true; transitioned: boolean }
  | { success: false; error: string }

export async function checkMegaPhase(eventId: string): Promise<CheckMegaPhaseResult> {
  const supabase = await createSupabaseServerClient()

  // Only act if the current phase is MEGA
  const { data: state, error: stateError } = await supabase
    .from('auction_state')
    .select('phase')
    .eq('event_id', eventId)
    .single()

  if (stateError || !state) return { success: false, error: 'Auction state not found.' }
  if (state.phase !== 'MEGA') return { success: true, transitioned: false }

  // Check if all participants in this event have fulfilled the mega requirement
  const { count: totalCount, error: totalError } = await supabase
    .from('participants')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)

  if (totalError) return { success: false, error: totalError.message }

  const { count: megaCount, error: megaError } = await supabase
    .from('participants')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('has_mega', true)

  if (megaError) return { success: false, error: megaError.message }

  if (totalCount === null || megaCount === null) {
    return { success: false, error: 'Could not count participants.' }
  }

  if (megaCount < totalCount) return { success: true, transitioned: false }

  // When all participants have a mega, advance to MAIN phase
  const { error: updateError } = await supabase
    .from('auction_state')
    .update({ phase: 'MAIN' })
    .eq('event_id', eventId)

  if (updateError) return { success: false, error: updateError.message }

  return { success: true, transitioned: true }
}
