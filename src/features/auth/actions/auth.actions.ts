'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'

type AuthResult =
  | { success: true }
  | { success: false; error: string }

// Converts a bare username to the internal email format used by Supabase Auth.
// All accounts were seeded with `username@paralimpico.local` (see seed_event.ts).
function toEmail(username: string) {
  return `${username}@paralimpico.local`
}

export async function loginAction(
  username: string,
  password: string,
): Promise<AuthResult> {
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.auth.signInWithPassword({
    email:    toEmail(username),
    password,
  })

  if (error) {
    return { success: false, error: 'Invalid username or password.' }
  }

  return { success: true }
}

export async function logoutAction(): Promise<AuthResult> {
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.auth.signOut()

  if (error) {
    return { success: false, error: 'Failed to sign out.' }
  }

  return { success: true }
}
