---
id: fix-the-name-of-the-company-as-per-tally
owner: owner
type: bug
created: 2026-09-11
---
# Fix the name of the company as per Tally

show the correct name of the selected company instead of demo data in the nextjs application

![shot](docs/board-assets/20260911-140156-a47f.png) ![shot](docs/board-assets/20260911-140156-b752.png)

## Needs owner decision

The display-label decision is settled: use the selected Tally company, not the
Nivana placeholder. Choose the source and fallback behavior: live
`/tally/status` immediately, or replica-persisted company data after
`co-company-info-sync`; name the exact UI locations that must change.
