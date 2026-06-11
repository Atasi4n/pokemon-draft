'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuctionStore } from '@/features/auction/hooks/useAuctionStore'
import { getSnapshotAction } from '@/features/auction/actions/snapshot.action'
import type {
  AuctionStateRow,
  AuctionPokemonRow,
  BidRow,
  ParticipantRow,
  TeamPokemonRow,
} from '@/types/auction.types'

export function useAuctionRealtime(eventId: string) {
  // Pull only the store actions — they are stable references (defined once at
  // store creation) so these selectors never trigger re-renders.
  const setSnapshot       = useAuctionStore((s) => s.setSnapshot)
  const updateState       = useAuctionStore((s) => s.updateState)
  const setCurrentPokemon = useAuctionStore((s) => s.setCurrentPokemon)
  const addBid            = useAuctionStore((s) => s.addBid)
  const updateParticipant = useAuctionStore((s) => s.updateParticipant)
  const addTeamPokemon    = useAuctionStore((s) => s.addTeamPokemon)

  // The bids subscription is keyed by pokemon id — re-subscribe when it changes.
  const currentPokemonId = useAuctionStore(
    (s) => s.state?.current_auction_pokemon_id ?? null
  )

  // 1. Hydrate the store on mount via a full snapshot fetch.
  useEffect(() => {
    getSnapshotAction(eventId).then((result) => {
      if (result.success) setSnapshot(result.data)
    })
  }, [eventId, setSnapshot])

  // 2–5. Subscribe to all table changes except bids (bids need a dynamic filter).
  useEffect(() => {
    const channel = supabase
      .channel(`auction-${eventId}`)

      // auction_state: any change
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'auction_state', filter: `event_id=eq.${eventId}` },
        (payload) => updateState(payload.new as AuctionStateRow),
      )

      // auction_pokemon: INSERT — populates currentPokemon when a nomination starts.
      // Not listed in CLAUDE.md's realtime table, but required to keep the UI
      // current after a nomination (state update only carries the id, not the row).
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'auction_pokemon', filter: `event_id=eq.${eventId}` },
        (payload) => setCurrentPokemon(payload.new as AuctionPokemonRow),
      )

      // participants: budget, has_mega, connection_status
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'participants', filter: `event_id=eq.${eventId}` },
        (payload) => updateParticipant(payload.new as ParticipantRow),
      )

      // team_pokemon: new pokemon assigned to a team
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'team_pokemon', filter: `event_id=eq.${eventId}` },
        (payload) => addTeamPokemon(payload.new as TeamPokemonRow),
      )

      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [eventId, updateState, setCurrentPokemon, updateParticipant, addTeamPokemon])

  // 3. Bids subscription — filtered by current_auction_pokemon_id.
  // This effect re-runs (unsubscribes old channel, subscribes new) each time
  // the auctioned pokemon changes. updateState clears currentBids simultaneously
  // so there is no window with stale bids.
  useEffect(() => {
    if (!currentPokemonId) return

    const bidsChannel = supabase
      .channel(`auction-bids-${currentPokemonId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'bids',
          filter: `auction_pokemon_id=eq.${currentPokemonId}`,
        },
        (payload) => addBid(payload.new as BidRow),
      )
      .subscribe()

    return () => { supabase.removeChannel(bidsChannel) }
  }, [currentPokemonId, addBid])
}
