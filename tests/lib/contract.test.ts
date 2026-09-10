// Guards against the exact class of bug fixed by commit 543f1d3: the
// middleware's OpenAPI spec (docs/openapi.json, generated from its pydantic
// models — see middleware/scripts/export_openapi.py) and the frontend's zod
// schemas (lib/api/schema.ts) describe the same wire contract by hand, with
// nothing tying them together. This synthesizes representative examples
// straight from docs/openapi.json (tests/lib/openapi-example.ts) and checks
// every one still parses through the matching zod schema — so a renamed or
// retyped field on either side fails a test instead of shipping silently.
//
// A failure here means one of two things:
//  1. lib/api/schema.ts has drifted from docs/openapi.json — fix the zod
//     schema (this test's job is to catch that, not to be relaxed).
//  2. docs/openapi.json is stale relative to the middleware's actual models
//     — regenerate it (middleware/scripts/export_openapi.py).
// Never "fix" a red test here by loosening the generator to dodge a real
// disagreement; report it instead.

import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import {
  demoAttachments,
  demoDashboardOverview,
  demoDrafts,
  demoPushResult,
  demoSettings,
  demoSyncRunList,
  demoSyncStatus,
  demoTallyStatus,
} from '@/lib/api/demo-fixtures'
import {
  agingBucketSchema,
  attachmentSchema,
  attachmentsListSchema,
  billSchema,
  billsResponseSchema,
  dashboardFormulaSchema,
  dashboardOverviewSchema,
  dashboardPayablesSchema,
  draftItemSchema,
  draftLedgerLineSchema,
  draftPartySchema,
  draftPurchaseBillSchema,
  draftSchema,
  draftTotalsSchema,
  ledgerLookupResultSchema,
  ledgerSchema,
  listLedgersSchema,
  ocrResultSchema,
  pullRequestSchema,
  pushResultItemSchema,
  pushResultSchema,
  settingsSchema,
  syncRunListSchema,
  syncRunSchema,
  syncScopeStatusSchema,
  syncStatusSchema,
  tallyCompaniesSchema,
  tallyStatusSchema,
  validationIssueSchema,
  vendorLedgerCreateResultSchema,
  vendorLedgerCreateSchema,
  voucherSchema,
  voucherSummarySchema,
} from '@/lib/api/schema'
import { loadOpenApiSpec, synthesizeExamples, type SynthResult } from './openapi-example'

const spec = loadOpenApiSpec()

// -- helpers ------------------------------------------------------------

function describeIssues(result: z.ZodSafeParseResult<unknown>, value: unknown): string {
  if (result.success) return ''
  return JSON.stringify(
    {
      value,
      issues: result.error.issues.map((i) => ({ path: i.path, code: i.code, message: i.message })),
    },
    null,
    2,
  )
}

function expectAllVariantsParse(schema: z.ZodTypeAny, synth: SynthResult, label: string) {
  const full = schema.safeParse(synth.full)
  expect(full.success, `${label} full example failed:\n${describeIssues(full, synth.full)}`).toBe(true)

  for (const variant of synth.variants) {
    const result = schema.safeParse(variant.value)
    expect(
      result.success,
      `${label} variant "${variant.label}" failed:\n${describeIssues(result, variant.value)}`,
    ).toBe(true)
  }
}

// -- response contract: docs/openapi.json component -> zod schema -------

describe('response contract: openapi component -> zod schema', () => {
  const cases: Array<[string, z.ZodTypeAny]> = [
    ['TallyStatus', tallyStatusSchema],
    ['CompanyList', tallyCompaniesSchema],
    ['SettingsPayload', settingsSchema],
    ['DashboardFormulaOut', dashboardFormulaSchema],
    ['LedgerOut', ledgerSchema],
    ['LedgerList', listLedgersSchema],
    ['LedgerLookupResponse', ledgerLookupResultSchema],
    ['VendorLedgerCreated', vendorLedgerCreateResultSchema],
    ['VoucherSummary', voucherSummarySchema],
    ['VoucherDetail', voucherSchema],
    ['BillList', billsResponseSchema],
    ['BillOut', billSchema],
    ['AgingBucket', agingBucketSchema],
    ['DashboardOverview', dashboardOverviewSchema],
    ['DashboardPayables', dashboardPayablesSchema],
    ['DraftOut', draftSchema],
    ['DraftList', z.object({ items: z.array(draftSchema), total: z.number() })],
    ['ValidationIssue', validationIssueSchema],
    ['SyncRunOut', syncRunSchema],
    ['SyncRunList', syncRunListSchema],
    ['SyncScopeStatus', syncScopeStatusSchema],
    ['SyncStatusOut', syncStatusSchema],
    ['PushResultItem', pushResultItemSchema],
    ['PushResponse', pushResultSchema],
    ['AttachmentOut', attachmentSchema],
    ['AttachmentList', attachmentsListSchema],
    ['OcrResult', ocrResultSchema],
  ]

  it.each(cases)('%s example (and its optional/nullable/enum variants) satisfies the zod schema', (name, schema) => {
    const synth = synthesizeExamples(spec, name)
    expectAllVariantsParse(schema, synth, name)
  })
})

// -- request contract: zod request schema -> docs/openapi.json component -

// zod v4's built-in JSON Schema exporter — used to introspect the request
// schemas' shape (keys + required-ness) without hand-maintaining a second
// description of them here.
function shapeKeys(schema: z.ZodObject<z.ZodRawShape>): string[] {
  return Object.keys(schema.shape)
}

function requiredKeys(schema: z.ZodObject<z.ZodRawShape>): string[] {
  const jsonSchema = z.toJSONSchema(schema) as { required?: string[] }
  return jsonSchema.required ?? []
}

interface RequestCase {
  zodName: string
  zodSchema: z.ZodObject<z.ZodRawShape>
  componentName: string
}

describe('request contract: zod request schema -> openapi component', () => {
  const cases: RequestCase[] = [
    { zodName: 'vendorLedgerCreateSchema', zodSchema: vendorLedgerCreateSchema, componentName: 'VendorLedgerCreate' },
    {
      zodName: 'draftPurchaseBillSchema',
      zodSchema: draftPurchaseBillSchema,
      componentName: 'DraftPurchaseBill-Input',
    },
    { zodName: 'draftPartySchema', zodSchema: draftPartySchema, componentName: 'PartyPayload' },
    { zodName: 'draftItemSchema', zodSchema: draftItemSchema, componentName: 'ItemPayload-Input' },
    { zodName: 'draftLedgerLineSchema', zodSchema: draftLedgerLineSchema, componentName: 'LedgerLinePayload-Input' },
    { zodName: 'draftTotalsSchema', zodSchema: draftTotalsSchema, componentName: 'TotalsPayload-Input' },
    { zodName: 'pullRequestSchema', zodSchema: pullRequestSchema, componentName: 'PullRequest' },
  ]

  it.each(cases)(
    '$zodName: every key it can emit exists on $componentName, and every $componentName-required key is required',
    ({ zodSchema, componentName }) => {
      const component = spec.components.schemas[componentName]
      expect(component, `No component "${componentName}" in docs/openapi.json`).toBeTruthy()
      const componentProps = Object.keys((component.properties as Record<string, unknown>) ?? {})
      const componentRequired = (component.required as string[]) ?? []

      // Every key the frontend can put on the wire must be a real pydantic
      // field — pydantic silently drops unknown keys, which is exactly how
      // the vendor billing address went missing before.
      const zodKeys = shapeKeys(zodSchema)
      const unknownKeys = zodKeys.filter((k) => !componentProps.includes(k))
      expect(unknownKeys, `keys the frontend sends but ${componentName} does not declare: ${unknownKeys.join(', ')}`).toEqual([])

      // Every field the backend requires must not be optional on the
      // frontend side, or the backend 422s on a form the frontend thought
      // was complete.
      const zodRequired = new Set(requiredKeys(zodSchema))
      const missingRequired = componentRequired.filter((k) => !zodRequired.has(k))
      expect(
        missingRequired,
        `${componentName} requires these keys but the zod schema does not: ${missingRequired.join(', ')}`,
      ).toEqual([])
    },
  )
})

// -- demo fixtures (the demo-mode "backend") must satisfy the same contract

describe('demo fixtures satisfy the same zod schemas as the real middleware', () => {
  it('demoTallyStatus -> tallyStatusSchema', () => {
    const result = tallyStatusSchema.safeParse(demoTallyStatus())
    expect(result.success, describeIssues(result, demoTallyStatus())).toBe(true)
  })

  it('demoSettings -> settingsSchema', () => {
    const result = settingsSchema.safeParse(demoSettings())
    expect(result.success, describeIssues(result, demoSettings())).toBe(true)
  })

  it('demoDrafts -> { items: draftSchema[], total }', () => {
    const drafts = demoDrafts()
    const result = z.object({ items: z.array(draftSchema), total: z.number() }).safeParse(drafts)
    expect(result.success, describeIssues(result, drafts)).toBe(true)
  })

  it('demoAttachments -> attachmentSchema[]', () => {
    const attachments = demoAttachments()
    const result = z.array(attachmentSchema).safeParse(attachments)
    expect(result.success, describeIssues(result, attachments)).toBe(true)
  })

  it('demoPushResult -> pushResultSchema', () => {
    const push = demoPushResult(['draft-1', 'draft-2'])
    const result = pushResultSchema.safeParse(push)
    expect(result.success, describeIssues(result, push)).toBe(true)
  })

  it('demoDashboardOverview -> dashboardOverviewSchema', () => {
    const overview = demoDashboardOverview()
    const result = dashboardOverviewSchema.safeParse(overview)
    expect(result.success, describeIssues(result, overview)).toBe(true)
  })

  it('demoSyncRunList -> syncRunListSchema', () => {
    const runs = demoSyncRunList()
    const result = syncRunListSchema.safeParse(runs)
    expect(result.success, describeIssues(result, runs)).toBe(true)
  })

  it('demoSyncStatus -> syncStatusSchema', () => {
    const status = demoSyncStatus()
    const result = syncStatusSchema.safeParse(status)
    expect(result.success, describeIssues(result, status)).toBe(true)
  })
})
