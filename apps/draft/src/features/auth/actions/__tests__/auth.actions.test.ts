import { describe, it, expect, vi } from 'vitest'
import { loginAction, logoutAction } from '../auth.actions'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase/server'

function makeAuthClient(opts: {
  signInError?: unknown
  signOutError?: unknown
} = {}) {
  return {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ error: opts.signInError ?? null }),
      signOut:            vi.fn().mockResolvedValue({ error: opts.signOutError ?? null }),
    },
  }
}

describe('loginAction', () => {
  it('returns success when credentials are valid', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(makeAuthClient() as any)

    const result = await loginAction('alice', 'password123')

    expect(result).toEqual({ success: true })
  })

  it('calls signInWithPassword using the paralimpico.local email format', async () => {
    const client = makeAuthClient()
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as any)

    await loginAction('alice', 'password123')

    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email:    'alice@paralimpico.local',
      password: 'password123',
    })
  })

  it('returns a generic error on auth failure without exposing details', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      makeAuthClient({ signInError: { message: 'Invalid login credentials' } }) as any
    )

    const result = await loginAction('alice', 'wrong')

    expect(result).toEqual({ success: false, error: 'Invalid username or password.' })
    expect((result as any).error).not.toContain('credentials') // internal detail not leaked
  })
})

describe('logoutAction', () => {
  it('returns success when sign-out succeeds', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(makeAuthClient() as any)

    const result = await logoutAction()

    expect(result).toEqual({ success: true })
  })

  it('returns error when sign-out fails', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      makeAuthClient({ signOutError: { message: 'Session not found' } }) as any
    )

    const result = await logoutAction()

    expect(result).toEqual({ success: false, error: 'Failed to sign out.' })
  })
})
