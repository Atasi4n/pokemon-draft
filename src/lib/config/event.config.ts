// SECURITY: contains plaintext passwords for the seed script — never commit to a public repo.

export const EVENTS_CONFIG = [
  {
    slug:         'paralimpico-2025',
    display_name: 'Pokémon Paralímpico 2025',
    ruleset:      'standard',

    roster: {
      participants: [
        { username: 'Emely', password: 'change-me-1', display_name: 'Emely' },
        { username: 'Joely', password: 'change-me-2', display_name: 'Joely' },
        { username: 'Armando', password: 'change-me-3', display_name: 'Armando' },
        { username: 'Alexa', password: 'change-me-4', display_name: 'Alexa' },
        { username: 'Daniela', password: 'change-me-5', display_name: 'Daniela' },
        { username: 'Elian', password: 'change-me-6', display_name: 'Elian' },
        { username: 'Cri', password: 'change-me-7', display_name: 'Cri' },
        { username: 'Di', password: 'change-me-8', display_name: 'Di' },
      ],
      coaches: [
        { username: 'Eduardo', password: 'change-me-c1', display_name: 'Eduardo', manages: 'Emely' },
        { username: 'Nicolas', password: 'change-me-c2', display_name: 'Nicolas', manages: 'Joely' },
        { username: 'Alexander', password: 'change-me-c3', display_name: 'Alexander', manages: 'Armando' },
        { username: 'Liam', password: 'change-me-c4', display_name: 'Liam', manages: 'Alexa' },
        { username: 'Hendrick', password: 'change-me-c5', display_name: 'Hendrick', manages: 'Daniela' },
        { username: 'Felix', password: 'change-me-c6', display_name: 'Felix', manages: 'Elian' },
        { username: 'Said', password: 'change-me-c7', display_name: 'Said', manages: 'Cri' },
        { username: 'Poke', password: 'change-me-c8', display_name: 'Poke', manages: 'Di' },
      ],
      host: {
        username: 'host',
        password: 'change-me-host',
        display_name: 'Host',
      },
    },
  },
] as const

export type EventSlug = typeof EVENTS_CONFIG[number]['slug']