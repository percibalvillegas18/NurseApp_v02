# Workforce Analytics

Analytics (`WORKFORCE_ANALYTICS`). UI + mock API are live; the Nest module is
still TODO (tracked below).

## Principle

Every endpoint is **computed live from the current dataset** — no cached rollups,
no stored counters. Create a nurse, approve a leave, activate a contract, and
the next analytics call reflects it. The dashboard and the notification bell
read the same endpoints, so all three always agree.

## Endpoints (mock `/api/v1/analytics/*`, Bearer required)

| Method | Path | Computes |
|--------|------|----------|
| GET | `/analytics/summary` | Headcount (total/byStatus/byEmploymentType/byRole/byUnit), credential health (total/expired/expiring≤30/pending), contracts (active/expiring≤90/withoutValidContract), roster next 7d, leave (pending/onLeaveToday) |
| GET | `/analytics/credentials` | By status/category + expiring≤30 and expired lists (top 20, with nurse) |
| GET | `/analytics/contracts` | By status/agency/type + expiring≤90 + **uncovered nurses** (Active, no valid contract today) |
| GET | `/analytics/roster?from=&to=&unitId=` | Per-day totals × shift × status + top-10 busiest nurses |
| GET | `/analytics/leave?year=` | Requests by status, approved days by type/month, pending list, **low balances** (paid types with ≤20% of entitlement remaining — relative so small quotas like Paternity=3 don't all flag) |

## Frontend

- `frontend/src/pages/Analytics.tsx` — KPI cards + tabs (Headcount,
  Credentials, Contracts, Roster coverage, Leave). No chart dependency;
  tables + Statistics, consistent with the rest of the Ant Design UI.
- `frontend/src/pages/Dashboard.tsx` — summary KPIs, today's live roster,
  contract-gap / expired-credential alert banners, working quick actions.
- `AppLayout` bell — badge = expiring credentials + expiring contracts +
  pending leave; dropdown links into the three pages.

## Nest TODO (when graduating from mock)

1. `AnalyticsModule` (read-only, `WORKFORCE_ANALYTICS` VIEW guard) with the
   same five endpoints; queries over Prisma (nurses, credentials, contracts,
   roster, leave requests).
2. Optional Redis caching (60s TTL) once datasets grow — keep the
   computed-live semantics via short TTL + invalidation on writes.
