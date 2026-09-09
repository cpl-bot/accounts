// Synthesises representative JSON examples from docs/openapi.json component
// schemas, so tests/lib/contract.test.ts can check "does the middleware's
// declared shape actually satisfy the frontend's zod schema" without hand
// -typing fixtures (which is exactly how the schemas drifted in the first
// place — see commit 543f1d3).
//
// Only the subset of JSON Schema the middleware's FastAPI/pydantic export
// actually uses is handled: $ref, anyOf (mostly null-unions), enum, array,
// object/properties/required, and the primitive types. There is no `allOf`
// anywhere in docs/openapi.json (checked at the time this was written), so
// it is deliberately not implemented — this file should fail loudly (via
// `assertSupported`) rather than silently mis-render a schema addition uses.

import fs from 'node:fs'
import path from 'node:path'

export type JsonSchema = Record<string, unknown>

export interface OpenApiSpec {
  components: { schemas: Record<string, JsonSchema> }
}

let cachedSpec: OpenApiSpec | null = null

export function loadOpenApiSpec(): OpenApiSpec {
  if (cachedSpec) return cachedSpec
  const file = path.join(process.cwd(), 'docs', 'openapi.json')
  cachedSpec = JSON.parse(fs.readFileSync(file, 'utf-8')) as OpenApiSpec
  return cachedSpec
}

function refName(ref: string): string {
  const m = /^#\/components\/schemas\/(.+)$/.exec(ref)
  if (!m) throw new Error(`Unsupported $ref: ${ref}`)
  return m[1]
}

export function resolveComponent(spec: OpenApiSpec, name: string): JsonSchema {
  const schema = spec.components.schemas[name]
  if (!schema) throw new Error(`No component schema named "${name}" in docs/openapi.json`)
  return schema
}

function resolveRef(spec: OpenApiSpec, schema: JsonSchema): JsonSchema {
  if (typeof schema.$ref === 'string') {
    return resolveRef(spec, resolveComponent(spec, refName(schema.$ref)))
  }
  return schema
}

// The middleware's Decimal-backed fields are emitted either as a bare
// `{"type": "string", "pattern": "^(?!^[-+.]*$)..."}` (response models) or
// as `anyOf: [{"type": "number"}, {"type": "string", "pattern": "..."}]`
// (request models, which accept either on the wire in). Either way the
// signature is this pattern's prefix.
const DECIMAL_PATTERN_SIGNATURE = '[-+.]*$'

function isDecimalStringNode(node: JsonSchema): boolean {
  return (
    node.type === 'string' &&
    typeof node.pattern === 'string' &&
    node.pattern.includes(DECIMAL_PATTERN_SIGNATURE)
  )
}

function anyOfBranches(spec: OpenApiSpec, schema: JsonSchema): JsonSchema[] {
  const anyOf = schema.anyOf as JsonSchema[]
  return anyOf.map((b) => resolveRef(spec, b))
}

function isNullableUnion(spec: OpenApiSpec, schema: JsonSchema): boolean {
  if (!Array.isArray(schema.anyOf)) return false
  return anyOfBranches(spec, schema).some((b) => b.type === 'null')
}

function nonNullBranch(spec: OpenApiSpec, schema: JsonSchema): JsonSchema {
  const branches = anyOfBranches(spec, schema).filter((b) => b.type !== 'null')
  if (branches.length === 0) throw new Error('anyOf union has no non-null branch')
  // Prefer the decimal-string branch when present (that's what's actually on
  // the wire), otherwise take the first non-null branch.
  return branches.find(isDecimalStringNode) ?? branches[0]
}

let counter = 0
function nextCounter() {
  counter += 1
  return counter
}

interface GenOpts {
  // When set, and this node is the schema for a property named `status`
  // (top-level "enum sweep" support), returns this exact enum value instead
  // of the default enum[0].
  enumOverride?: string
}

// Produces one concrete, "maximal" value for a resolved (non-$ref) node:
// every object property present, decimals as numeric strings, dates/date
// -times as ISO strings, arrays with one element, enums at their first
// value (or `opts.enumOverride`).
export function generateValue(spec: OpenApiSpec, rawSchema: JsonSchema, opts: GenOpts = {}): unknown {
  const schema = resolveRef(spec, rawSchema)

  if (Array.isArray(schema.enum)) {
    const values = schema.enum as string[]
    return opts.enumOverride ?? values[0]
  }

  if (Array.isArray(schema.anyOf)) {
    if (isDecimalStringNode(nonNullBranch(spec, schema)) || anyOfBranches(spec, schema).some(isDecimalStringNode)) {
      return decimalExample()
    }
    return generateValue(spec, nonNullBranch(spec, schema), opts)
  }

  if (isDecimalStringNode(schema)) {
    return decimalExample()
  }

  const type = schema.type as string | undefined

  if (type === 'object' || schema.properties) {
    return generateObject(spec, schema)
  }

  if (type === 'array') {
    const items = (schema.items as JsonSchema) ?? {}
    return [generateValue(spec, items)]
  }

  if (type === 'string') {
    if (schema.format === 'date') return '2026-05-12'
    if (schema.format === 'date-time') return '2026-05-12T10:30:00Z'
    return exampleString(schema.title as string | undefined)
  }

  if (type === 'integer') return 42

  if (type === 'number') return 3.5

  if (type === 'boolean') return true

  if (type === 'null') return null

  if (schema.additionalProperties) {
    return { example_key: generateValue(spec, schema.additionalProperties as JsonSchema) }
  }

  throw new Error(`Unsupported schema node, cannot synthesize a value: ${JSON.stringify(schema)}`)
}

function decimalExample(): string {
  return '86000.00'
}

function exampleString(title?: string): string {
  const n = nextCounter()
  return title ? `${title.replace(/\s+/g, '-')}-${n}` : `example-${n}`
}

function generateObject(spec: OpenApiSpec, schema: JsonSchema): Record<string, unknown> {
  const properties = (schema.properties as Record<string, JsonSchema>) ?? {}
  const out: Record<string, unknown> = {}
  for (const [key, propSchema] of Object.entries(properties)) {
    out[key] = generateValue(spec, propSchema)
  }
  return out
}

export interface Variant {
  label: string
  value: unknown
}

export interface SynthResult {
  /** The "everything present, everything valid" example. */
  full: Record<string, unknown>
  /**
   * Additional examples derived from `full`: one per optional/nullable
   * top-level property with that property nulled-out or omitted, and (for a
   * top-level `status`-shaped enum property) one per enum member.
   */
  variants: Variant[]
}

function isRequired(schema: JsonSchema, key: string): boolean {
  const required = (schema.required as string[]) ?? []
  return required.includes(key)
}

// True if the property's own schema allows an explicit `null` (an
// `anyOf: [..., {type: null}]` union) as opposed to merely being absent.
function propertyIsNullable(spec: OpenApiSpec, propSchema: JsonSchema): boolean {
  return isNullableUnion(spec, propSchema)
}

/**
 * Synthesizes a representative example for the named component schema, plus
 * a set of variants exercising every optional/nullable top-level property
 * both ways (present and null/omitted) and every enum value of any
 * top-level property literally named `status`.
 */
export function synthesizeExamples(spec: OpenApiSpec, componentName: string): SynthResult {
  const resolved = resolveRef(spec, { $ref: `#/components/schemas/${componentName}` })
  const full = generateValue(spec, resolved) as Record<string, unknown>

  const properties = (resolved.properties as Record<string, JsonSchema>) ?? {}
  const variants: Variant[] = []

  for (const [key, propSchema] of Object.entries(properties)) {
    const required = isRequired(resolved, key)
    const resolvedProp = resolveRef(spec, propSchema)
    const nullable = propertyIsNullable(spec, resolvedProp)

    // Only the "null" half of "null/omitted" is exercised here, not
    // outright omission. A pydantic response model always serializes every
    // field it declares (an `Optional[X] = None` field is emitted as
    // `"field": null`, not dropped) — FastAPI does not elide defaulted
    // fields from `response_model` output. So a variant that deletes an
    // optional-but-non-nullable key would only ever catch an unrealistic
    // shape, not a real wire disagreement; it produced nothing but false
    // positives here (e.g. DraftOut.payload, OcrResult.fields) and was
    // removed. Omission *is* meaningful on the request side (a form the
    // frontend didn't fill in truly omits the key) — that direction is
    // covered separately, by the requiredness check in the request-contract
    // test group below, not by this generator.
    if (nullable) {
      variants.push({
        label: `${componentName}.${key} = null`,
        value: { ...full, [key]: null },
      })
    }

    if (key === 'status' && Array.isArray(resolvedProp.enum)) {
      for (const value of resolvedProp.enum as string[]) {
        variants.push({
          label: `${componentName}.status = ${value}`,
          value: { ...full, status: value },
        })
      }
    }
  }

  return { full, variants }
}
