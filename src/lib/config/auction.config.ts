export const AUCTION_CONFIG = {
  INITIAL_BUDGET:  1000,
  MIN_BID:         50,
  MAX_BID:         750,
  MIN_INCREMENT:   25,

  TEAM_SIZE: 6,

  TIMER_SECONDS:       30,
  BID_EXTENSION_SECS:  5,

  BID_COOLDOWN_SECS: 2,

  COACH_OVERRIDES: 2,

  // Bans the entire species (all forms). Checked in validateNomination, never stored in the database.
  BANNED_SPECIES_IDS: [
    9,    // Blastoise  → Mega Blastoise
    94,   // Gengar     → Mega Gengar
    121,  // Starmie    → Mega Starmie
    448,  // Lucario    → Mega Lucario
  ] as const,

  // Base form is nominatable but does NOT satisfy the mega phase requirement.
  // The evolved/hero form is banned outright.
  BANNED_EVOLVED_FORMS: [
    964,  // Palafin-Zero allowed; Palafin-Hero (Zero to Hero) banned
  ] as const,

  BAN_VIOLATION_PENALTY: 100,
} as const

export type AuctionConfig = typeof AUCTION_CONFIG
export type BannedSpeciesId = typeof AUCTION_CONFIG.BANNED_SPECIES_IDS[number]
export type BannedEvolvedFormId = typeof AUCTION_CONFIG.BANNED_EVOLVED_FORMS[number]
