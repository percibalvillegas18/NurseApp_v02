# Leave Management

Scheduling → Leave Management (`LEAVE_MANAGEMENT`). UI + mock API are live;
the Nest module + migration are still TODO (tracked below).

## Lifecycle

```
Draft → Submitted → Approved
               ↘ Rejected
Draft / Submitted / Approved → Cancelled
```

## Rules (enforced by `mock-workforce-routes.js`, mirror in Nest)

- **Overlap (409):** a nurse can't have two non-terminal requests covering the
  same date. Terminal = Rejected, Cancelled.
- **Balance (409, paid types):** `days ≤ entitled − used(Approved) − pending(Submitted)`.
  Balances are *derived* from requests, never stored — they can't drift.
- **Unpaid leave** has no cap (`remaining: null`) but still needs approval.
- **Roster interplay:** creating a request returns `warnings[]` for every
  non-cancelled roster assignment inside the period (needs cover); it does
  NOT block creation. Detail drawer shows the same clashes.
- **Reject requires a note** (400 otherwise); approve re-validates overlap +
  balance at decision time. `decidedBy` comes from the caller's JWT.

## Endpoints (mock `/api/v1/leave/*`, Bearer required)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/leave/types` | 8 types: ANNUAL 30, SICK 30, EMERGENCY 5, MATERNITY 70, PATERNITY 3, HAJJ 10, STUDY 10, UNPAID uncapped |
| GET | `/leave/balances?nurseId=` | Derived per-nurse × type balances |
| GET | `/leave/requests?nurseId=&status=&type=&from=&to=&page=&limit=` | Paginated, newest first |
| GET | `/leave/requests/:id` | Includes `rosterClashes[]` |
| POST | `/leave/requests` | Creates Draft; 404 nurse, 409 overlap/balance |
| PATCH | `/leave/requests/:id` | Draft only |
| POST | `/leave/requests/:id/submit` | Draft → Submitted |
| POST | `/leave/requests/:id/approve` | Submitted → Approved (+ re-validation) |
| POST | `/leave/requests/:id/reject` | Submitted → Rejected, `{note}` required |
| POST | `/leave/requests/:id/cancel` | → Cancelled (frees balance automatically) |

## Frontend (`frontend/src/pages/Leave.tsx`)

Stats (pending / on-leave-today), Requests tab (filters, lifecycle actions
gated by CREATE/EDIT/APPROVE), Balances tab (per-nurse bars, ≤20% flagged),
create/edit modal, action modal with note, detail drawer with roster clashes.

## Nest TODO (when graduating from mock)

1. Migration `V5_0__leave_management.sql`: `leave_types` (seed 8),
   `leave_requests` (+ exclusion constraint on overlapping daterange per nurse
   for non-terminal statuses — the DB twin of the 409), decision audit columns.
2. `LeaveModule` mirroring the endpoint table above (guards:
   `LEAVE_MANAGEMENT` VIEW/CREATE/EDIT/APPROVE).
3. Balance = view over requests (same derivation).
4. Optional: block roster assignment over Approved leave (sibling of
   `ROSTER_CONTRACT_GUARD.md`).
