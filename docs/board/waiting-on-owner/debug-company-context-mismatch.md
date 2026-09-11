---
id: debug-company-context-mismatch
owner: owner
type: decision
created: 2026-09-10
size: XS
lane: frontend-company-context
tags: [discussion]
---
# Resolve the Nivana and Vigyapan company-label mismatch

The live dashboard shell identifies `Nivana Healthcare Pvt. Ltd.` while the Tally connection identifies `Vigyapan Mart Pvt.Ltd. - (from 1-Apr-23)`. This does not cause the zero aggregates, but it makes reconciliation and company ownership ambiguous.

Unblock: state whether these labels intentionally represent different concepts; if not, name the single company label the application should display.

Acceptance: the intended relationship and authoritative display label are recorded, making a cold-start implementation card possible without guessing.

Owns: the product decision only.

Do not own: frontend or middleware code, tenant migrations, production data, live agent pushes, the main checkout from an executor lane, or destructive operations.

Out of scope: implementing the selected label or adding multi-company support.

Depends on: none.

## product decision from owner
`Nivana Healthcare Pvt. Ltd.` was just a placeholder example.
Pick the company name from Tally and use the value in the section
