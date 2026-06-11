import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * Browser/anon Supabase client factory.
 * Reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from the
 * environment. Never uses the service role key — safe to ship to the browser.
 */
export function createBrowserSupabaseClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
