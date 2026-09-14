# NurseApp_v02 — Hospital Nursing Workforce Management System

RBAC-based nursing workforce platform: employment contracts, credentials, rostering, and audit — NestJS + Prisma + PostgreSQL + Redis backend, React 18 + Vite + Ant Design frontend.

## Overview

| Layer | Stack |
|--------|--------|
| API | NestJS 10, Prisma 5, Passport JWT, class-validator |
| Data | PostgreSQL (multi-schema), Redis cache |
| AuthZ | Multi-role effective access + data scopes |
| Audit | Tamper-proof hash chain, monthly partitions, PHI read logging |
| Domain | Nurses · credentials · **Contract Master** · roster |
| Frontend | React 18, Vite, Ant Design |
| Preview | Express mock server (in-memory; **not for production**) |
| Ops | Docker Compose, GitHub Actions CI |

**Agencies supported on contracts:** MOH (civil service), SOP (self-operating / hospital direct hire), HCC / HHC (third-party manpower).

---

## Repository structure

```
Nurse-App_v01/
├── ANALYSIS.md
├── Hospital-RBAC-Complete-Documentation-v1.0.md   # V1 spec (legacy)
├── Effective Access Function + Role Model...txt  # V2 Phase 0 (authoritative)
├── docker-compose.yml                            # Postgres + Redis + pgAdmin + Backend
├── REDIS_CACHING.md
├── docs/
│   ├── HIPAA_COMPLIANCE_CHECKLIST.md
│   ├── TAMPER_PROOF_AUDIT_LOGS.md
│   ├── PHI_READ_AUDITING.md
│   ├── AUDIT_LOG_PARTITIONING.md
│   ├── CONTRACT_MASTER.md
│   ├── CONTRACT_EXPIRY_ALERTS.md
│   ├── CONTRACT_ACTIVE_EXCLUSIVITY.md
│   ├── ROSTER_CONTRACT_GUARD.md
│   ├── STAFF_CREDENTIAL_TRACKING.md
│   └── …
├── backend/
│   ├── mock-server.js                            # DEMO/PREVIEW ONLY
│   ├── mock-contract-routes.js
│   ├── src/
│   │   ├── main.ts · app.module.ts · health.controller.ts
│   │   ├── common/          # RBAC guard, audit interceptor, filters
│   │   └── modules/
│   │       ├── auth/ · rbac/ · audit/ · users/
│   │       ├── nursing/     # nurses, credentials, roster (+ data scopes)
│   │       └── contracts/   # Contract Master lifecycle
│   ├── prisma/schema.prisma · seed.ts
│   ├── database/migrations/   # V1_0 … V4_10 (see below)
│   ├── scripts/
│   │   ├── run-migrations.ts
│   │   └── run-contract-expiry-alerts.ts
│   └── package.json
└── frontend/                  # React 18 + Vite + Ant Design
    └── src/
        ├── api/client.ts
        ├── hooks/useEffectiveAccess.ts
        ├── context/AuthContext.tsx
        └── pages/             # Login, Dashboard, NurseMaster, Credentials,
                               # Roster, Contracts, Users, RBAC admin, Audit
```

---

## Migrations (V1 → V4)

Apply with the ordered runner (preferred):

```bash
export DATABASE_URL=postgresql://devuser:devpassword@localhost:5432/hospital_rbac_dev
npx ts-node scripts/run-migrations.ts
# options: --dry-run | --baseline | --force | --continue-on-error
```

| Version | Purpose |
|---------|---------|
| **V1_0 – V1_1** | Core schema, system tables |
| **V2_0 – V2_5** | Effective access (multi-role), hospital roles, RBAC seed |
| **V3_0 – V3_4** | Nursing domain, demo seed, personal fields, job no. |
| **V3_5** | Tamper-proof audit logs (SHA-256 chain + triggers) |
| **V3_6** | Audit log monthly range partitioning helpers |
| **V4_0** | **Contract Master** — lifecycle, agencies, `nurse_has_valid_contract` |
| **V4_1** | Contract expiry alerts |
| **V4_2** | Active-contract exclusivity (GiST / `btree_gist`, `active_span`) |
| **V4_3** | Staff credential tracking (templates, position linkage) |
| **V4_10** | Position hierarchy (parent links, cycle protection, hierarchy API) |

History is recorded in `public.schema_migrations`.

---

## Quick start

### Docker

```bash
docker-compose up -d
docker-compose logs -f backend
# API  http://localhost:4000/api/v1
# pgAdmin  http://localhost:5050  (admin@hospital.local / admin)
```

### Local backend

```bash
cd backend
npm ci
cp .env.example .env.development   # set DATABASE_URL, JWT, Redis

docker-compose up -d postgres redis

export DATABASE_URL=postgresql://devuser:devpassword@localhost:5432/hospital_rbac_dev
npm run db:migrate:raw             # runs V1_0 … V4_10
npx prisma generate
npm run prisma:seed

npm run start:dev
```

### Mock server (preview only)

```bash
cd backend && npm run mock         # or mock:watch
# Frontend points at the mock API; no Postgres required
```

### Contract expiry scan (Nest path)

```bash
npm run alerts:scan                # scripts/run-contract-expiry-alerts.ts
```

---

## Test login

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin.system","password":"Password123!"}'
```

Default password for seeded users: **`Password123!`**

| Username | Role |
|----------|------|
| admin.system | SYSTEM_ADMIN |
| susan.lee | NURSE_MANAGER |
| james.wilson | CHARGE_NURSE |
| maria.garcia / ahmed.hassan | RN |
| jennifer.smith | LPN |
| david.kim | CNA |
| rachel.brown | SCHEDULER |
| patricia.johnson | HR_ADMIN |
| michael.wong | COMPLIANCE_OFFICER |

---

## Domain highlights (V3–V4)

### Contract Master (V4_0+)

- Single employment-contract record per lifecycle: draft → approve/activate → renew → expire/terminate.
- Types: fixed-term, permanent, temporary, and agency-specific (MOH / SOP / HCC / HHC).
- **`nurse_has_valid_contract(nurse_id, on_date)`** — Active status + closed date interval `[start, end]`.
- **Exclusivity (V4_2):** at most one **Active** contract per nurse for overlapping date ranges (GiST exclusion on generated `active_span`).
- Renewals: deferred supersede of the prior Active row inside the same transaction as activate/approve (avoids coverage gaps).
- Expiry alerts (V4_1) + CLI `npm run alerts:scan`.
- See `docs/CONTRACT_MASTER.md`, `CONTRACT_ACTIVE_EXCLUSIVITY.md`, `CONTRACT_EXPIRY_ALERTS.md`.

### Nursing & roster

- Nurses (job no., position code, home unit), credentials, roster assignments.
- **Data scopes** applied to nurse and roster reads/mutations (unit/department/self; destination validation).
- Double-booking prevention (409).
- Roster should refuse staff without a valid contract on the assignment date — see `docs/ROSTER_CONTRACT_GUARD.md` (SQL predicate is in V4_0; wire Nest/mock callers if not already on your branch).

### Credentials (V4_3)

- Template catalog, position linkage, verification workflow, expiring-soon horizon.
- See `docs/STAFF_CREDENTIAL_TRACKING.md`.

### Audit & HIPAA path

- SHA-256 hash chaining + DB triggers (V3_5); monthly partition helpers (V3_6).
- Audit interceptor; PHI read auditing notes; 6-year retention guidance in docs.
- Checklist: `docs/HIPAA_COMPLIANCE_CHECKLIST.md`.

### Effective access (V2_5)

Aggregates **all** active roles (not only `primary_role_id`), `BOOL_OR` on menu access, returns `user_roles` for audit, Redis-backed with near-expiry TTL awareness.

---

## Done recently (summary)

- ✅ **V4 Contract Master** — schema, Nest module, mock routes, agencies, lifecycle, renew + deferred supersede
- ✅ **V4_2 exclusivity** — GiST active span; transactional activate/approve
- ✅ **V4_1 expiry alerts** — scan script + docs
- ✅ **V4_3 staff credential tracking**
- ✅ **V4_10 position hierarchy** — explicit employment-position parent links; authorization roles remain separate
- ✅ **V3_5 / V3_6** tamper-proof audit + partitioning helpers
- ✅ **Data scopes** on nurse and roster (#6)
- ✅ User management (CRUD, roles, unlock, password reset, sessions, audit)
- ✅ Nursing Phase 1 + frontend NurseMaster / Credentials / Roster
- ✅ Redis cache invalidation, health readiness (DB + Redis), CI + lockfiles
- ✅ HIPAA checklist and supporting audit docs

---

## Next steps

- Enforce **roster → `nurse_has_valid_contract`** on every Nest and mock create/update path
- Leave management + workforce analytics
- MFA, row-level security on PHI tables, automated partition retention
- Close remaining HIPAA gaps from the checklist
- Load / security testing

---

## Docs index

| Doc | Topic |
|-----|--------|
| `docs/HIPAA_COMPLIANCE_CHECKLIST.md` | Technical / admin / org checklist + status |
| `docs/TAMPER_PROOF_AUDIT_LOGS.md` | Hash chain design |
| `docs/PHI_READ_AUDITING.md` | PHI GET auditing |
| `docs/AUDIT_LOG_PARTITIONING.md` | Monthly partitions / retention |
| `docs/CONTRACT_MASTER.md` | Employment contract lifecycle |
| `docs/CONTRACT_EXPIRY_ALERTS.md` | Automated expiry notifications |
| `docs/CONTRACT_ACTIVE_EXCLUSIVITY.md` | Option A GiST constraint |
| `docs/ROSTER_CONTRACT_GUARD.md` | Valid-contract gate for roster |
| `docs/STAFF_CREDENTIAL_TRACKING.md` | Credential templates & tracking |
| `REDIS_CACHING.md` | Cache keys and invalidation |
| `ANALYSIS.md` | Deep analysis |
| `backend/README.md` | Backend-specific notes |

Original specs: `Hospital-RBAC-Complete-Documentation-v1.0.md`, `Effective Access Function + Role Model + Tests + Real Data.txt`.
