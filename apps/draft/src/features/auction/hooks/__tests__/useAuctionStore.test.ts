import { describe, it, expect, beforeEach } from 'vitest'
import { useAuctionStore } from '../useAuctionStore'
import {
  EVENT_ID, PARTICIPANT_ID, TURN_ID, POKEMON_ID,
  MOCK_STATE_BIDDING, MOCK_STATE_IDLE,
} from '@/test/helpers'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_EVENT = { id: EVENT_ID, slug: 'test', status: 'ACTIVE' }

const MOCK_PARTICIPANT_WITH_TEAM = {
  id:       PARTICIPANT_ID,
  event_id: EVENT_ID,
  budget:   1000,
  has_mega: false,
  team:     [] as unknown[],
  coach:    null,
}

const MOCK_TURN = { id: TURN_ID, participant_id: PARTICIPANT_ID, position: 0 }

const MOCK_POKEMON = {
  id:              POKEMON_ID,
  species_id:      1,
  name_snapshot:   'Bulbasaur',
  sprite_snapshot: 'https://example.com/bulbasaur.png',
  is_mega_capable: false,
  status:          'ACTIVE',
}

const MOCK_BID = {
  id:             'bid-uuid',
  participant_id: PARTICIPANT_ID,
  amount:         100,
  placed_at:      new Date().toISOString(),
}

const MOCK_TEAM_POKEMON = {
  id:             'tp-uuid',
  participant_id: PARTICIPANT_ID,
  species_id:     1,
  name_snapshot:  'Bulbasaur',
}

const MOCK_SNAPSHOT = {
  event:          MOCK_EVENT,
  state:          MOCK_STATE_IDLE,
  participants:   [MOCK_PARTICIPANT_WITH_TEAM],
  currentPokemon: null,
  currentBids:    [],
  turns:          [MOCK_TURN],
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  useAuctionStore.setState({
    event:          null,
    state:          null,
    participants:   [],
    currentPokemon: null,
    currentBids:    [],
    turns:          [],
  })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAuctionStore', () => {
  describe('setSnapshot', () => {
    it('populates all fields from a snapshot', () => {
      useAuctionStore.getState().setSnapshot(MOCK_SNAPSHOT as any)

      const s = useAuctionStore.getState()
      expect(s.event).toEqual(MOCK_EVENT)
      expect(s.state).toEqual(MOCK_STATE_IDLE)
      expect(s.participants).toEqual([MOCK_PARTICIPANT_WITH_TEAM])
      expect(s.turns).toEqual([MOCK_TURN])
      expect(s.currentPokemon).toBeNull()
      expect(s.currentBids).toEqual([])
    })

    it('overwrites existing state on repeated calls', () => {
      useAuctionStore.getState().setSnapshot(MOCK_SNAPSHOT as any)
      useAuctionStore.getState().setSnapshot({
        ...MOCK_SNAPSHOT,
        participants: [],
        turns:        [],
      } as any)

      expect(useAuctionStore.getState().participants).toEqual([])
    })
  })

  describe('updateState', () => {
    it('updates the state field', () => {
      useAuctionStore.getState().setSnapshot(MOCK_SNAPSHOT as any)
      useAuctionStore.getState().updateState(MOCK_STATE_BIDDING as any)

      expect(useAuctionStore.getState().state).toEqual(MOCK_STATE_BIDDING)
    })

    it('clears currentBids and currentPokemon when the auctioned pokemon changes', () => {
      useAuctionStore.setState({
        state:          MOCK_STATE_IDLE as any,
        currentPokemon: MOCK_POKEMON as any,
        currentBids:    [MOCK_BID as any],
      })

      useAuctionStore.getState().updateState(MOCK_STATE_BIDDING as any)

      const s = useAuctionStore.getState()
      expect(s.currentPokemon).toBeNull()
      expect(s.currentBids).toEqual([])
    })

    it('preserves currentBids when the same pokemon is still being auctioned', () => {
      useAuctionStore.setState({
        state:       MOCK_STATE_BIDDING as any,
        currentBids: [MOCK_BID as any],
      })

      // Same current_auction_pokemon_id — only timer changed
      const updatedState = { ...MOCK_STATE_BIDDING, timer_ends_at: new Date(Date.now() + 5_000).toISOString() }
      useAuctionStore.getState().updateState(updatedState as any)

      expect(useAuctionStore.getState().currentBids).toEqual([MOCK_BID])
    })
  })

  describe('setCurrentPokemon', () => {
    it('sets the current pokemon', () => {
      useAuctionStore.getState().setCurrentPokemon(MOCK_POKEMON as any)

      expect(useAuctionStore.getState().currentPokemon).toEqual(MOCK_POKEMON)
    })
  })

  describe('addBid', () => {
    it('appends a bid to currentBids', () => {
      useAuctionStore.getState().addBid(MOCK_BID as any)

      expect(useAuctionStore.getState().currentBids).toEqual([MOCK_BID])
    })

    it('appends successive bids in order', () => {
      const bid2 = { ...MOCK_BID, id: 'bid-2', amount: 125 }
      useAuctionStore.getState().addBid(MOCK_BID as any)
      useAuctionStore.getState().addBid(bid2 as any)

      expect(useAuctionStore.getState().currentBids).toHaveLength(2)
      expect(useAuctionStore.getState().currentBids[1]).toEqual(bid2)
    })
  })

  describe('updateParticipant', () => {
    beforeEach(() => {
      useAuctionStore.getState().setSnapshot(MOCK_SNAPSHOT as any)
    })

    it('merges updated fields onto the matching participant', () => {
      useAuctionStore.getState().updateParticipant({ id: PARTICIPANT_ID, budget: 750, has_mega: true } as any)

      const updated = useAuctionStore.getState().participants.find((p) => p.id === PARTICIPANT_ID)
      expect(updated?.budget).toBe(750)
      expect(updated?.has_mega).toBe(true)
    })

    it('preserves team and coach references when updating a participant', () => {
      useAuctionStore.setState({
        participants: [{
          ...MOCK_PARTICIPANT_WITH_TEAM,
          team:  [MOCK_TEAM_POKEMON],
          coach: { id: 'coach-uuid' },
        }] as any,
      })

      useAuctionStore.getState().updateParticipant({ id: PARTICIPANT_ID, budget: 500 } as any)

      const updated = useAuctionStore.getState().participants[0]
      expect(updated.team).toHaveLength(1)
      expect(updated.coach).toEqual({ id: 'coach-uuid' })
    })

    it('leaves other participants unchanged', () => {
      const other = { ...MOCK_PARTICIPANT_WITH_TEAM, id: 'other-uuid', budget: 1000 }
      useAuctionStore.setState({ participants: [MOCK_PARTICIPANT_WITH_TEAM as any, other as any] })

      useAuctionStore.getState().updateParticipant({ id: PARTICIPANT_ID, budget: 300 } as any)

      const otherAfter = useAuctionStore.getState().participants.find((p) => p.id === 'other-uuid')
      expect(otherAfter?.budget).toBe(1000)
    })
  })

  describe('addTeamPokemon', () => {
    beforeEach(() => {
      useAuctionStore.getState().setSnapshot(MOCK_SNAPSHOT as any)
    })

    it('appends pokemon to the owning participant team', () => {
      useAuctionStore.getState().addTeamPokemon(MOCK_TEAM_POKEMON as any)

      const participant = useAuctionStore.getState().participants.find((p) => p.id === PARTICIPANT_ID)
      expect(participant?.team).toHaveLength(1)
      expect(participant?.team[0]).toEqual(MOCK_TEAM_POKEMON)
    })

    it('does not affect other participants', () => {
      const other = { ...MOCK_PARTICIPANT_WITH_TEAM, id: 'other-uuid' }
      useAuctionStore.setState({ participants: [MOCK_PARTICIPANT_WITH_TEAM as any, other as any] })

      useAuctionStore.getState().addTeamPokemon(MOCK_TEAM_POKEMON as any)

      const otherAfter = useAuctionStore.getState().participants.find((p) => p.id === 'other-uuid')
      expect(otherAfter?.team).toHaveLength(0)
    })
  })
})
