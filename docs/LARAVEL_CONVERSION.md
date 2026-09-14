# PostgreSQL + Laravel Conversion Plan

**Status (2026-09-14):** Phase 0 (PostgreSQL readiness) is **DONE and verified** — the full
22-file migration chain applies cleanly on a fresh database and the RBAC engine was
smoke-tested in both ALLOW and DENY directions. Phase 1+ (Laravel port) is **planned
below, not yet scaffolded** — this sandbox has no PHP/Composer (network allowlist
blocks packagist/getcomposer), so the Laravel app must be scaffolded where PHP exists.

Related docs: `docs/DEMO_DATA.md` (seed inventory), `docs/SYSTEM_CHECK_AND_RECOMMENDATIONS.md`,
`docs/HIPAA_COMPLIANCE_CHECKLIST.md`.

---

## Part A — PostgreSQL readiness ✅ DONE

### A.1 What was broken

The migration chain (`backend/database/migrations/`, applied in order by
`backend/scripts/run-migrations.ts`) **could not run on a fresh database**. Each file
runs in its own transaction and the runner stops at the first failure, so the chain
halted at V2_0. On top of that, the authorization engine (`rbac.evaluate_access`)
could never execute successfully — every call raised `column ... does not exist`.

### A.2 Repairs applied (all in `backend/database/migrations/`)

| # | File | Bug | Fix |
|---|------|-----|-----|
| 1 | `run-migrations.ts` | `order[]` omitted `V4_5__evaluate_access_resource_type.sql`, so the signature the app calls was never installed | Added V4_5 after V4_4 |
| 2 | `V2_0__effective_access_function.sql` | Two `CREATE INDEX` referenced `role_code`, which is only added in V2_2 → whole file rolled back, runner halted | Removed (V2_2 already creates equivalents) |
| 3 | `V2_2__rbac_tables_role_updates.sql` | Legacy V1 `role_id VARCHAR NOT NULL` column kept → all V2_4/V4_0 seeds failed with `null value in column "role_id"` | `DROP COLUMN role_id` (+ superseded `uk_*(role_id,…)`), matching the Prisma contract where `role_code` is the key |
| 4 | `V3_6__audit_log_partitioning.sql` | Nested `$$…$$` inside the function body terminated it early → `syntax error at or near "TO"` | Regex literal uses a distinct `$re$…$re$` tag |
| 5 | `V4_4__resource_aware_data_scope.sql` | Referenced nonexistent `menus.is_visible/is_enabled` and `role_menu_access.allowed` | Gate menus on `status`; menu access = `visible AND enabled` |
| 6 | `V4_5__evaluate_access_resource_type.sql` | Referenced nonexistent `system.menus`, `system.permissions`, `rma/role_id`, `rma.is_visible/is_enabled`, `rp.is_allowed`, `nursing.nursing_units`, `units.organization_id`, `uds.unit_id`, scope literals `'Organization'`/`'Unit'` | Rewritten against the real schema (see A.4) |

Cascading failures in V4_1/V4_2/V4_3/V4_10 cleared once the above were fixed — no
changes needed in those files.

### A.3 Verification evidence

A throwaway PGlite harness (real PostgreSQL 18.3, **not** committed — scratch tooling
in `/home/user/pgcheck`, outside the repo) applies the 22 files in runner order:

```
[migrate] V1_0 … V4_10 — 22/22 OK
[inventory] tables: audit:8 auth:3 nursing:10 rbac:11 system:4
[smoke] evaluate_access(admin, DASHBOARD, VIEW)            => ALLOW
[smoke] evaluate_access(admin, NURSE_MASTER, VIEW, nurse#1) => ALLOW (resource-aware scope)
[smoke] evaluate_access(admin, NOPE, VIEW)                 => DENY (menu not found)
[smoke] evaluate_access(ghost user, …)                     => DENY (user not found)
[smoke] get_user_full_access(1) => 204 rows; preview_access_change => works
```

To reproduce against real PostgreSQL 15 (from `docker-compose.yml`):

```bash
docker compose up -d postgres
cd backend && npm run db:migrate        # ts-node scripts/run-migrations.ts
```

### A.4 Ground truth for the Laravel port (do not re-derive — verified)

- **Extensions (all in `postgresql-contrib`):** `pgcrypto`, `uuid-ossp`, `btree_gist`.
- **Live RBAC function:** exactly one overload —
  `rbac.evaluate_access(BIGINT, VARCHAR, VARCHAR, BIGINT DEFAULT NULL, TEXT DEFAULT NULL)`
  returning `(decision, reason, menu_accessible, permission_granted, data_scope_valid,
  cache_ttl, evaluated_at, user_role, user_roles)`. Call with 3–5 args (defaults cover).
- **Key columns:** `role_menu_access(role_code, visible, enabled)`,
  `role_permissions(role_code, allowed)`, `user_data_scopes(scope_type, organization_id,
  department_id, nursing_unit_id, post_id)` with `scope_type ∈ {All, Hospital,
  Department, NursingUnit, Post, Assigned}`, units in **`rbac`.nursing_units** (org id
  via `rbac.departments`), `nurses(home_unit_id, user_id, deleted_at)`.
- **Seeds:** 10 users / 10 roles; passwords are bcrypt `$2b$12$` for `Password123!` —
  Laravel `Hash::check()` verifies them as-is, no rehash needed.
- **Views:** `auth.vw_user_current_roles`, `nursing.credentials_expiring_soon`
  (survive the V4_5 `DROP … CASCADE` — verified present post-migration).
- **Gotchas:** (1) `docker-compose.yml` mounts `./migrations:/docker-entrypoint-initdb.d/migrations` —
  a **subdirectory the entrypoint ignores**; the TS runner is the only apply path.
  (2) The runner records `schema_migrations` but never checksum-verifies on skip;
  the Laravel port should use Laravel's own `migrations` table instead.

---

## Part B — NestJS → Laravel mapping

### B.1 Target runtime

| Concern | Today (NestJS) | Laravel target |
|---|---|---|
| Runtime | Node 22 + NestJS 10 | PHP 8.3 + Laravel 11 (LTS-adjacent), `pdo_pgsql` |
| AuthN | Passport JWT (`@nestjs/jwt`) | Laravel Sanctum (token) — or `php-open-source-saver/jwt-auth` for a like-for-like JWT swap |
| AuthZ | `rbac.guard.ts` → `rbac.evaluate_access()` | Middleware calling `SELECT * FROM rbac.evaluate_access(?,?,?,?,?)`, honoring the returned `cache_ttl` |
| ORM | Prisma (multi-schema) | Eloquent with `protected $table = 'rbac.menus'` etc.; `BigIncrements`/`BigInteger` keys; **no FK rewiring needed** |
| Validation | `class-validator` DTOs | Form Requests (1:1 per DTO) |
| Cron | `@nestjs/schedule` | `routes/console.php` scheduler |
| Cache/sessions | `ioredis` + `redis.service.ts` key scheme | `predis`/`phpredis` — **preserve existing cache key format** for a zero-downtime swap |
| Hashing | `bcryptjs` | Native `Hash` (bcrypt `$2b$` compatible — see A.4) |
| API docs | Swagger decorators | `scramble` (reads code, no annotation rewrite) or keep hand-written OpenAPI |

### B.2 Module map (81 routes across 8 modules)

| NestJS module | Laravel home | Notes |
|---|---|---|
| `auth` | `AuthController` + Sanctum + `User`/`HospitalRole` models | Login mirrors `evaluate_access` for the dashboard decision; keep lockout/throttle semantics |
| `rbac` | `RbacController` + `EvaluateAccess` middleware + `RoleMenuAccess`/`RolePermission`/`UserDataScope` models | **Keep `evaluate_access` in Postgres** — do not reimplement the 5-step engine in PHP; port `effective-access.service` as a thin `DB::select` wrapper |
| `nursing` | `NurseController`, `CredentialController`, `RosterController` + models | App-layer data-scope filters stay (defence in depth with the DB guard); soft-deletes map to `deleted_at` |
| `contracts` | `ContractController` + `ContractExpiring` notification + scheduled command | Expiry alerts (V4_1), active-exclusivity (V4_2, DB trigger — nothing to port), positions (V4_10) |
| `audit` | Read-only `AuditController` | **Triggers stay in Postgres** (tamper-proof hash chain V3_5, partitioning V3_6); Laravel only `SELECT`s; schedule `ensure_audit_partitions_ahead` + `drop_audit_partitions_older_than` + chain verification |
| `users` | `UserController` | Standard CRUD on `auth.users` + `user_role_assignments` |
| `redis` | `config/database.php` + cache tags | Preserve key scheme (see B.1) |
| `prisma` | `app/Models/*` (~30 models) | Straightforward; enums for `USER-DEFINED` PG types |

### B.3 Mock-only features — port/drop decision required

These exist only in the mock server (`mock-server/`, ~30 endpoints) with **no
Postgres schema or NestJS equivalent**: **Leave management** (`docs/LEAVE_MANAGEMENT.md`),
**Workforce analytics** (5 endpoints, `docs/WORKFORCE_ANALYTICS.md`), **Settings**,
**Demo** endpoints. Each needs a product decision: (a) design schema + port to Laravel,
(b) drop. Recommended: leave + analytics = port (flagship features); settings/demo = drop or stub.

### B.4 What stays in the database (do not port)

Partitioning + retention (V3_6), tamper-proof audit triggers (V3_5), `evaluate_access`
+ siblings, contract exclusivity triggers (V4_2), expiry-alert views/functions (V4_1),
credential tracking (V4_3). The Laravel app calls these; it must not reimplement them.

---

## Part C — Phased execution plan

| Phase | Work | Exit criteria | Rough effort |
|---|---|---|---|
| **0. PG readiness** | ✅ Done (Part A) | 22/22 green, smoke-tested | — |
| **1. Foundation** | `laravel new`, pgsql + Redis + Sanctum, Eloquent models for 5 schemas, `EvaluateAccess` middleware, Form Requests, CI (`phpunit` + migration replay on PG15 service) | `php artisan migrate:fresh` equivalent replays the SQL chain; one guarded route returns the same decision as Nest | 1–2 dev-weeks |
| **2. Port** | Controllers per B.2 (real-backend 81 routes first), scheduler jobs, notifications | All ported routes respond; decisions byte-identical to Nest on the shared DB | 3–4 dev-weeks |
| **3. Mock-only gap** | Leave/analytics/settings decision (B.3) + schema + port | Feature parity with the mock, or signed-off drop list | 1–3 dev-weeks |
| **4. Parity & cutover** | Dual-run Nest vs Laravel on staging (same PG), diff harness on decisions + payloads, frontend base-URL flip, decommission Nest | Zero decision diffs over a soak period; frontend untouched (API-compatible) | 1–2 dev-weeks |

**Total: ~6–11 dev-weeks** depending on the B.3 decision. Frontend (`frontend/`) needs
no changes if routes stay API-compatible — verify with the existing Cypress suite.

## Risks

1. **No PHP toolchain in this sandbox** — Phase 1 must start where PHP 8.3 + Composer exist.
2. **JWT secret rotation** — switching Passport-JWT → Sanctum invalidates existing tokens; plan a maintenance window or dual-accept period.
3. **Partition-aware queries** — Eloquent date filters on `audit_logs` must include `created_at` bounds or they scan all partitions; add a global scope.
4. **Enum drift** — PG `USER-DEFINED` enums need matching PHP enums + a CI check.
