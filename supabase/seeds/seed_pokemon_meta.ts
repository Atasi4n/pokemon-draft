/**
 * seed_pokemon_meta.ts
 *
 * Populates the pokemon_meta table with all Pokémon species.
 * Determines is_mega_capable by checking each species' forms
 * for the is_mega flag on the pokemon-form endpoint.
 *
 * Run once (ever). Safe to re-run — uses upsert.
 *
 * Usage:
 *   npx ts-node --project tsconfig.seed.json supabase/seeds/seed_pokemon_meta.ts
 *
 * Prerequisites:
 *   - Migrations must have been applied (pokemon_meta table exists)
 *   - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 *
 * Takes ~3-5 minutes due to PokéAPI rate limiting (100 req/min).
 * Progress is logged to stdout.
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

// ── Config ────────────────────────────────────────────────────────────────────

const POKEAPI_BASE = 'https://pokeapi.co/api/v2'

// PokéAPI has a rate limit of ~100 requests/minute for anonymous clients.
// 700ms between requests keeps us safely under.
const REQUEST_DELAY_MS = 700

// Only seed up to this national dex number.
// Gen 1-9 is 1010. Adjust if a new generation is added.
const MAX_SPECIES_ID = 1010

// ── Supabase admin client ─────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`)
  return res.json()
}

/**
 * Determine if a species is mega-capable by checking all its form variants.
 * PokéAPI's pokemon-form endpoint has an `is_mega` boolean on each form.
 *
 * A species is mega-capable if ANY of its forms has is_mega = true.
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

      if (formData.is_mega === true) {
        return true
      }
    }
  }

  return false
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Starting pokemon_meta seed...')
  console.log(`   Seeding species 1–${MAX_SPECIES_ID}`)
  console.log(`   Request delay: ${REQUEST_DELAY_MS}ms (PokéAPI rate limit)\n`)

  let seeded = 0
  let skipped = 0
  let errors = 0

  for (let speciesId = 1; speciesId <= MAX_SPECIES_ID; speciesId++) {
    try {
      await sleep(REQUEST_DELAY_MS)

      const speciesData = await fetchJson(`${POKEAPI_BASE}/pokemon-species/${speciesId}/`)

      // Get the default variety for name and sprite
      const defaultVariety = speciesData.varieties.find((v: any) => v.is_default)
      if (!defaultVariety) {
        console.warn(`  ⚠  ${speciesId}: no default variety, skipping`)
        skipped++
        continue
      }

      await sleep(REQUEST_DELAY_MS)
      const pokemonData = await fetchJson(defaultVariety.pokemon.url)

      // English name from species names array
      const englishName =
        speciesData.names.find((n: any) => n.language.name === 'en')?.name ??
        speciesData.name

      // Types from default variety
      const types: string[] = pokemonData.types.map(
        (t: any) => t.type.name as string
      )

      // Front default sprite
      const spriteUrl: string | null =
        pokemonData.sprites?.front_default ?? null

      // Check mega capability
      const megaCapable = await isMegaCapable(speciesData)

      // Upsert into pokemon_meta
      const { error } = await supabase
        .from('pokemon_meta')
        .upsert(
          {
            species_id:      speciesId,
            name:            englishName,
            is_mega_capable: megaCapable,
            sprite_url:      spriteUrl,
            types,
          },
          { onConflict: 'species_id' }
        )

      if (error) {
        console.error(`  ✗  ${speciesId} (${englishName}): DB error — ${error.message}`)
        errors++
        continue
      }

      const megaFlag = megaCapable ? ' ★ MEGA' : ''
      console.log(`  ✓  ${String(speciesId).padStart(4, ' ')} ${englishName}${megaFlag}`)
      seeded++

    } catch (err: any) {
      console.error(`  ✗  ${speciesId}: ${err.message}`)
      errors++
      // Continue rather than abort — one bad species shouldn't stop the whole run
    }
  }

  console.log(`\nDone.`)
  console.log(`   Seeded:  ${seeded}`)
  console.log(`   Skipped: ${skipped}`)
  console.log(`   Errors:  ${errors}`)

  if (errors > 0) {
    console.log('\nSome species failed. Re-run the script to retry — upsert is safe.')
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
