import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nominateAction } from '../nominate.action'
import {
  makeMockClient, q, qCount,
  EVENT_ID, PARTICIPANT_ID, COACH_ID, TURN_ID,
  MOCK_POKEMON_META, MOCK_STATE_IDLE,
  SPECIES_ID,
} from '@/test/helpers'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/features/auction/engine/validateNomination', () => ({
  validateNomination: vi.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { validateNomination } from '@/features/auction/engine/validateNomination'

const INPUT = { eventId: EVENT_ID, speciesId: SPECIES_ID }

// Builds the full happy-path chain for the PARTICIPANT path.
// validateNomination is mocked to return valid, so the chain is:
//   users.role → participants row → auction_pokemon insert → auction_state update
function buildParticipantClient() {
  const { supabase } = makeMockClient()
  supabase.from
    .mockReturnValueOnce(q({ data: { role: 'PARTICIPANT' } }))
    .mockReturnValueOnce(q({ data: { id: PARTICIPANT_ID } }))             // participant row
    // openAuction:
    .mockReturnValueOnce(q({ data: MOCK_POKEMON_META }))                  // pokemon_meta
    .mockReturnValueOnce(q({ data: { id: 'auction-pokemon-uuid' } }))    // auction_pokemon insert
    .mockReturnValueOnce(q({ data: null }))                               // auction_state update
  return supabase
}

// Builds the happy-path chain for the COACH path.
function buildCoachClient() {
  const { supabase } = makeMockClient()
  supabase.from
    .mockReturnValueOnce(q({ data: { role: 'COACH' } }))
    .mockReturnValueOnce(q({ data: { id: COACH_ID } }))                   // coach row
    .mockReturnValueOnce(q({ data: { current_turn_id: TURN_ID } }))       // auction_state
    .mockReturnValueOnce(q({ data: { participant_id: PARTICIPANT_ID } })) // current turn
    .mockReturnValueOnce(q({ data: { overrides_remaining: 2 } }))         // assignment
    // validateNomination mocked below
    // openAuction:
    .mockReturnValueOnce(q({ data: null }))                               // decrement overrides
    .mockReturnValueOnce(q({ data: MOCK_POKEMON_META }))                  // pokemon_meta
    .mockReturnValueOnce(q({ data: { id: 'auction-pokemon-uuid' } }))    // auction_pokemon insert
    .mockReturnValueOnce(q({ data: null }))                               // auction_state update
  return supabase
}

beforeEach(() => {
  vi.mocked(validateNomination).mockResolvedValue({ valid: true })
})

describe('nominateAction', () => {
  describe('authentication and role checks', () => {
    it('returns error when not authenticated', async () => {
      const { supabase } = makeMockClient({ user: null })
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await nominateAction(INPUT)

      expect(result).toEqual({ success: false, error: 'Not authenticated.' })
    })

    it('returns error when user is HOST', async () => {
      const { supabase } = makeMockClient()
      supabase.from.mockReturnValueOnce(q({ data: { role: 'HOST' } }))
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await nominateAction(INPUT)

      expect(result).toEqual({ success: false, error: 'Only participants and coaches can nominate.' })
    })
  })

  describe('PARTICIPANT path', () => {
    it('returns error when participant row not found', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: { role: 'PARTICIPANT' } }))
        .mockReturnValueOnce(q({ data: null, error: { message: 'Not found' } }))
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await nominateAction(INPUT)

      expect(result).toEqual({ success: false, error: 'Participant not found for this event.' })
    })

    it('returns the validation error from the engine when nomination is invalid', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: { role: 'PARTICIPANT' } }))
        .mockReturnValueOnce(q({ data: { id: PARTICIPANT_ID } }))
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)
      vi.mocked(validateNomination).mockResolvedValue({ valid: false, reason: 'It is not your turn to nominate.' })

      const result = await nominateAction(INPUT)

      expect(result).toEqual({ success: false, error: 'It is not your turn to nominate.' })
    })

    it('calls validateNomination with PARTICIPANT type and resolved participant id', async () => {
      vi.mocked(createSupabaseServerClient).mockResolvedValue(buildParticipantClient() as any)

      await nominateAction(INPUT)

      expect(validateNomination).toHaveBeenCalledWith({
        eventId:              EVENT_ID,
        speciesId:            SPECIES_ID,
        nominatedBy:          'PARTICIPANT',
        nominatedByParticipantId: PARTICIPANT_ID,
      })
    })

    it('returns success on the happy path', async () => {
      vi.mocked(createSupabaseServerClient).mockResolvedValue(buildParticipantClient() as any)

      const result = await nominateAction(INPUT)

      expect(result).toEqual({ success: true })
    })
  })

  describe('COACH path', () => {
    it('returns error when coach row not found for this event', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: { role: 'COACH' } }))
        .mockReturnValueOnce(q({ data: null, error: { message: 'Not found' } }))
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await nominateAction(INPUT)

      expect(result).toEqual({ success: false, error: 'Coach not found for this event.' })
    })

    it('returns error when coach is not assigned to the current turn participant', async () => {
      const { supabase } = makeMockClient()
      supabase.from
        .mockReturnValueOnce(q({ data: { role: 'COACH' } }))
        .mockReturnValueOnce(q({ data: { id: COACH_ID } }))
        .mockReturnValueOnce(q({ data: { current_turn_id: TURN_ID } }))
        .mockReturnValueOnce(q({ data: { participant_id: PARTICIPANT_ID } }))
        .mockReturnValueOnce(q({ data: null, error: { message: 'Not found' } }))  // no assignment
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as any)

      const result = await nominateAction(INPUT)

      expect(result).toEqual({ success: false, error: 'Coach is not assigned to the current participant.' })
    })

    it('calls validateNomination with COACH_OVERRIDE type and resolved ids', async () => {
      vi.mocked(createSupabaseServerClient).mockResolvedValue(buildCoachClient() as any)

      await nominateAction(INPUT)

      expect(validateNomination).toHaveBeenCalledWith({
        eventId:              EVENT_ID,
        speciesId:            SPECIES_ID,
        nominatedBy:          'COACH_OVERRIDE',
        nominatedByParticipantId: PARTICIPANT_ID,
        coachId:              COACH_ID,
      })
    })

    it('decrements overrides_remaining and returns success on the happy path', async () => {
      vi.mocked(createSupabaseServerClient).mockResolvedValue(buildCoachClient() as any)

      const result = await nominateAction(INPUT)

      expect(result).toEqual({ success: true })
    })
  })
})
