// @ts-nocheck — Deno runtime; not checked by the Next.js TypeScript project.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

type RpcResponse = {
  success:       boolean
  error?:        string | null
  winner_id?:    string | null
  pokemon_name?: string | null
}

type ResolutionRecord = {
  event_id:             string
  resolved:             boolean
  winner_id:            string | null
  pokemon_name:         string | null
  transitioned_to_main: boolean
  error?:               string
}

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: expired, error: queryError } = await supabase
    .from('auction_state')
    .select('event_id')
    .eq('status', 'BIDDING')
    .lte('timer_ends_at', new Date().toISOString())

  if (queryError) {
    console.error('[resolve-expired-auctions] query failed:', queryError.message)
    return json({ ok: false, error: queryError.message }, 500)
  }

  if (!expired || expired.length === 0) {
    return json({ ok: true, resolved: 0 })
  }

  const results: ResolutionRecord[] = []

  for (const { event_id } of expired) {
    const record = await resolveOne(event_id, supabase)
    results.push(record)

    if (record.resolved) {
      console.log(
        `[resolve-expired-auctions] resolved event=${event_id}` +
        ` pokemon="${record.pokemon_name}" winner=${record.winner_id ?? 'none'}` +
        (record.transitioned_to_main ? ' → MAIN phase' : ''),
      )
    } else {
      console.log(`[resolve-expired-auctions] skipped event=${event_id}: ${record.error ?? 'already resolved'}`)
    }
  }

  const resolvedCount = results.filter((r) => r.resolved).length
  return json({ ok: true, resolved: resolvedCount, total: expired.length, results })
})

async function resolveOne(eventId: string, supabase: SupabaseClient): Promise<ResolutionRecord> {
  const base: ResolutionRecord = {
    event_id:             eventId,
    resolved:             false,
    winner_id:            null,
    pokemon_name:         null,
    transitioned_to_main: false,
  }

  const { data, error: rpcError } = await supabase.rpc('resolve_auction', {
    p_event_id: eventId,
  })

  if (rpcError) return { ...base, error: rpcError.message }

  const result = data as RpcResponse

  // success:false means another call already resolved this (race between SELECT and RPC)
  if (!result.success) return { ...base, error: result.error ?? 'nothing to resolve' }

  const winner_id    = result.winner_id    ?? null
  const pokemon_name = result.pokemon_name ?? null

  const transitioned_to_main = winner_id
    ? await maybeTransitionToMain(eventId, supabase)
    : false

  return { ...base, resolved: true, winner_id, pokemon_name, transitioned_to_main }
}

// Mirrors checkMegaPhase.ts
async function maybeTransitionToMain(
  eventId:  string,
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data: state } = await supabase
    .from('auction_state')
    .select('phase')
    .eq('event_id', eventId)
    .single()

  if (!state || state.phase !== 'MEGA') return false

  const { count: totalCount } = await supabase
    .from('participants')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)

  const { count: megaCount } = await supabase
    .from('participants')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('has_mega', true)

  if (totalCount === null || megaCount === null || megaCount < totalCount) return false

  const { error } = await supabase
    .from('auction_state')
    .update({ phase: 'MAIN' })
    .eq('event_id', eventId)

  return !error
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
