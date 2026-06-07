import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/types/database.types'
import type { UserRole } from '@/types/auction.types'

// Where each role lands after login
const ROLE_HOME: Record<UserRole, string> = {
  HOST:        '/host',
  PARTICIPANT: '/auction',
  COACH:       '/auction',
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // /stream is public
  if (pathname.startsWith('/stream')) {
    return NextResponse.next({ request })
  }

  // Build a middleware-compatible Supabase client.
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Write refreshed tokens to the request so subsequent reads are consistent
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          // Rebuild the response to carry the Set-Cookie headers to the browser
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    },
  )

  // getUser() verifies the token with the Auth server.
  const { data: { user } } = await supabase.auth.getUser()

  // Unauthenticated
  if (!user) {
    if (pathname === '/login') return response
    return redirectWith(request, response, '/login')
  }

  // Authenticated
  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = userRow?.role as UserRole | undefined

  // /login redirect to the role-appropriate interface
  if (pathname === '/login') {
    const home = role ? ROLE_HOME[role] : '/login'
    return redirectWith(request, response, home)
  }

  // /host/* - HOST only
  if (pathname.startsWith('/host')) {
    if (role !== 'HOST') return redirectWith(request, response, '/login')
    return response
  }

  // /auction/* and /mobile/* - PARTICIPANT or COACH only
  if (pathname.startsWith('/auction') || pathname.startsWith('/mobile')) {
    if (role !== 'PARTICIPANT' && role !== 'COACH') {
      return redirectWith(request, response, '/login')
    }
    return response
  }

  // All other authenticated routes
  return redirectWith(request, response, '/login')
}

// Redirects to `path`, carrying any session-refresh cookies from `sessionResponse`.
function redirectWith(
  request:         NextRequest,
  sessionResponse: NextResponse,
  path:            string,
): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = path
  const redirect = NextResponse.redirect(url)
  // Propagate token-refresh cookies so the browser stays in sync
  sessionResponse.cookies.getAll().forEach(({ name, value }) => {
    redirect.cookies.set(name, value)
  })
  return redirect
}

export const config = {
  matcher: [
    // Apply to all routes except Next.js internals and static files
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
