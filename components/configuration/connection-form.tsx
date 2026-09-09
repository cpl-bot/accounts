'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { apiFetch } from '@/lib/api/client'
import { settingsSchema, tallyCompaniesSchema, tallyStatusSchema, type TallyStatus } from '@/lib/api/schema'
import { useSettings } from '@/lib/api/hooks'

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'done'; result: TallyStatus }
  | { kind: 'error'; message: string }

export function ConnectionForm() {
  const { data: settings, loading, error, refetch } = useSettings()

  const [host, setHost] = useState('')
  const [port, setPort] = useState(9000)
  const [company, setCompany] = useState('')
  const [syncInterval, setSyncInterval] = useState(15)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [companies, setCompanies] = useState<string[]>([])

  useEffect(() => {
    if (!settings) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeding local edit state from a freshly loaded resource, not synchronizing with an external system.
    setHost(settings.tally_host)
    setPort(settings.tally_port)
    setCompany(settings.tally_company_name ?? '')
    setSyncInterval(settings.sync_interval_minutes)
  }, [settings])

  const testConnection = async () => {
    setTest({ kind: 'testing' })
    try {
      const result = await apiFetch('tally/test-connection', tallyStatusSchema, {
        method: 'POST',
        body: JSON.stringify({ host, port }),
      })
      setTest({ kind: 'done', result })
      if (result.company) setCompany(result.company)
      if (result.connected) {
        try {
          const { companies: found } = await apiFetch('tally/companies', tallyCompaniesSchema)
          setCompanies(found.map((c) => c.name))
        } catch {
          setCompanies([])
        }
      }
    } catch (err) {
      setTest({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not test the connection.',
      })
    }
  }

  const save = async () => {
    setSaveState('saving')
    try {
      await apiFetch('settings', settingsSchema, {
        method: 'PUT',
        body: JSON.stringify({
          tally_host: host,
          tally_port: port,
          tally_company_name: company || null,
          sync_interval_minutes: syncInterval,
        }),
      })
      setSaveState('saved')
      refetch()
    } catch {
      setSaveState('error')
    }
  }

  if (loading) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">Loading settings…</p>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="flex flex-col gap-3 p-6">
        <p className="text-sm text-destructive">Could not load settings: {error.message}</p>
        <Button variant="outline" size="sm" className="w-fit" onClick={refetch}>
          Retry
        </Button>
      </Card>
    )
  }

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div>
        <h2 className="text-sm font-semibold">Tally connection</h2>
        <p className="mt-1 text-xs text-muted-foreground text-pretty">
          Talai never talks to Tally directly — the middleware on this LAN does. These settings
          tell the middleware which Tally instance to poll.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Tally host / IP">
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="192.168.1.24"
          />
        </Field>
        <Field label="Port">
          <Input
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            placeholder="9000"
          />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={testConnection}
          disabled={test.kind === 'testing' || !host || !port}
        >
          {test.kind === 'testing' ? <Loader2 className="size-4 animate-spin" /> : null}
          Test connection
        </Button>

        {test.kind === 'done' ? (
          <span
            className={
              'inline-flex items-center gap-1.5 text-sm ' +
              (test.result.connected ? 'text-success' : 'text-destructive')
            }
          >
            {test.result.connected ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <XCircle className="size-4" />
            )}
            {test.result.connected
              ? `Reachable${test.result.latency_ms != null ? ` (${test.result.latency_ms} ms)` : ''}`
              : (test.result.error ?? 'Not reachable')}
          </span>
        ) : null}

        {test.kind === 'error' ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
            <XCircle className="size-4" /> {test.message}
          </span>
        ) : null}
      </div>

      <Field label="Expected company">
        {companies.length > 0 ? (
          <Select value={company} onChange={(e) => setCompany(e.target.value)}>
            <option value="">Select a company</option>
            {companies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Nivana Healthcare Pvt. Ltd."
          />
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">
          Test the connection to pick from companies currently open in Tally.
        </p>
      </Field>

      <Field label="Sync interval">
        <Select
          value={String(syncInterval)}
          onChange={(e) => setSyncInterval(Number(e.target.value))}
        >
          <option value="5">Every 5 minutes</option>
          <option value="15">Every 15 minutes</option>
          <option value="30">Every 30 minutes</option>
          <option value="60">Every hour</option>
        </Select>
      </Field>

      <Field label="Write to Tally">
        <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 text-sm text-muted-foreground">
          {settings?.write_enabled ? 'Enabled' : 'Disabled'}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground text-pretty">
          Controlled by <code className="rounded bg-muted px-1 py-0.5">TALLY_WRITE_ENABLED</code>{' '}
          on the middleware, not from this app — this keeps accidental writes to Tally out of the
          UI&rsquo;s control.
        </p>
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={save} disabled={saveState === 'saving'}>
          {saveState === 'saving' ? <Loader2 className="size-4 animate-spin" /> : null}
          Save
        </Button>
        {saveState === 'saved' ? (
          <span className="text-sm text-success">Saved.</span>
        ) : saveState === 'error' ? (
          <span className="text-sm text-destructive">Could not save settings.</span>
        ) : null}
      </div>
    </Card>
  )
}
