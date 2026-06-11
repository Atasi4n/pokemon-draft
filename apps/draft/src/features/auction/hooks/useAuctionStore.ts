import { create } from 'zustand'
import type {
  EventRow,
  AuctionStateRow,
  AuctionPokemonRow,
  BidRow,
  TeamPokemonRow,
  ParticipantRow,
  ParticipantWithTeam,
  AuctionTurnRow,
  AuctionSnapshot,
} from '@/types/auction.types'

type AuctionStore = {
  event:          EventRow | null
  state:          AuctionStateRow | null
  participants:   ParticipantWithTeam[]
  currentPokemon: AuctionPokemonRow | null
  currentBids:    BidRow[]
  turns:          AuctionTurnRow[]

  setSnapshot:       (snapshot: AuctionSnapshot)       => void
  updateState:       (state: AuctionStateRow)          => void
  setCurrentPokemon: (pokemon: AuctionPokemonRow)      => void
  addBid:            (bid: BidRow)                     => void
  updateParticipant: (participant: ParticipantRow)      => void
  addTeamPokemon:    (pokemon: TeamPokemonRow)          => void
}

export const useAuctionStore = create<AuctionStore>()((set) => ({
  event:          null,
  state:          null,
  participants:   [],
  currentPokemon: null,
  currentBids:    [],
  turns:          [],

  setSnapshot: (snapshot) => set({
    event:          snapshot.event,
    state:          snapshot.state,
    participants:   snapshot.participants,
    currentPokemon: snapshot.currentPokemon,
    currentBids:    snapshot.currentBids,
    turns:          snapshot.turns,
  }),

  // When the pokemon being auctioned changes, clear stale bid history.
  // The new pokemon's bids come in via the realtime bids subscription.
  updateState: (newState) => set((prev) => {
    const pokemonChanged =
      newState.current_auction_pokemon_id !== prev.state?.current_auction_pokemon_id
    return {
      state: newState,
      ...(pokemonChanged ? { currentBids: [], currentPokemon: null } : {}),
    }
  }),

  setCurrentPokemon: (pokemon) => set({ currentPokemon: pokemon }),

  addBid: (bid) => set((prev) => ({
    currentBids: [...prev.currentBids, bid],
  })),

  // Merge updated participant fields while preserving team and coach references.
  updateParticipant: (participant) => set((prev) => ({
    participants: prev.participants.map((p) =>
      p.id === participant.id ? { ...p, ...participant } : p
    ),
  })),

  addTeamPokemon: (pokemon) => set((prev) => ({
    participants: prev.participants.map((p) =>
      p.id === pokemon.participant_id
        ? { ...p, team: [...p.team, pokemon] }
        : p
    ),
  })),
}))
