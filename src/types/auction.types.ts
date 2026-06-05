export type UserRole         = 'HOST' | 'PARTICIPANT' | 'COACH'
export type EventStatus      = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
export type AuctionPhase     = 'WAITING' | 'MEGA' | 'MAIN' | 'SPECIAL' | 'ENDED'
export type AuctionStatus    = 'IDLE' | 'NOMINATING' | 'BIDDING' | 'RESOLVING'
export type NominationType   = 'PARTICIPANT' | 'COACH_OVERRIDE' | 'HOST'
export type AuctionItemStatus = 'ACTIVE' | 'SOLD' | 'CANCELLED'
export type SpecialItemStatus = 'PENDING' | 'ACTIVE' | 'SOLD' | 'FREE'
export type ConnectionStatus = 'OFFLINE' | 'WAITING' | 'READY'

export type UserRow = {
  id:       string
  username: string
  role:     UserRole
}

export type PokemonMetaRow = {
  species_id:      number
  name:            string
  is_mega_capable: boolean
  sprite_url:      string | null
  types:           string[] | null
}

export type EventRow = {
  id:           string
  slug:         string
  display_name: string
  config_key:   string
  status:       EventStatus
  created_at:   string
}

export type ParticipantRow = {
  id:                  string
  event_id:            string
  user_id:             string
  display_name:        string
  team_name:           string | null
  budget:              number
  has_mega:            boolean
  special_session_won: boolean
  connection_status:   ConnectionStatus
}

export type CoachRow = {
  id:           string
  event_id:     string
  user_id:      string
  display_name: string
}

export type CoachParticipantRow = {
  id:                  string
  event_id:            string
  coach_id:            string
  participant_id:      string
  overrides_remaining: number
}

export type AuctionTurnRow = {
  id:             string
  event_id:       string
  participant_id: string
  position:       number
}

export type AuctionStateRow = {
  event_id:                    string
  phase:                       AuctionPhase
  status:                      AuctionStatus
  current_turn_id:             string | null
  current_auction_pokemon_id:  string | null
  timer_ends_at:               string | null  // ISO timestamptz
  host_override_active:        boolean
}

export type AuctionPokemonRow = {
  id:                          string
  event_id:                    string
  species_id:                  number
  name_snapshot:               string
  sprite_snapshot:             string | null
  is_mega_capable:             boolean
  nominated_by:                NominationType
  nominated_by_participant_id: string | null
  status:                      AuctionItemStatus
  sold_to:                     string | null
  sold_price:                  number | null
  nominated_at:                string  // ISO timestamptz
}

export type BidRow = {
  id:                 string
  event_id:           string
  auction_pokemon_id: string
  participant_id:     string
  amount:             number
  placed_at:          string  // ISO timestamptz
}

export type TeamPokemonRow = {
  id:                 string
  event_id:           string
  participant_id:     string
  species_id:         number
  name_snapshot:      string
  sprite_snapshot:    string | null
  is_mega_capable:    boolean
  purchase_price:     number
  auction_pokemon_id: string
}

export type SpecialAuctionItemRow = {
  id:          string
  event_id:    string
  coach_id:    string
  description: string | null
  status:      SpecialItemStatus
  won_by:      string | null
  final_price: number
}

export type ParticipantWithTeam = ParticipantRow & {
  team: TeamPokemonRow[]
  coach: CoachRow | null
}

export type AuctionSnapshot = {
  event:       EventRow
  state:       AuctionStateRow
  participants: ParticipantWithTeam[]
  currentPokemon: AuctionPokemonRow | null
  currentBids:    BidRow[]
  turns:          AuctionTurnRow[]
}
