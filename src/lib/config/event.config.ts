export const EVENTS_CONFIG = [
  {
    slug:         "paralimpico-2025",
    display_name: "Pokémon Paralímpico 2025",
    ruleset:      "standard",
    participant_count: 8,
    coach_count:       8,
  },
] as const;

export type EventSlug = typeof EVENTS_CONFIG[number]["slug"];