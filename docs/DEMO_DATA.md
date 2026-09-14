# TEMP Demo Dataset

Preview-only seed (`backend/mock-demo-seed.js`, auto-loaded on mock startup)
so every page has something to show. **Everything is flagged `isDemo: true`**
and removable in one call — no demo row can leak into real data, because the
mock is in-memory and the real backend never reads this file.

## What's seeded (10 / 9 / 48 / 9 / 9)

| Group | Rows | Detail |
|-------|------|--------|
| Users | 10 | `demo.*` logins, one per role incl. READONLY_USER (`demo.viewer`). Password: `Password123!` |
| Nurses | 9 | One per position: HN, AHN, CI, SN, PCT, TEC, CN, HCA, MW. IDs `DEMO-EMP-##` / `DEMO-JOB-##`. SN→`demo.rn`, PCT→`demo.cna`, CN→`demo.charge`, HCA→`demo.lpn` |
| Credentials | 48 | Per nurse: PASSPORT + IQAMA (non-Saudi only) + HOSPITAL_ID + SCFHS + BLS + position extras. Built-in variety: TEC's BLS expires in 12d, MW holds an Expired PALS, HCA's SCFHS is PendingVerification |
| Contracts | 9 | One Active per demo nurse, MOH/SOP/HCC/HHC mix (`DEMO-CTR-##`) — demo nurses roster cleanly |
| Roster | 9 | One assignment per demo nurse across ICU_A / ICU_B / ER_TRIAGE |

## Endpoints (open dev endpoints under `/mock/*`)

| Method | Path | Effect |
|--------|------|--------|
| GET | `/api/v1/mock/demo` | `{ seeded, users, nurses, credentials, contracts, rosterAssignments }` (also inside `/mock/state`) |
| POST | `/api/v1/mock/demo/seed` | Seed now — idempotent, skips existing rows per-record |
| DELETE | `/api/v1/mock/demo` | Remove EVERY demo row: users (+ their tokens + login attempts), nurses, credentials (+ uploaded docs), contracts, plus any roster/leave rows created against demo nurses |

Restarting the mock also resets to pristine + freshly seeded demo data.

## UI markers

`isDemo` is exposed on users, nurses, credentials and contracts; the Users,
Nurse Master and Contract pages render an orange **TEMP** tag on demo rows.

## Conventions for adding more demo rows

- IDs: always `max(id) + 1` at insert time; the loader reserves
  `nextNurseId / nextCredentialId / nextRosterId` past seeded rows, and
  contracts use `app.locals.bumpContractSeq()` — new POSTs can never collide.
- Names/numbers: prefix `DEMO-` (`DEMO-P-0001`, `DEMO-CTR-01`, …).
- Dates: relative (`isoDay(offset)`) so alerts never go stale.
- Arrays: splice in place, never reassign — other modules hold references.
