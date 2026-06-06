-- =============================================================
-- Migration 0007: RPC place_bid
-- Atomic bid placement with row-lock on auction_state.
-- Called by placeBid.ts engine function.
-- =============================================================

CREATE OR REPLACE FUNCTION place_bid(
  p_event_id            uuid,
  p_participant_id      uuid,
  p_auction_pokemon_id  uuid,
  p_amount              int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Constants matching AUCTION_CONFIG
  MIN_BID          CONSTANT int := 50;
  MAX_BID          CONSTANT int := 750;
  MIN_INCREMENT    CONSTANT int := 25;
  TIMER_SECONDS    CONSTANT int := 30;
  BID_EXTENSION    CONSTANT int := 5;

  v_state         auction_state%ROWTYPE;
  v_highest_bid   int := 0;
  v_min_required  int;
  v_new_timer     timestamptz;
BEGIN
  -- 1. Lock auction_state row for this event (prevents concurrent bids racing)
  SELECT * INTO v_state
  FROM auction_state
  WHERE event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Auction state not found.');
  END IF;

  -- 2. Verify auction is in the expected state
  IF v_state.status != 'BIDDING' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bidding is not currently open.');
  END IF;

  IF v_state.current_auction_pokemon_id IS DISTINCT FROM p_auction_pokemon_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'This Pokemon is no longer being auctioned.');
  END IF;

  -- 3. Get current highest bid for this auction pokemon
  SELECT COALESCE(MAX(amount), 0) INTO v_highest_bid
  FROM bids
  WHERE auction_pokemon_id = p_auction_pokemon_id;

  -- 4. Verify amount meets the minimum required
  v_min_required := CASE
    WHEN v_highest_bid > 0 THEN v_highest_bid + MIN_INCREMENT
    ELSE MIN_BID
  END;

  IF p_amount < v_min_required THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   format('Minimum bid is $%s (current highest: $%s).', v_min_required, v_highest_bid)
    );
  END IF;

  IF p_amount > MAX_BID THEN
    RETURN jsonb_build_object('success', false, 'error', format('Maximum bid is $%s.', MAX_BID));
  END IF;

  -- 5. Insert the bid (placed_at uses DB default — never from client)
  INSERT INTO bids (event_id, auction_pokemon_id, participant_id, amount)
  VALUES (p_event_id, p_auction_pokemon_id, p_participant_id, p_amount);

  -- 6. Compute new timer:
  --    Extend by BID_EXTENSION seconds, but never more than TIMER_SECONDS from now.
  --    LEAST(now() + 30s, timer_ends_at + 5s)
  v_new_timer := LEAST(
    now() + (TIMER_SECONDS || ' seconds')::interval,
    v_state.timer_ends_at + (BID_EXTENSION || ' seconds')::interval
  );

  -- 7. Update the timer on auction_state
  UPDATE auction_state
  SET timer_ends_at = v_new_timer
  WHERE event_id = p_event_id;

  -- 8. Return success with the new timer value
  RETURN jsonb_build_object(
    'success',          true,
    'new_timer_ends_at', v_new_timer
  );
END;
$$;
