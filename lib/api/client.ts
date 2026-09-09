// Typed fetch wrapper for the Talai middleware.
//
// Browser callers always go through the same-origin Next.js proxy
// (`/api/talai/*`, see app/api/talai/[...path]/route.ts) so the bearer token
// never reaches client JS. Server components/route handlers may talk to the
// middleware directly using MIDDLEWARE_URL + MIDDLEWARE_API_KEY.

import type { z } from 'zod'

export class ApiError extends Error {
  code: string
  status: number

  constructor({ code, message, status }: { code: string; message: string; status: number }) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

function browserBaseUrl() {
  return '/api/talai'
}

function serverBaseUrl() {
  const base = process.env.MIDDLEWARE_URL ?? 'http://localhost:8000'
  return `${base.replace(/\/$/, '')}/api/v1`
}

function resolveUrl(path: string) {
  const cleanPath = path.replace(/^\//, '')
  const base = typeof window === 'undefined' ? serverBaseUrl() : browserBaseUrl()
  return `${base}/${cleanPath}`
}

function serverHeaders(): HeadersInit {
  if (typeof window !== 'undefined') return {}
  const key = process.env.MIDDLEWARE_API_KEY
  return key ? { Authorization: `Bearer ${key}` } : {}
}

async function parseErrorBody(res: Response): Promise<{ code: string; message: string }> {
  try {
    const body = await res.json()
    if (body?.error?.message) {
      return { code: body.error.code ?? 'unknown_error', message: body.error.message }
    }
  } catch {
    // fall through to a generic message below
  }
  return { code: 'http_error', message: `Request failed with status ${res.status}` }
}

/**
 * Fetch `path` from the middleware (via the proxy on the client, or directly
 * on the server) and parse the JSON body with `schema`. Throws `ApiError` on
 * a non-2xx response or a schema mismatch.
 */
export async function apiFetch<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S>> {
  const url = resolveUrl(path)
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...serverHeaders(),
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiError({
      code: 'network_error',
      message: 'Could not reach the Talai middleware. Check your connection and try again.',
      status: 0,
    })
  }

  if (!res.ok) {
    const { code, message } = await parseErrorBody(res)
    throw new ApiError({ code, message, status: res.status })
  }

  const json = await res.json()
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    throw new ApiError({
      code: 'invalid_response',
      message: `Response from ${path} did not match the expected shape.`,
      status: res.status,
    })
  }
  return parsed.data
}

export function apiPath(path: string, params?: Record<string, string | number | boolean | undefined>) {
  if (!params) return path
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `${path}?${qs}` : path
}
