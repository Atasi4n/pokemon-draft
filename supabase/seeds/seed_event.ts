/**
 * seed_event.ts
 *
 * Creates one event (and all associated records) from event.config.ts.
 * Run once per event, before the event day.
 *
 * Creates:
 *   - auth users (via Supabase Admin Auth API)
 *   - users rows (role)
 *   - events row (status = DRAFT)
 *   - auction_state row (phase = WAITING)
 *   - participants rows
 *   - coaches rows
 *   - coach_participants rows (links each coach to their participant)
 *   - special_auction_items rows (one PENDING item per coach)
 *
 * Does NOT create:
 *   - auction_turns (written at event start, when host randomizes order)
 *   - auction_pokemon / bids / team_pokemon (created during the auction)
 *
 * Usage:
 *   npx ts-node --project tsconfig.seed.json supabase/seeds/seed_event.ts
 *
 * To target a specific event slug (if EVENTS_CONFIG has multiple):
 *   EVENT_SLUG=paralimpico-2025 npx ts-node ... supabase/seeds/seed_event.ts
 *
 * Safe to re-run for the same event — existing records are detected and skipped.
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { EVENTS_CONFIG } from '../../apps/draft/src/lib/config/event.config'
import { AUCTION_CONFIG } from '../../apps/draft/src/lib/config/auction.config'

// ── Admin client ──────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createAuthUser(
  username: string,
  password: string
): Promise<string> {
  // Use email format: username@paralimpico.local (Supabase Auth requires email)
  const email = `${username}@paralimpico.local`

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip email verification
  })

  if (error) {
    // If user already exists, fetch their ID
    if (error.message.includes('already been registered')) {
      const { data: listData } = await supabase.auth.admin.listUsers()
      const existing = listData?.users.find(u => u.email === email)
      if (existing) {
        console.log(`    → auth user already exists: ${username}`)
        return existing.id
      }
    }
    throw new Error(`Failed to create auth user ${username}: ${error.message}`)
  }

  return data.user.id
}

function bail(message: string): never {
  console.error(`\n❌ ${message}`)
  process.exit(1)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Allow targeting a specific event via env var, otherwise use the first one
  const targetSlug = process.env.EVENT_SLUG ?? EVENTS_CONFIG[0].slug
  const eventConfig = EVENTS_CONFIG.find(e => e.slug === targetSlug)

  if (!eventConfig) bail(`No event found with slug "${targetSlug}" in event.config.ts`)

  console.log(`🌱 Seeding event: ${eventConfig.display_name} (${eventConfig.slug})\n`)

  const { roster } = eventConfig

  // ── 1. Host user ──────────────────────────────────────────────────────────
  console.log('1. Creating host user...')

  const hostAuthId = await createAuthUser(roster.host.username, roster.host.password)

  const { error: hostUserError } = await supabase
    .from('users')
    .upsert(
      { id: hostAuthId, username: roster.host.username, role: 'HOST' },
      { onConflict: 'id' }
    )
  if (hostUserError) bail(`users insert (host): ${hostUserError.message}`)

  console.log(`   ✓ Host: ${roster.host.username}`)

  // ── 2. Event row ──────────────────────────────────────────────────────────
  console.log('\n2. Creating event row...')

  // Check if event already exists
  const { data: existingEvent } = await supabase
    .from('events')
    .select('id')
    .eq('slug', eventConfig.slug)
    .maybeSingle()

  let eventId: string

  if (existingEvent) {
    eventId = existingEvent.id
    console.log(`   → event already exists (id: ${eventId})`)
  } else {
    const { data: newEvent, error: eventError } = await supabase
      .from('events')
      .insert({
        slug:         eventConfig.slug,
        display_name: eventConfig.display_name,
        config_key:   eventConfig.ruleset,
        status:       'DRAFT',
      })
      .select('id')
      .single()

    if (eventError || !newEvent) bail(`events insert: ${eventError?.message}`)
    eventId = newEvent.id
    console.log(`   ✓ Event created (id: ${eventId})`)

    // ── 3. auction_state row (created atomically with event) ──────────────
    const { error: stateError } = await supabase
      .from('auction_state')
      .insert({
        event_id: eventId,
        phase:    'WAITING',
        status:   'IDLE',
      })
    if (stateError) bail(`auction_state insert: ${stateError.message}`)
    console.log('   ✓ auction_state row created (WAITING / IDLE)')
  }

  // ── 4. Participant users + rows ───────────────────────────────────────────
  console.log('\n3. Creating participants...')

  const participantIdMap = new Map<string, string>() // username → participants.id

  for (const p of roster.participants) {
    const authId = await createAuthUser(p.username, p.password)

    const { error: userError } = await supabase
      .from('users')
      .upsert(
        { id: authId, username: p.username, role: 'PARTICIPANT' },
        { onConflict: 'id' }
      )
    if (userError) bail(`users insert (${p.username}): ${userError.message}`)

    // Check if participant row already exists for this event
    const { data: existing } = await supabase
      .from('participants')
      .select('id')
      .eq('event_id', eventId)
      .eq('user_id', authId)
      .maybeSingle()

    let participantId: string

    if (existing) {
      participantId = existing.id
      console.log(`   → participant already exists: ${p.display_name}`)
    } else {
      const { data: newP, error: pError } = await supabase
        .from('participants')
        .insert({
          event_id:     eventId,
          user_id:      authId,
          display_name: p.display_name,
          budget:       AUCTION_CONFIG.INITIAL_BUDGET,
        })
        .select('id')
        .single()

      if (pError || !newP) bail(`participants insert (${p.username}): ${pError?.message}`)
      participantId = newP.id
      console.log(`   ✓ ${p.display_name} (${p.username})`)
    }

    participantIdMap.set(p.username, participantId)
  }

  // ── 5. Coach users + rows ─────────────────────────────────────────────────
  console.log('\n4. Creating coaches...')

  const coachIdMap = new Map<string, string>() // username → coaches.id

  for (const c of roster.coaches) {
    const authId = await createAuthUser(c.username, c.password)

    const { error: userError } = await supabase
      .from('users')
      .upsert(
        { id: authId, username: c.username, role: 'COACH' },
        { onConflict: 'id' }
      )
    if (userError) bail(`users insert (${c.username}): ${userError.message}`)

    const { data: existing } = await supabase
      .from('coaches')
      .select('id')
      .eq('event_id', eventId)
      .eq('user_id', authId)
      .maybeSingle()

    let coachId: string

    if (existing) {
      coachId = existing.id
      console.log(`   → coach already exists: ${c.display_name}`)
    } else {
      const { data: newC, error: cError } = await supabase
        .from('coaches')
        .insert({
          event_id:     eventId,
          user_id:      authId,
          display_name: c.display_name,
        })
        .select('id')
        .single()

      if (cError || !newC) bail(`coaches insert (${c.username}): ${cError?.message}`)
      coachId = newC.id
      console.log(`   ✓ ${c.display_name} (${c.username}) → manages ${c.manages}`)
    }

    coachIdMap.set(c.username, coachId)
  }

  // ── 6. coach_participants links ───────────────────────────────────────────
  console.log('\n5. Linking coaches to participants...')

  for (const c of roster.coaches) {
    const coachId       = coachIdMap.get(c.username)
    const participantId = participantIdMap.get(c.manages)

    if (!coachId)       bail(`coach ID not found for ${c.username}`)
    if (!participantId) bail(`participant ID not found for ${c.manages}`)

    const { error } = await supabase
      .from('coach_participants')
      .upsert(
        {
          event_id:            eventId,
          coach_id:            coachId,
          participant_id:      participantId,
          overrides_remaining: AUCTION_CONFIG.COACH_OVERRIDES,
        },
        { onConflict: 'event_id,coach_id,participant_id' }
      )

    if (error) bail(`coach_participants insert: ${error.message}`)
    console.log(`   ✓ ${c.display_name} ↔ ${c.manages}`)
  }

  // ── 7. Special auction items (one per coach) ──────────────────────────────
  console.log('\n6. Seeding special auction items...')

  for (const c of roster.coaches) {
    const coachId = coachIdMap.get(c.username)!

    // Check if item already exists for this coach in this event
    const { data: existing } = await supabase
      .from('special_auction_items')
      .select('id')
      .eq('event_id', eventId)
      .eq('coach_id', coachId)
      .maybeSingle()

    if (existing) {
      console.log(`   → item already exists for ${c.display_name}`)
      continue
    }

    const { error } = await supabase
      .from('special_auction_items')
      .insert({
        event_id:    eventId,
        coach_id:    coachId,
        description: `Sesión de entrenamiento con ${c.display_name}`,
        status:      'PENDING',
        final_price: 0,
      })

    if (error) bail(`special_auction_items insert (${c.username}): ${error.message}`)
    console.log(`   ✓ Training session item for ${c.display_name}`)
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log(`
✅ Event seeded successfully.

   Event ID : ${eventId}
   Slug     : ${eventConfig.slug}
   Status   : DRAFT (not yet visible to participants)

Next steps:
   1. Fill in real display names and passwords in event.config.ts
   2. Re-run this script to update
   3. When ready for participants to see the event, run:

      UPDATE events SET status = 'ACTIVE' WHERE slug = '${eventConfig.slug}';

      (in Supabase Studio → SQL Editor)
`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
