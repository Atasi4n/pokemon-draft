import { describe, it, expect, vi } from 'vitest'
import { validateNomination } from '../validateNomination'
import {
  makeMockClient, q, qCount,
  EVENT_ID, PARTICIPANT_ID, COACH_ID, TURN_ID,
  MOCK_STATE_IDLE, MOCK_STATE_MEGA,
  MOCK_POKEMON_META, MOCK_MEGA_POKEMON_META,
  SPECIES_ID, MEGA_SPECIES_ID,
} from '@/test/helpers'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase/server'

// Fully happy-path client for PARTICIPANT nominations
function buildValidParticipantClient(opts: {
  state?: object
  pokemon?: object
} = {}) {
  const { supabase } = makeMockClient()
  supabase.from
    .mockReturnValueOnce(q({ data: opts.state ?? MOCK_STATE_IDLE }))       // auction_state
    .mockReturnValueOnce(q({ data: opts.pokemon ?? MOCK_POKEMON_META }))   // pokemon_meta
    .mockReturnValueOnce(qCount(0))                                         // team_pokemon (not owned)
    .mockReturnValueOnce(qCount(0))                                         // auction_pokemon (not active)
    .mockReturnValueOnce(q({ data: { participant_id: PARTICIPANT_ID } }))  // current turn
  return supabase
}

describe('validateNomination', () => {
  describe('Rule 1 — banned species (config check)', () => {
    it.each([9, 94, 121, 448])('rejects banned species ID %i (full ban)', async (bannedId) => {
      const result = await validateNomination({
        eventId:              EVENT_ID,
        speciesId:            bannedId,
        nominatedBy:          'PARTICIPANT',
        nominatedByParticipantId: PARTICIPANT_ID,
      })

      expect(result).toEqual({ valid: false, reason: 'This Pokemon is banned from the auction.' })
    })

    it('does not reject Palafin (964) at the species level — only the evolved form is banned in battle', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_IDLE }))
        .mockReturnValueOnce(q({ error: { message: 'Not found' } }))  // 964 not in pokemon_meta → fails rule 2
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      // Should fail at rule 2 (not in Champions format), NOT rule 1 (not species-banned)
      const result = await validateNomination({
        eventId:              EVENT_ID,
        speciesId:            964,
        nominatedBy:          'PARTICIPANT',
        nominatedByParticipantId: PARTICIPANT_ID,
      })

      expect(result).toEqual({ valid: false, reason: 'Pokemon not found in the Champions format.' })
    })
  })

  describe('Rule 2 — species must exist in pokemon_meta (Champions format)', () => {
    it('returns error when pokemon_meta row is missing', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_IDLE }))
        .mockReturnValueOnce(q({ error: { message: 'Not found' } }))
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateNomination({
        eventId:              EVENT_ID,
        speciesId:            999,  // not in Champions format
        nominatedBy:          'PARTICIPANT',
        nominatedByParticipantId: PARTICIPANT_ID,
      })

      expect(result).toEqual({ valid: false, reason: 'Pokemon not found in the Champions format.' })
    })
  })

  describe('Rule 3 — mega phase requires a mega-capable pokemon', () => {
    it('rejects non-mega pokemon during MEGA phase', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_MEGA }))
        .mockReturnValueOnce(q({ data: MOCK_POKEMON_META }))  // is_mega_capable: false
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateNomination({
        eventId:              EVENT_ID,
        speciesId:            SPECIES_ID,
        nominatedBy:          'PARTICIPANT',
        nominatedByParticipantId: PARTICIPANT_ID,
      })

      expect(result).toEqual({
        valid:  false,
        reason: 'Only Mega-capable Pokemon can be nominated during the Mega round.',
      })
    })

    it('accepts a mega-capable pokemon during MEGA phase', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_MEGA }))
        .mockReturnValueOnce(q({ data: MOCK_MEGA_POKEMON_META }))  // is_mega_capable: true
        .mockReturnValueOnce(qCount(0))                             // not on any team
        .mockReturnValueOnce(qCount(0))                             // not in active auction
        .mockReturnValueOnce(q({ data: { participant_id: PARTICIPANT_ID } }))
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateNomination({
        eventId:              EVENT_ID,
        speciesId:            MEGA_SPECIES_ID,
        nominatedBy:          'PARTICIPANT',
        nominatedByParticipantId: PARTICIPANT_ID,
      })

      expect(result).toEqual({ valid: true })
    })
  })

  describe('Rule 4 — not already on any team', () => {
    it('returns error when species is already on a team', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_IDLE }))
        .mockReturnValueOnce(q({ data: MOCK_POKEMON_META }))
        // Promise.all fires both from() calls before the early-return check,
        // so both count mocks must be present even though auction_pokemon is never used.
        .mockReturnValueOnce(qCount(1))  // team_pokemon → already owned
        .mockReturnValueOnce(qCount(0))  // auction_pokemon count (consumed but ignored)
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateNomination({
        eventId:              EVENT_ID,
        speciesId:            SPECIES_ID,
        nominatedBy:          'PARTICIPANT',
        nominatedByParticipantId: PARTICIPANT_ID,
      })

      expect(result).toEqual({ valid: false, reason: 'This Pokemon is already on a team.' })
    })
  })

  describe('Rule 5 — not already in an active auction', () => {
    it('returns error when species is currently being auctioned', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_IDLE }))
        .mockReturnValueOnce(q({ data: MOCK_POKEMON_META }))
        .mockReturnValueOnce(qCount(0))  // not on a team
        .mockReturnValueOnce(qCount(1))  // active auction exists
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateNomination({
        eventId:              EVENT_ID,
        speciesId:            SPECIES_ID,
        nominatedBy:          'PARTICIPANT',
        nominatedByParticipantId: PARTICIPANT_ID,
      })

      expect(result).toEqual({ valid: false, reason: 'This Pokemon is already being auctioned.' })
    })
  })

  describe('Rule 6 — PARTICIPANT must be the current turn holder', () => {
    it('returns error when it is not this participant\'s turn', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: { ...MOCK_STATE_IDLE, current_turn_id: TURN_ID } }))
        .mockReturnValueOnce(q({ data: MOCK_POKEMON_META }))
        .mockReturnValueOnce(qCount(0))
        .mockReturnValueOnce(qCount(0))
        .mockReturnValueOnce(q({ data: { participant_id: 'other-participant-uuid' } }))  // different participant
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateNomination({
        eventId:              EVENT_ID,
        speciesId:            SPECIES_ID,
        nominatedBy:          'PARTICIPANT',
        nominatedByParticipantId: PARTICIPANT_ID,
      })

      expect(result).toEqual({ valid: false, reason: 'It is not your turn to nominate.' })
    })
  })

  describe('Rule 7 — COACH_OVERRIDE: must be assigned with overrides remaining', () => {
    it('returns error when coach is not assigned to the current participant', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_IDLE }))
        .mockReturnValueOnce(q({ data: MOCK_POKEMON_META }))
        .mockReturnValueOnce(qCount(0))
        .mockReturnValueOnce(qCount(0))
        .mockReturnValueOnce(q({ error: { message: 'Not found' } }))  // no assignment
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateNomination({
        eventId:              EVENT_ID,
        speciesId:            SPECIES_ID,
        nominatedBy:          'COACH_OVERRIDE',
        nominatedByParticipantId: PARTICIPANT_ID,
        coachId:              COACH_ID,
      })

      expect(result).toEqual({ valid: false, reason: 'Coach is not assigned to this participant.' })
    })

    it('returns error when coach has no overrides remaining', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_IDLE }))
        .mockReturnValueOnce(q({ data: MOCK_POKEMON_META }))
        .mockReturnValueOnce(qCount(0))
        .mockReturnValueOnce(qCount(0))
        .mockReturnValueOnce(q({ data: { overrides_remaining: 0 } }))  // used up
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateNomination({
        eventId:              EVENT_ID,
        speciesId:            SPECIES_ID,
        nominatedBy:          'COACH_OVERRIDE',
        nominatedByParticipantId: PARTICIPANT_ID,
        coachId:              COACH_ID,
      })

      expect(result).toEqual({ valid: false, reason: 'No nomination overrides remaining.' })
    })

    it('accepts a valid coach override with overrides remaining', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_IDLE }))
        .mockReturnValueOnce(q({ data: MOCK_POKEMON_META }))
        .mockReturnValueOnce(qCount(0))
        .mockReturnValueOnce(qCount(0))
        .mockReturnValueOnce(q({ data: { overrides_remaining: 1 } }))  // 1 override left
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateNomination({
        eventId:              EVENT_ID,
        speciesId:            SPECIES_ID,
        nominatedBy:          'COACH_OVERRIDE',
        nominatedByParticipantId: PARTICIPANT_ID,
        coachId:              COACH_ID,
      })

      expect(result).toEqual({ valid: true })
    })

    it('HOST nominations skip turn and coach checks', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: MOCK_STATE_IDLE }))
        .mockReturnValueOnce(q({ data: MOCK_POKEMON_META }))
        .mockReturnValueOnce(qCount(0))
        .mockReturnValueOnce(qCount(0))
        // No further calls expected for HOST (no turn or coach check)
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await validateNomination({
        eventId:     EVENT_ID,
        speciesId:   SPECIES_ID,
        nominatedBy: 'HOST',
      })

      expect(result).toEqual({ valid: true })
    })
  })

  it('returns valid: true for a fully valid PARTICIPANT nomination', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildValidParticipantClient() as any
    )

    const result = await validateNomination({
      eventId:              EVENT_ID,
      speciesId:            SPECIES_ID,
      nominatedBy:          'PARTICIPANT',
      nominatedByParticipantId: PARTICIPANT_ID,
    })

    expect(result).toEqual({ valid: true })
  })
})
