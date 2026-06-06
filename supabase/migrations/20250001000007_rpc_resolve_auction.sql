-- =============================================================
-- Migration 0008: RPC resolve_auction
-- Atomic auction resolution: assigns winner, deducts budget,
-- updates has_mega, advances turn, resets state.
-- Called by resolveAuction.ts and the timer Edge Function.
-- Must be idempotent — safe to call twice on the same event.
-- =============================================================

CREATE OR REPLACE FUNCTION resolve_auction(
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  MIN_BID  CONSTANT int := 50;

  v_state           auction_state%ROWTYPE;
  v_auction_pokemon auction_pokemon%ROWTYPE;
  v_winner_id       uuid;
  v_price           int;
  v_skip_assignment boolean := false;
  v_current_turn    auction_turns%ROWTYPE;
  v_max_position    int;
  v_next_position   int;
  v_next_turn_id    uuid;
BEGIN
  -- 1. Quick check without lock (idempotency fast path — avoids locking on every cron tick)
  SELECT * INTO v_state
  FROM auction_state
  WHERE event_id = p_event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Auction state not found.');
  END IF;

  IF v_state.status != 'BIDDING' OR v_state.current_auction_pokemon_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active bidding to resolve.');
  END IF;

  -- 2. Acquire row lock to prevent concurrent resolutions
  SELECT * INTO v_state
  FROM auction_state
  WHERE event_id = p_event_id
  FOR UPDATE;

  -- Re-check after lock: another call may have resolved between the two SELECTs
  IF v_state.status != 'BIDDING' OR v_state.current_auction_pokemon_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active bidding to resolve.');
  END IF;

  -- 3. Mark as RESOLVING immediately to block re-entrant calls
  UPDATE auction_state
  SET status = 'RESOLVING'
  WHERE event_id = p_event_id;

  -- Fetch the auction_pokemon being resolved
  SELECT * INTO v_auction_pokemon
  FROM auction_pokemon
  WHERE id = v_state.current_auction_pokemon_id;

  -- 4. Find the highest bid (order by amount DESC, placed_at ASC to break ties by earliest bid)
  SELECT participant_id, amount
  INTO v_winner_id, v_price
  FROM bids
  WHERE auction_pokemon_id = v_state.current_auction_pokemon_id
  ORDER BY amount DESC, placed_at ASC
  LIMIT 1;

  -- 5. No bids — determine winner by nomination type
  IF v_winner_id IS NULL THEN
    IF v_auction_pokemon.nominated_by = 'HOST' THEN
      -- Host-nominated with no bids: skip auto-assign, host handles manually
      UPDATE auction_pokemon
      SET status = 'CANCELLED'
      WHERE id = v_auction_pokemon.id;

      v_skip_assignment := true;
    ELSE
      -- Participant or coach-override nomination with no bids: auto-assign to nominator at MIN_BID
      v_winner_id := v_auction_pokemon.nominated_by_participant_id;
      v_price     := MIN_BID;
    END IF;
  END IF;

  -- 6–9. Assign pokemon to winner (skipped for HOST-nominated with no bids)
  IF NOT v_skip_assignment THEN

    -- 6. Insert into team_pokemon with snapshot fields from auction_pokemon
    INSERT INTO team_pokemon (
      event_id,
      participant_id,
      species_id,
      name_snapshot,
      sprite_snapshot,
      is_mega_capable,
      purchase_price,
      auction_pokemon_id
    )
    VALUES (
      p_event_id,
      v_winner_id,
      v_auction_pokemon.species_id,
      v_auction_pokemon.name_snapshot,
      v_auction_pokemon.sprite_snapshot,
      v_auction_pokemon.is_mega_capable,
      v_price,
      v_auction_pokemon.id
    );

    -- 7. Deduct price from winner's budget
    UPDATE participants
    SET budget = budget - v_price
    WHERE id = v_winner_id;

    -- 8. If mega-capable, mark participant as having their mega
    IF v_auction_pokemon.is_mega_capable THEN
      UPDATE participants
      SET has_mega = true
      WHERE id = v_winner_id;
    END IF;

    -- 9. Mark auction_pokemon as SOLD
    UPDATE auction_pokemon
    SET status     = 'SOLD',
        sold_to    = v_winner_id,
        sold_price = v_price
    WHERE id = v_auction_pokemon.id;

  END IF;

  -- 10. Advance turn (wraps to position 0 when at max)
  SELECT * INTO v_current_turn
  FROM auction_turns
  WHERE id = v_state.current_turn_id;

  SELECT MAX(position) INTO v_max_position
  FROM auction_turns
  WHERE event_id = p_event_id;

  v_next_position := CASE
    WHEN v_current_turn.position >= v_max_position THEN 0
    ELSE v_current_turn.position + 1
  END;

  SELECT id INTO v_next_turn_id
  FROM auction_turns
  WHERE event_id = p_event_id AND position = v_next_position;

  -- 11. Reset auction_state to IDLE
  UPDATE auction_state
  SET
    status                     = 'IDLE',
    current_turn_id            = v_next_turn_id,
    current_auction_pokemon_id = NULL,
    timer_ends_at              = NULL
  WHERE event_id = p_event_id;

  RETURN jsonb_build_object(
    'success',      true,
    'winner_id',    v_winner_id,
    'pokemon_name', v_auction_pokemon.name_snapshot
  );
END;
$$;
