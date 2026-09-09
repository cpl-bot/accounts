import { NextRequest, NextResponse } from 'next/server'
import {
  demoAttachments,
  demoBills,
  demoDashboardOverview,
  demoDashboardPayables,
  demoDrafts,
  demoSettings,
  demoSyncRun,
  demoTallyStatus,
} from '@/lib/api/demo-fixtures'

export const dynamic = 'force-dynamic'

function isDemoMode() {
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status })
}

function demoResponse(path: string, method: string): NextResponse | null {
  const segments = path.split('/').filter(Boolean)

  if (method === 'GET' && path === 'tally/status') return NextResponse.json(demoTallyStatus())
  if (method === 'POST' && path === 'tally/test-connection')
    return NextResponse.json(demoTallyStatus())
  if (method === 'GET' && path === 'tally/companies')
    return NextResponse.json({ companies: [{ name: demoTallyStatus().company ?? 'Demo Co' }] })
  if (path === 'settings') return NextResponse.json(demoSettings())
  if (method === 'GET' && path === 'dashboard/overview')
    return NextResponse.json(demoDashboardOverview())
  if (method === 'GET' && path === 'dashboard/payables')
    return NextResponse.json(demoDashboardPayables())
  if (method === 'GET' && path === 'bills') return NextResponse.json(demoBills())
  if (method === 'GET' && path === 'drafts') return NextResponse.json(demoDrafts())
  if (method === 'POST' && segments[0] === 'drafts' && segments[2] === 'queue') {
    return NextResponse.json({
      id: segments[1],
      status: 'queued',
      payload: {},
      validation_issues: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }
  if (method === 'POST' && path === 'sync/push') {
    return NextResponse.json({ run: demoSyncRun(true), results: [] })
  }
  if (method === 'POST' && path === 'attachments') {
    const list = demoAttachments()
    return NextResponse.json(list[0] ?? null)
  }

  return null
}

async function forward(req: NextRequest, path: string) {
  if (isDemoMode()) {
    const demo = demoResponse(path, req.method)
    if (demo) return demo
    // Fall through to a generic "not implemented in demo mode" 200 for
    // anything not explicitly modelled above, so the UI can still render.
    return NextResponse.json({ items: [], total: 0 })
  }

  const base = process.env.MIDDLEWARE_URL ?? 'http://localhost:8000'
  const key = process.env.MIDDLEWARE_API_KEY ?? ''
  const url = new URL(`${base.replace(/\/$/, '')}/api/v1/${path}`)
  req.nextUrl.searchParams.forEach((value, name) => url.searchParams.set(name, value))

  const contentType = req.headers.get('content-type') ?? undefined
  const init: RequestInit = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(contentType ? { 'content-type': contentType } : {}),
    },
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer()
  }

  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    return errorResponse(
      502,
      'middleware_unreachable',
      'Could not reach the Talai middleware. Confirm it is running and MIDDLEWARE_URL is correct.',
    )
  }

  const body = await res.arrayBuffer()
  return new NextResponse(body, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/json',
    },
  })
}

function joinPath(segments: string[]) {
  return segments.join('/')
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  return forward(req, joinPath(path))
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  return forward(req, joinPath(path))
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  return forward(req, joinPath(path))
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  return forward(req, joinPath(path))
}
