/**
 * seed_pokemon_meta.ts
 *
 * Populates the pokemon_meta table with all Pokémon available in the
 * Champions format, sourced from the PokéAPI champions pokédex.
 * Determines is_mega_capable by checking each species' forms for the
 * is_mega flag on the pokemon-form endpoint.
 *
 * Run once (ever). Safe to re-run — truncates the table first, then upserts.
 *
 * Usage:
 *   npx ts-node --project tsconfig.seed.json supabase/seeds/seed_pokemon_meta.ts
 *
 * Prerequisites:
 *   - Migrations must have been applied (pokemon_meta table exists)
 *   - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 *
 * Takes a few minutes due to PokéAPI rate limiting (100 req/min).
 * Progress is logged to stdout.
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const POKEAPI_BASE = 'https://pokeapi.co/api/v2'

// PokéAPI has a rate limit of ~100 requests/minute for anonymous clients.
// 700ms between requests keeps us safely under.
const REQUEST_DELAY_MS = 100

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`)
  return res.json()
}

/**
 * Fetch the list of species IDs available in the Champions format.
 * entry_number in the champions pokédex is the national dex number (= species_id).
 */
async function fetchChampionsSpeciesIds(): Promise<number[]> {
  const data = await fetchJson(`${POKEAPI_BASE}/pokedex/champions`)
  return data.pokemon_entries.map((e: any) => e.entry_number as number)
}

/**
 * A species is mega-capable if ANY of its form variants has is_mega = true.
 */
async function isMegaCapable(speciesData: any): Promise<boolean> {
  const varieties: Array<{ pokemon: { url: string } }> = speciesData.varieties

  for (const variety of varieties) {
    await sleep(REQUEST_DELAY_MS)

    let pokemonData: any
    try {
      pokemonData = await fetchJson(variety.pokemon.url)
    } catch {
      continue
    }

    const forms: Array<{ url: string }> = pokemonData.forms ?? []

    for (const form of forms) {
      await sleep(REQUEST_DELAY_MS)

      let formData: any
      try {
        formData = await fetchJson(form.url)
      } catch {
        continue
      }

      if (formData.is_mega === true) return true
    }
  }

  return false
}

function getStat(stats: any[], name: string): number | null {
  return stats.find((s: any) => s.stat.name === name)?.base_stat ?? null
}

async function main() {
  console.log('Fetching Champions pokédex...')
  const speciesIds = await fetchChampionsSpeciesIds()
  console.log(`Found ${speciesIds.length} species in Champions format.`)
  console.log(`Request delay: ${REQUEST_DELAY_MS}ms (PokéAPI rate limit)\n`)

  console.log('Clearing pokemon_meta...')
  const { error: deleteError } = await supabase.from('pokemon_meta').delete().gte('species_id', 0)
  if (deleteError) {
    console.error('Failed to clear table:', deleteError.message)
    process.exit(1)
  }
  console.log('Table cleared.\n')

  let seeded = 0
  let skipped = 0
  let errors = 0

  for (const speciesId of speciesIds) {
    try {
      await sleep(REQUEST_DELAY_MS)

      const speciesData = await fetchJson(`${POKEAPI_BASE}/pokemon-species/${speciesId}/`)

      const defaultVariety = speciesData.varieties.find((v: any) => v.is_default)
      if (!defaultVariety) {
        console.warn(`  [SKIP] ${speciesId}: no default variety`)
        skipped++
        continue
      }

      await sleep(REQUEST_DELAY_MS)
      const pokemonData = await fetchJson(defaultVariety.pokemon.url)

      const englishName =
        speciesData.names.find((n: any) => n.language.name === 'en')?.name ??
        speciesData.name

      const types: string[] = pokemonData.types.map((t: any) => t.type.name as string)

      const sprites = pokemonData.sprites
      const spriteFront:    string | null = sprites?.front_default ?? null
      const spriteHome:     string | null = sprites?.other?.home?.front_default ?? null
      const spriteShowdown: string | null = sprites?.other?.showdown?.front_default ?? null

      const stats = pokemonData.stats ?? []

      const megaCapable = await isMegaCapable(speciesData)

      const { error } = await supabase
        .from('pokemon_meta')
        .upsert(
          {
            species_id:      speciesId,
            name:            englishName,
            is_mega_capable: megaCapable,
            sprite_front:    spriteFront,
            sprite_home:     spriteHome,
            sprite_showdown: spriteShowdown,
            types,
            hp:              getStat(stats, 'hp'),
            attack:          getStat(stats, 'attack'),
            defense:         getStat(stats, 'defense'),
            special_attack:  getStat(stats, 'special-attack'),
            special_defense: getStat(stats, 'special-defense'),
            speed:           getStat(stats, 'speed'),
          },
          { onConflict: 'species_id' }
        )

      if (error) {
        console.error(`  [ERR]  ${speciesId} (${englishName}): ${error.message}`)
        errors++
        continue
      }

      const megaFlag = megaCapable ? ' [MEGA]' : ''
      console.log(`  [OK]   ${String(speciesId).padStart(4, ' ')} ${englishName}${megaFlag}`)
      seeded++

    } catch (err: any) {
      console.error(`  [ERR]  ${speciesId}: ${err.message}`)
      errors++
    }
  }

  console.log(`\nDone.`)
  console.log(`  Seeded:  ${seeded}`)
  console.log(`  Skipped: ${skipped}`)
  console.log(`  Errors:  ${errors}`)

  if (errors > 0) {
    console.log('\nSome species failed. Re-run to retry — upsert is safe.')
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
