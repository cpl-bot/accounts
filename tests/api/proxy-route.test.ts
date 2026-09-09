import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ORIGINAL_ENV = { ...process.env }

async function loadRoute() {
  // Re-import so module-level env reads (none currently, but future-proof)
  // reflect the env set in each test.
  return await import('@/app/api/talai/[...path]/route')
}

function makeCtx(path: string[]) {
  return { params: Promise.resolve({ path }) }
}

describe('talai proxy route', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    process.env.NEXT_PUBLIC_DEMO_MODE = 'false'
    process.env.MIDDLEWARE_URL = 'http://middleware.local:8000'
    process.env.MIDDLEWARE_API_KEY = 'secret-key'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...ORIGINAL_ENV }
  })

  it('forwards GET requests to the middleware with a bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute()
    const req = new NextRequest('http://localhost/api/talai/health')
    const res = await GET(req, makeCtx(['health']))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://middleware.local:8000/api/v1/health')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'ok' })
  })

  it('returns a 502 ApiError shape when the middleware is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    )

    const { GET } = await loadRoute()
    const req = new NextRequest('http://localhost/api/talai/tally/status')
    const res = await GET(req, makeCtx(['tally', 'status']))

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error.code).toBe('middleware_unreachable')
  })

  it('serves demo fixtures instead of forwarding when NEXT_PUBLIC_DEMO_MODE=true', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await loadRoute()
    const req = new NextRequest('http://localhost/api/talai/tally/status')
    const res = await GET(req, makeCtx(['tally', 'status']))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.connected).toBe('boolean')
  })
})
