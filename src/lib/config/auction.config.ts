export const AUCTION_CONFIG = {
  INITIAL_BUDGET:          1000,
  MIN_BID:                 50,
  MAX_BID:                 750,
  MIN_INCREMENT:           25,
  TEAM_SIZE:               6,
  TIMER_SECONDS:           30,
  BID_EXTENSION_SECS:      5,
  BID_COOLDOWN_SECS:       2,
  COACH_OVERRIDES:         2,

  // Banned by species_id (national dex #).
  BANNED_SPECIES_IDS: [
    9,    // Blastoise  (Mega Blastoise)
    94,   // Gengar     (Mega Gengar)
    121,  // Starmie    (Mega Starmie)
    448,  // Lucario    (Mega Lucario)
    964,  // Palafin
  ] as const,

  // Budget deducted if a player asks about a banned Pokémon.
  BAN_VIOLATION_PENALTY: 100,
} as const;