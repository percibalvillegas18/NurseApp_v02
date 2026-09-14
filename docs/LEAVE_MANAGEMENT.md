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
- **Reject requires a note** (400 otherwise); submit AND approve re-validate
  overlap + balance (submit used to skip this — fixed 2026-09-14, see audit
  section below). `decidedBy` comes from the caller's JWT.

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

## Balance-engine audit (2026-09-14, for the Laravel/PostgreSQL port)

Live-tested against the mock (`:4000`) plus a real-PostgreSQL replay of the
V1–V4 chain. Result: **2 balance bugs found and fixed in the mock**; the SQL
side (contracts/audit) is fully green; the list below is what Laravel must add.

### Fixed in `mock-workforce-routes.js` (verified live)

1. **Submit skipped all validation (HIGH).** Drafts hold dates but not balance,
   yet `Draft → Submitted` never re-checked overlap or balance — any number of
   drafts could be submitted past entitlement.
2. **Approve balance check was dead code (HIGH).** `r.days > remaining + r.days`
   can never be true because `remaining` is clamped at 0. Live demo before the
   fix: two 20-day requests approved against 30 entitled → `used: 40`,
   `remaining: 0` (overdraft masked by the clamp).
3. **Fix:** submit now enforces the create-time rule (`days ≤ remaining`);
   approve rejects when `used + pending > entitled` (unclamped — the only
   correct comparison once the request sits inside `pending`). Re-tested:
   second submit → `409 Insufficient Annual Leave balance`; happy path
   (submit → approve → cancel restores) still works.

### Laravel must add (mock gaps — do not port as-is)

- **Leave-year scoping (HIGH).** `used`/`pending` currently sum *all years*
  against an *annual* entitlement — last year's vacation eats this year's
  balance. Laravel needs a leave year (per-request year split for cross-year
  ranges: a Dec 28 – Jan 5 request must debit two buckets), plus a reset /
  carry-over-cap / expiry policy (product decision).
- **Eligibility rules (MED).** Today anyone can take anything: maternity (70 d)
  has no gender check, Hajj ("once per employment") is effectively annual,
  sick needs no report, and day-one hires get the full 30 days (no
  probation gate or pro-rata accrual).
- **Day counting (MED, policy decision).** `days` = calendar-inclusive; weekends
  and public holidays inside a range burn balance. Decide working-day counting
  + a holiday calendar before porting.
- **Cancel discipline (LOW).** Cancel from Approved is silent (no
  `cancelledBy`/`cancelledAt`, note optional) and past/consumed leave can be
  cancelled to resurrect balance. Decide who/when + audit columns.
- **Timezone (LOW).** Mock uses UTC day boundaries; the hospital is on
  Asia/Riyadh — `onLeaveToday`/expiry math flip up to 3 h early. Laravel must
  use `Carbon::today('Asia/Riyadh')`.
- **Concurrency (MED).** Overlap + balance checks are read-then-write; under
  concurrent approvers both can pass. Keep the planned exclusion constraint on
  overlapping dateranges per nurse (see Nest TODO §1) and re-check the balance
  in the approval transaction (`SELECT … FOR UPDATE` on the nurse's requests).

### Verified OK (no action)

- Frontend (`useLeave`) does no balance math — server is the single authority.
- `hasValidContract` mock ≡ `nursing.nurse_has_valid_contract` SQL twin
  (Active + inclusive bounds + open-ended) — exact parity.
- SQL runtime paths all execute: audit hash auto-chain + UPDATE/DELETE block +
  `verify_audit_chain` clean, `emp_contracts_active_no_overlap` exclusion fires,
  `generate_contract_expiry_alerts` + `mark_expired_contracts` run.
- Nest safety note for Laravel: `prisma.service.ts` falls back to a hardcoded
  mock authZ matrix when `ALLOW_MOCK_DATA=true` (opt-in, default off) — Laravel
  must never replicate silent mock fallback on the authorization path.
