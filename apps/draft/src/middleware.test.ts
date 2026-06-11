import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from './middleware'
import { q } from '@/test/helpers'

// The middleware uses createServerClient from @supabase/ssr directly,
// not our createSupabaseServerClient wrapper.
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}))

import { createServerClient } from '@supabase/ssr'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(path: string) {
  return new NextRequest(`http://localhost${path}`)
}

// Returns a mock Supabase client for middleware (synchronous createServerClient return).
function makeClient(user: { id: string } | null, role?: string) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    // Role lookup: from('users').select('role').eq(...).single()
    from: vi.fn().mockReturnValue(
      q({ data: role ? { role } : null })
    ),
  }
}

// Redirect responses have a Location header; pass-through responses do not.
function locationOf(response: Response) {
  return response.headers.get('location')
}

beforeEach(() => vi.clearAllMocks())

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('middleware', () => {
  describe('/stream', () => {
    it('passes through without touching Supabase', async () => {
      const result = await middleware(req('/stream'))

      expect(createServerClient).not.toHaveBeenCalled()
      expect(locationOf(result)).toBeNull()
    })

    it('passes through for deep paths under /stream', async () => {
      const result = await middleware(req('/stream/overlay'))

      expect(locationOf(result)).toBeNull()
    })
  })

  describe('unauthenticated user', () => {
    beforeEach(() => {
      vi.mocked(createServerClient).mockReturnValue(makeClient(null) as any)
    })

    it('allows /login through', async () => {
      expect(locationOf(await middleware(req('/login')))).toBeNull()
    })

    it('redirects /host to /login', async () => {
      expect(locationOf(await middleware(req('/host')))).toContain('/login')
    })

    it('redirects /auction to /login', async () => {
      expect(locationOf(await middleware(req('/auction')))).toContain('/login')
    })

    it('redirects /mobile to /login', async () => {
      expect(locationOf(await middleware(req('/mobile')))).toContain('/login')
    })

    it('redirects / to /login', async () => {
      expect(locationOf(await middleware(req('/')))).toContain('/login')
    })
  })

  describe('authenticated HOST', () => {
    beforeEach(() => {
      vi.mocked(createServerClient).mockReturnValue(makeClient({ id: 'host-uuid' }, 'HOST') as any)
    })

    it('redirects /login to /host', async () => {
      expect(locationOf(await middleware(req('/login')))).toContain('/host')
    })

    it('allows /host through', async () => {
      expect(locationOf(await middleware(req('/host')))).toBeNull()
    })

    it('allows deep /host paths through', async () => {
      expect(locationOf(await middleware(req('/host/settings')))).toBeNull()
    })

    it('redirects /auction to /login', async () => {
      expect(locationOf(await middleware(req('/auction')))).toContain('/login')
    })

    it('redirects /mobile to /login', async () => {
      expect(locationOf(await middleware(req('/mobile')))).toContain('/login')
    })
  })

  describe('authenticated PARTICIPANT', () => {
    beforeEach(() => {
      vi.mocked(createServerClient).mockReturnValue(
        makeClient({ id: 'participant-uuid' }, 'PARTICIPANT') as any
      )
    })

    it('redirects /login to /auction', async () => {
      expect(locationOf(await middleware(req('/login')))).toContain('/auction')
    })

    it('allows /auction through', async () => {
      expect(locationOf(await middleware(req('/auction')))).toBeNull()
    })

    it('allows /mobile through', async () => {
      expect(locationOf(await middleware(req('/mobile')))).toBeNull()
    })

    it('redirects /host to /login', async () => {
      expect(locationOf(await middleware(req('/host')))).toContain('/login')
    })

    it('redirects / to /login', async () => {
      expect(locationOf(await middleware(req('/')))).toContain('/login')
    })
  })

  describe('authenticated COACH', () => {
    beforeEach(() => {
      vi.mocked(createServerClient).mockReturnValue(
        makeClient({ id: 'coach-uuid' }, 'COACH') as any
      )
    })

    it('redirects /login to /auction', async () => {
      expect(locationOf(await middleware(req('/login')))).toContain('/auction')
    })

    it('allows /auction through', async () => {
      expect(locationOf(await middleware(req('/auction')))).toBeNull()
    })

    it('allows /mobile through', async () => {
      expect(locationOf(await middleware(req('/mobile')))).toBeNull()
    })

    it('redirects /host to /login', async () => {
      expect(locationOf(await middleware(req('/host')))).toContain('/login')
    })
  })
})
