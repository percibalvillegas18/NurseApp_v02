# Nurse-App_v01 — Repository Analysis & Audit

**Date:** 2026-09-12
**Branch analyzed:** `arena/01a094a8-nurse-app-v01` @ `4be0d7c`
**Method:** Static read of all 92 tracked source/doc files + **live verification** (installed deps, built both apps, ran the unit tests, booted the real NestJS backend and the mock server, and probed endpoints with `curl`).

> This supersedes the root `ANALYSIS.md`, which is stale — it still describes the repo as "documentation-only, pre-implementation, 1 commit, no source code." That has not been true for a while.

---

## 1. Snapshot

| | |
|---|---|
| Tracked files | 92 (814 KB, no binaries, no `node_modules`) |
| Source lines | ~5,600 (TS/TSX/JS/SQL/Prisma) |
| Documentation lines | ~4,400 (Markdown + the V2 spec `.txt`) |
| Git history | Shallow clone — 1 visible commit (`4be0d7c`, a merge of the previous Arena session) |
| Lockfiles | **None committed** |
| CI | **None** (`.github/` does not exist) |
| Tests | 1 spec file (13 cases: 8 pass, 5 hard-skipped) |

**Stack**

- **Backend:** NestJS 10 + Prisma 5 (`multiSchema` preview) + raw PL/pgSQL, PostgreSQL 15, Redis 7 (ioredis), JWT via passport-jwt, bcryptjs.
- **Frontend:** React 18 + Vite 5 + TypeScript (strict) + Ant Design 5 + TanStack Query 5 + react-router 6. `zustand` is a declared dependency but **never imported** — dead weight.
- **Infra:** `docker-compose.yml` (postgres, redis, pgadmin, backend, frontend), multi-stage Dockerfiles, nginx SPA config.
- **Oddity:** `backend/mock-server.js` (986 lines) — a hand-written Express clone of the entire API, used for previews without a database.

---

## 2. What the system actually is

A **hospital nursing-workforce RBAC platform**, but at this commit it is ~90% *authorization infrastructure* and ~10% *nursing domain*. The nursing side is two placeholder pages (`NurseMaster.tsx`, `Roster.tsx`) and unseeded org tables (`organizations`, `departments`, `nursing_units`, `posts`, `shifts`).

The core design decision — and it is a good one — is that **authorization lives in the database**, not in application code:

```
rbac.evaluate_access(p_user_id, p_menu_code, p_permission_code, p_resource_id)
  → decision (ALLOW|DENY), reason, menu_accessible, permission_granted,
    data_scope_valid, cache_ttl, evaluated_at, user_role, user_roles[]
```

Layered on top:

1. **SQL function** (single source of truth, deny-by-default, temporal `effective_from/to` filtering).
2. **`RbacGuard`** + `@RequirePermission({menuCode, permissionCode, resourceIdParam})` — backend enforcement on every route.
3. **Redis cache** — `rbac:access:{userId}:{menu}:{perm}:{resource|_}`, TTL from the SQL function (ALLOW 300 s, DENY 1800 s, expiring-soon 60 s), with per-user and per-role invalidation plus a role→users tracking set.
4. **Frontend `usePermission` / `ProtectedRoute`** — cosmetic menu hiding, explicitly documented as non-authoritative.
5. **Audit** — `AuditService` writes every login, denial and config change to `audit.audit_logs`.

Four Postgres schemas (`auth`, `rbac`, `system`, `audit`), 8 hand-written versioned SQL migrations (`V1_0` → `V2_5`), and a Prisma schema that mirrors them (19 models). `V2_5` is the important one: it replaced `V2_0`'s primary-role-only check with **multi-role OR logic** (`BOOL_OR(rma.visible AND rma.enabled)` over `ARRAY_AGG` of all temporally-valid active roles).

---

## 3. Verification results (what I ran)

| Check | Result |
|---|---|
| `npm install` backend | ✅ 723 packages |
| `npm install` frontend | ✅ 300 packages |
| `npm run build` (backend, `nest build`) | ✅ compiles clean |
| `npx tsc --noEmit` (frontend) | ✅ 0 errors |
| `npx vite build` (frontend) | ✅ builds — **1,422 kB single chunk (448 kB gzip)** |
| `npx jest` (backend) | ✅ 8 passed, **5 skipped** (`it.skip`, need a real DB) |
| Boot real backend (`node dist/src/main.js`) | ✅ boots, 30 routes mapped, Redis absent → "caching disabled" |
| Boot mock server | ✅ port 4000 |
| Frontend dev server + `/api` proxy | ✅ port 3000, proxy works, login works end-to-end |
| `npm run lint` (both apps) | ❌ **no ESLint/Prettier config exists anywhere** |
| `npm run test:e2e` | ❌ **`backend/test/jest-e2e.json` does not exist** |
| `docker compose build` | ❌ **would fail** — see C-6 and H-5 |
| `npm run mock` / `node mock-server.js` on a clean clone | ❌ **`express` and `cors` are not dependencies** |

Live-preview processes are running now: **Frontend → port 3000**, **Mock API → port 4000**. Log in with `admin.system` / `Password123!` (or any of the 10 seeded demo users).

---

## 4. Findings

Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low/Hygiene. Every item was confirmed by reading the code or by running it.

### 🔴 C-1 — Global login lockout is a one-request DoS against the whole hospital
`backend/src/modules/auth/auth.service.ts:17-20, 46-56`

```ts
private globalAttempts = { count: 0, lockedUntil: null, lastAttemptAt: null };
private readonly MAX_ATTEMPTS = 5;
private readonly LOCK_DURATION_MS = 10 * 60 * 1000;
```

Five failed logins **from anyone, anywhere, with any username** lock **every** account for 10 minutes. `isGlobalLocked()` is checked before the user is even looked up. Confirmed live: attempt 1 with `nosuch.user`, attempt 2 with `maria.garcia` — a single shared counter.

An unauthenticated attacker can permanently deny access to a clinical system with 5 requests every 10 minutes. In a hospital this blocks nurses from charting. The commit message says this was explicitly requested ("user requested global"), so it may be intentional for a demo — but it is the single most dangerous thing in the repo and must not ship.

It is also **in-process memory**: not shared between instances (so it does nothing behind a load balancer), lost on restart, and it double-counts alongside the per-user `failed_login_attempts` column.

**Fix:** drop the global counter, or convert it into a *per-IP + per-username* counter in Redis (`INCR` + `EXPIRE`, e.g. `login:fail:{ip}` and `login:fail:{username}`) with an admin-only global throttle that *rate-limits* rather than *locks out*.

---

### 🔴 C-2 — Unauthenticated endpoints disclose the user list and defeat the lockout
`backend/src/modules/auth/auth.controller.ts` — `GET /auth/attempts`, `GET /auth/attempts/:username`, `POST /auth/reset-attempts` carry **no guard at all**.

Confirmed against the running backend and the mock:

```
$ curl -X POST localhost:4000/api/v1/auth/reset-attempts -d '{}'
{"success":true,"message":"All attempts reset (global + per-user)"}
```

So: anyone can clear the lockout they just triggered (making C-1 attacker-controllable in both directions), enumerate whether a username exists, and read per-user failure counts and timestamps.

Worse, the 401 bodies enumerate the entire staff directory:

```json
"message":"Username \"nosuch.user\" not found. GLOBAL Attempt 1/5 ...",
"details":{"validUsernames":["admin.system","susan.lee","james.wilson", ... all 10]}
```

and the wrong-password response ends with `"Demo: Password123!"` (`auth.service.ts:181`) — **the API returns a working password in its error message**.

**Fix:** guard all three endpoints (`SYSTEM_SETTINGS/MANAGE`) or delete them; strip `validUsernames` and the demo-password hint; make "user not found" and "wrong password" return one identical generic message.

---

### 🔴 C-3 — `/audit/logs` does not exist on the real backend; the Audit Logs page is mock-only
`frontend/src/api/client.ts` (`auditApi.getLogs`, `getStatistics`) and `frontend/src/pages/RBAC/AuditLogs.tsx` call `/audit/logs` and `/audit/statistics`. `AuditService.getLogs()` and `getStatistics()` are fully implemented — but there is **no `AuditController`**, and `AuditModule` registers no controllers.

```
$ curl -o /dev/null -w "%{http_code}" localhost:4001/api/v1/audit/logs
404
```

The page only works because `mock-server.js:929` implements the route. Same for `GET /cache/keys/:pattern`, which exists in the real backend but not in the mock.

**Fix:** add `audit.controller.ts` with `@RequirePermission({menuCode:'AUDIT_LOGS', permissionCode:'VIEW'})` and register it in `AuditModule`.

---

### 🔴 C-4 — `PrismaService` silently degrades to a mock that **fails open** on authorization
`backend/src/modules/auth/prisma.service.ts` (451 lines) is a hand-written data layer that catches any Prisma/connection failure, logs a warning, and switches to hard-coded in-memory data with a valid bcrypt hash for `Password123!`.

Two consequences, both confirmed live:

1. **A production app with a transient DB outage keeps serving logins.** I ran the built backend with no database at all and successfully obtained a real signed JWT for `admin.system`:
   ```
   WARN [PrismaService] ⚠️ PrismaClient failed to initialize, using MOCK mode
   POST /api/v1/auth/login {"username":"admin.system","password":"Password123!"} → 200 + valid JWT
   ```
2. **The mock `evaluate_access` returns ALLOW.** `prisma.service.ts:195-220` fabricates `"Authorization granted: all checks passed (MOCK REAL BACKEND)"` and only denies for a couple of hard-coded RN cases. So when the DB is down, the authorization engine that `RbacGuard` depends on **fails open**, not closed — the exact opposite of the "fail closed" comment in `effective-access.service.ts`.

**Fix:** fail fast. If `NODE_ENV=production` (or a `ALLOW_MOCK_DATA=false` flag, default false), throw on init instead of degrading. Keep the mock behind an explicit opt-in for previews, and make its default decision DENY.

---

### 🔴 C-5 — Production Docker image cannot start; `npm ci` cannot run
- `backend/Dockerfile` production stage ends with `CMD ["node", "dist/main.js"]`, but because `backend/tsconfig.json` has **no `include`**, `nest build` emits to `dist/src/main.js` (it also compiles `prisma/seed.ts` and `scripts/run-migrations.ts` into `dist/`). Verified: `dist/main.js` → `MODULE_NOT_FOUND`; `dist/src/main.js` → boots.
- Both Dockerfiles run `npm ci` in the builder stage, but **no `package-lock.json` is committed**. `npm ci` exits non-zero without a lockfile, so `docker compose build` fails before it ever reaches the CMD bug.
- `docker-compose.yml` also mounts `./frontend/public`, a directory that does not exist (Docker will create it as a root-owned empty dir).

**Fix:** commit lockfiles; add `"include": ["src"]` to `backend/tsconfig.json` (or set `entryFile` in `nest-cli.json`); correct the CMD; create or drop the `frontend/public` mount.

---

### 🔴 C-6 — Any authenticated user can read any other user's authorization profile
`backend/src/modules/rbac/rbac.controller.ts:159` (`GET /rbac/effective-access/:userId`) has a `@RequirePermission` decorator, but **`:183` (`POST /rbac/effective-access/:userId/evaluate`) has none**, and the controller-level `RbacGuard` returns `true` immediately when no metadata is present (`rbac.guard.ts:48-51`). `GET /rbac/menus/hierarchy` (`:63`) is likewise undecorated.

Confirmed live: I logged in as `maria.garcia` (RN) and asked about user 1 (SYSTEM_ADMIN):

```
POST /api/v1/rbac/effective-access/1/evaluate
     {"menuCode":"SYSTEM_SETTINGS","permissionCode":"MANAGE"}
→ 201 {"allowed":true, "roles":["SYSTEM_ADMIN"], ...}
```

That is a full authorization-oracle and role-enumeration endpoint for every user id in the hospital. Note the guard *does* work where it is wired (`/cache/stats` correctly returned 403 for the same nurse), so this is a missing decorator, not a broken guard.

**Fix:** add `@RequirePermission({menuCode:'USER_MANAGEMENT', permissionCode:'VIEW'})` to `evaluate`, and constrain `:userId` to `req.user.id` unless the caller holds the admin permission. Add a test for it — there is currently no controller-level test at all.

---

### 🟠 H-1 — Sessions are write-only; logout does not invalidate anything
`auth.service.ts:login()` creates an `auth_sessions` row and returns `sessionId`, but the JWT payload contains only `{sub, username, role, primaryRoleId}`. `JwtStrategy.validate()` (`strategies/jwt.strategy.ts`) never looks at the session table, and `logout()` only flips the session row to `Revoked`. Access **and** refresh tokens therefore stay valid after logout, and `refreshToken()` re-signs from the token alone with no revocation check, no rotation and no reuse detection. `absolute_timeout_at` is stored but never enforced.

**Fix:** put `sessionId` in the JWT, check `auth_sessions.status = 'Active'` in `JwtStrategy.validate()` (Redis-cached), and delete/rotate the refresh token on use.

### 🟠 H-2 — JWT secret has a hard-coded fallback
`auth.module.ts:18` and `jwt.strategy.ts:24` both do `configService.get('JWT_SECRET') || 'dev-secret-key-change-in-production-please-use-64-chars-min'` — the same string that is in `.env.example`, `docker-compose.yml` and now this report. A missing env var produces a *working* app with a publicly known signing key instead of a crash.

**Fix:** `JWT_SECRET` required, validated at boot (e.g. Joi schema on `ConfigModule.forRoot`), ≥32 random bytes, no default anywhere.

### 🟠 H-3 — `rbac.vw_current_access_decisions` is a performance bomb
`V2_5__...sql` (tail) defines the view as `users × hospital_roles × menus × permissions` with **two separate `evaluate_access()` calls per row** (`.decision` and `.reason`). With the seeded data that is 10 × 10 × ~20 × ~12 × 2 ≈ **48,000 PL/pgSQL invocations** per `SELECT *`. It grows multiplicatively with every nurse added. `V2_0` had the same flaw; `V2_5` claims to have optimised it and did not.

**Fix:** delete the view, or replace it with a `MATERIALIZED VIEW` refreshed on RBAC config change, or compute `.decision` once in a lateral subquery and reuse it.

### 🟠 H-4 — Data-scope (row-level) authorization is still a stub
`evaluate_access` accepts `p_resource_id` but only checks that *some* active scope row exists for the user. Nothing links the resource to the user's hospital/department/unit/post/shift, so an ICU nurse passes a scope check for a Medical-Ward record. The SQL says `TODO`; `ANALYSIS.md` flagged it months ago. The one skipped test that covers it (`ICU nurse should NOT access Medical Ward resource`, spec line 233) is `it.skip`.

This matters because everything else in the design is genuinely enforced — this is the hole that lets a correctly-authenticated user read the wrong patients.

**Fix:** join the resource to its owning unit and intersect with `user_data_scopes`; then un-skip that test against a real database.

### 🟠 H-5 — Redis gives up forever after ~10 retries
`redis.service.ts:22-28`: `retryStrategy` returns `null` after 10 attempts. Observed live — with Redis simply not up yet, the log ends in `Redis retry limit exceeded, giving up`, and the cache stays dead for the life of the process even after Redis recovers. Every `evaluateAccess` then hits Postgres.

**Fix:** exponential backoff with no hard stop (cap the delay, not the attempts), plus a `reconnectOnError` handler; emit a health signal so orchestrators can restart the pod.

### 🟠 H-6 — Lint and e2e scripts cannot run
No `.eslintrc*`, no `eslint.config.*`, no `.prettierrc*` anywhere, yet both `package.json` files declare `lint` scripts (the frontend's with `--max-warnings 0`). `test:e2e` points at a nonexistent `backend/test/` directory. There is no CI to catch any of this.

**Fix:** add `@nestjs/eslint-config` + Prettier config to the backend, an `eslint.config.js` to the frontend, and a GitHub Actions workflow running `install → lint → build → test` for both apps on every push. That single workflow would have caught C-5.

---

### 🟡 M-1 — Infrastructure that is written but never registered
`AuditInterceptor` (audits every POST/PUT/PATCH/DELETE with body sanitisation) and `AllExceptionsFilter` (the unified `{success, errorCode, message, details}` envelope the frontend already knows how to parse) are both complete — and **neither is bound anywhere**. No `APP_INTERCEPTOR`/`APP_FILTER` provider, no `app.useGlobalFilters()` in `main.ts`. Consequently mutation auditing and the error shape are both dead code, and real vs. mock error shapes diverge (as `docs/SYSTEM_CHECK_AND_RECOMMENDATIONS.md` already notes).

**Fix:** in `AppModule`, `providers: [{provide: APP_INTERCEPTOR, useClass: AuditInterceptor}, {provide: APP_FILTER, useClass: AllExceptionsFilter}]`.

### 🟡 M-2 — Three `PrismaService` instances
`PrismaService` is listed in the `providers` of `AuthModule`, `RbacModule` **and** `AuditModule` rather than being a `@Global()` `PrismaModule`. Confirmed at boot: the constructor warning prints **3×**. That is 3 clients and 3 connection pools against the same DB. `CacheController` (declared in `AppModule`) injects `RbacService` and `RbacGuard` without `AppModule` importing `RbacModule` — it only resolves because `RedisModule` is global and Nest walks the export graph. Fragile.

### 🟡 M-3 — `vite.config.ts` proxy is mis-spelled and mis-targeted
```ts
proxy: { '/api': { target: process.env.VITE_API_URL || 'http://localhost:4000', changeOrigin: true, ... } }
```
The option is **`changeOrigin`**, not `changeOrigin` → `changeOrigin` is silently ignored (Host header is not rewritten). And the fallback target is right only because `VITE_API_URL` is unset locally: `docker-compose.yml` sets `VITE_API_URL=http://localhost:4000/api/v1`, so if a `.env` ever supplies it, requests become `/api/v1/api/v1/...`. It works today by accident.

### 🟡 M-4 — Credentials and tokens in `localStorage`
`Login.tsx:145` writes the **plaintext password** to `localStorage.lastLoginAttempt` and re-hydrates the form from it; `AuthContext` stores access/refresh tokens and the user object there too. Shared clinical workstations + any XSS = full account takeover. Your own `docs/SYSTEM_CHECK_AND_RECOMMENDATIONS.md` §3.2 recommends fixing this; it has not been fixed.

**Fix:** persist the username only, keep tokens in memory (or an httpOnly cookie for the refresh token), and clear on tab close.

### 🟡 M-5 — `run-migrations.ts` swallows failures
`scripts/run-migrations.ts:44-48` catches each migration error, logs it, and **continues**, then prints `🎉 All migrations completed`. A half-applied RBAC schema reports success. There is also no migration tracking table and no transaction per file, so re-runs are not idempotent in general. Meanwhile the README's manual `psql` list **omits `V2_0`** entirely (the script includes it).

### 🟡 M-6 — Error messages leak internals
Beyond C-2: `RbacGuard` returns the raw SQL `reason` string as the HTTP 403 `message`, and `effective-access.service.ts:139` embeds the exception text (`Authorization evaluation error: ${error.message}`) in the decision reason. Database identifiers and driver errors reach the browser.

### 🟡 M-7 — 1.42 MB un-split frontend bundle
Ant Design is imported wholesale (`App.tsx` pulls `ConfigProvider`, `App`, and every page imports tables/forms directly). Vite warns about it. No route-level `React.lazy`, no `manualChunks`.

### 🟡 M-8 — Two parallel API implementations drift
`mock-server.js` (986 lines) re-implements the API by hand and has already diverged: it has `/audit/*` (real backend does not), lacks `/cache/keys/:pattern` and several `/rbac/roles/:id/permissions` routes, and returns a different error envelope. Every backend change now has to be made twice. Consider replacing it with the real backend + a seeded SQLite/PG or a `MOCK_DATA=true` flag inside Nest, so there is one route table.

---

### 🔵 Low / hygiene

- `health.controller.ts` — `/health/ready` hard-codes `database: 'ok', redis: 'ok'` with `// TODO: actual DB check`. A readiness probe that cannot fail is worse than none.
- `GRANT EXECUTE ON FUNCTION rbac.evaluate_access TO PUBLIC` (V2_5) — any DB role can evaluate access for any user. Grant to the app role only.
- `trackUserRoles` does a JSON read-modify-write per role (`redis.service.ts`) — a lost-update race, and the 1 h TTL silently forces the "nuclear" full-cache flush on role invalidation. Use `SADD`/`SREM`.
- `delPattern` uses `DEL`; prefer `UNLINK` for non-blocking deletes.
- `X-Frame-Options: ALLOWALL` (`vite.config.ts`, `mock-server.js`) is not a valid token — browsers ignore it. To allow framing, simply omit the header (or use CSP `frame-ancestors`).
- `index.html` references `/vite.svg`; there is no `public/` directory → 404.
- `@types/uuid`, `pg`, `uuid`, `zustand` are unused or redundant (`pg` only serves the migration script; `uuid` isn't imported anywhere).
- No root `package.json` / workspace / concurrently script — running the stack means two terminals.
- `bcryptjs` (pure JS) is used instead of native `bcrypt`; at 12 rounds it is ~30% slower per hash. Fine, but worth a conscious choice.
- Dependency ranges are all `^` with no lockfile → non-reproducible installs (root cause of C-5's `npm ci` failure).
- Doc drift: root `ANALYSIS.md` describes a repo state from before any code existed; README says "frontend/ # TODO: React app" although the frontend is built and working; README's migration list omits `V2_0`.

---

## 5. What is genuinely good

Worth saying plainly, because the architecture is better than most RBAC implementations I see:

- **Authorization in one place.** A single SQL function decides; the guard, the UI hooks and the admin "effective access" debug page all read the same answer. No scattered `if (role === 'admin')`.
- **Deny-by-default** is real, not aspirational — missing rows deny, and the DB-error path in `EffectiveAccessService` explicitly fails closed (the mock layer in C-4 is what undermines it).
- **Temporal validity** (`effective_from`/`effective_to`) is threaded consistently through assignments, menu access and permissions — genuinely unusual and exactly right for shift-based clinical staffing.
- **Multi-role OR semantics** were identified as a bug (`V2_0` only checked `primary_role_id`), redesigned and fixed in `V2_5`, with the reasoning recorded in the README.
- **Cache design is thought through**: TTLs derived from the decision (short for ALLOW near temporal expiry, long for DENY), role→user tracking for precise invalidation, graceful degradation when Redis is down.
- **Audit trail** captures denials as first-class security events with reason, IP, session and request id.
- **TypeScript strict on the frontend, and it compiles clean**; the backend builds clean; the existing unit tests pass.
- **Documentation density** is exceptional — the V1 spec, the V2 spec, `REDIS_CACHING.md`, and three review docs. The team clearly writes down its reasoning.

---

## 6. Recommended order of work

**Stop-the-bleeding (before any demo to a stakeholder outside the team)**
1. C-2 — guard or delete `/auth/attempts*` and `/auth/reset-attempts`; strip `validUsernames` and `Demo: Password123!` from error bodies.
2. C-1 — remove the global lockout; move to Redis per-IP + per-username throttling.
3. C-4 — make `PrismaService` fail fast outside an explicit `MOCK_DATA=true`.
4. C-6 — add the missing `@RequirePermission` on `effective-access/:userId/evaluate` and pin `:userId` to the caller.
5. H-2 — require `JWT_SECRET`, delete the fallback string.

**Make it deployable (this week)**
6. C-5 — commit lockfiles, fix `tsconfig include` / `dist/src/main.js`, fix the `frontend/public` mount, then run `docker compose up` end-to-end once.
7. H-6 — add ESLint/Prettier configs and a GitHub Actions CI (install → lint → typecheck → build → test). This is what keeps 6 from regressing.
8. C-3 — add `AuditController`; bind `AuditInterceptor` + `AllExceptionsFilter` (M-1).
9. M-2 — one global `PrismaModule`; H-5 — Redis retry forever.

**Make it correct (next sprint)**
10. H-4 — real resource→unit data-scope enforcement, then un-skip the 5 integration tests against a real Postgres in CI (testcontainers or a service container).
11. H-1 — session-bound JWTs, refresh-token rotation, enforced absolute timeout.
12. H-3 — materialise or delete `vw_current_access_decisions`.
13. M-4 — stop persisting passwords/tokens in `localStorage`.
14. M-8 — collapse `mock-server.js` into the real backend behind a flag.

**Then the product**
15. The nursing domain is still empty: seed `organizations/departments/nursing_units/posts/shifts`, build out `NurseMaster` and `Roster` against real data, add credentials/expiry tracking, then code-split the bundle (M-7) and start load-testing `evaluate_access`.

---

## 7. Untracked artifacts left by this analysis

`backend/package-lock.json` and `frontend/package-lock.json` were generated by `npm install` while verifying the build (and `node_modules/`, `dist/`, which are already gitignored). **Recommendation: commit both lockfiles** — they are the fix for half of C-5. Delete them if you would rather introduce them deliberately in a separate change. No tracked file was modified.

> **Superseded:** both lockfiles are now committed on `arena/01a09094-nurse-app-v01`. See §8.

---
---

# 8. RE-BASELINE — your newer branch `arena/01a09094-nurse-app-v01`

**Added 2026-09-12.** Sections 1–7 above were written against `main` @ `4be0d7c`. You had pushed **9 more commits** to a branch that `main` does not contain, so I was reviewing stale code. This section is the corrected picture.

**Branch state found:**

| | |
|---|---|
| `arena/01a09094-nurse-app-v01` | `ac47104`, pushed 2026-09-11 19:03 UTC (22:03 Riyadh) |
| vs `origin/main` | **9 ahead, 0 behind** → clean fast-forward |
| Open PRs | **none** — this work is invisible to `main` and to CI |
| Delta | 37 files, **+20,491 / −128** |

**Action taken:** I fast-forwarded this session's branch (`arena/01a094a8-nurse-app-v01`) to `ac47104` so I could build, test and run your actual code. Nothing has been pushed to GitHub. Your two committed lockfiles replaced the ones I had generated (the backend one was byte-identical to mine).

## 8.1 What you added

**Nursing domain, Phase 1 — the biggest gap in my §6 item 15, now closed.**
- `V3_0__nursing_domain.sql`: new `nursing` schema, 5 guarded enums, `nurses` / `credentials` / `roster_assignments`, indexes, `COMMENT ON`, and `UNIQUE(nurse_id, assignment_date, shift_id)` to prevent double-booking. Idempotent throughout (`IF NOT EXISTS`, `DO $$ … duplicate_object`). This is well-written migration SQL.
- `V3_1` demo seed, `V3_2` personal fields (middle name, gender, DOB, nationality), `V3_3` **drops** `nurses.email` so the address has one owner (`auth.users.email`) — good normalisation instinct, and the migration documents *why*.
- `NursingModule` (777-line service + 206-line controller + 299 lines of DTOs + 452 lines of tests) and `UsersModule` (336 + 116 + 90 + 241). Both registered in `app.module.ts`.
- DTOs use `class-validator` properly (`@IsEmail`, `@MinLength(8)`, `@MaxLength`, `ParseIntPipe`, `DefaultValuePipe`) — confirmed live: a malformed `reset-password` body returns a precise 400.
- Frontend: `NurseMaster` rewritten (478 lines: search, pagination, CRUD, drawer), `Roster` rewritten (310: calendar + day detail), new `Credentials` (compliance radar), `Users` (485: create/edit/suspend/reset/unlock/sessions/history), plus `Contract` and `Documents` placeholders. New `useNursing` / `useUsers` hooks and 189 lines of types.
- Mock server: 986 → **1,709 lines, 49 routes**, with genuine parity work (per-user passwords, suspended users can't log in, 409 on duplicate username/email, soft-delete semantics).

**Four of my recommendations, implemented.**

| My finding | Status | Evidence |
|---|---|---|
| **H-6** no CI | ✅ **fixed** | `.github/workflows/ci.yml`: two jobs, `npm ci` → `prisma generate` → `tsc --noEmit` → `jest` (backend), `npm ci` → `tsc` → `build` (frontend) |
| **C-5** (part) no lockfiles | ✅ **fixed** | both committed; I verified `npm ci` succeeds in both apps |
| **Low** fake health checks | ✅ **fixed** | `PrismaService.healthCheck()` runs `SELECT 1`; `RedisService.healthCheck()` runs `PING`; `/health/ready` returns `ready` / `degraded` / `not_ready` and throws **503** when the DB genuinely errors. Verified live: `{"status":"degraded","checks":{"database":{"status":"mock"},"redis":{"status":"error"}}}` |
| **§6 item 15** nursing domain empty | ✅ **fixed** | see above |

`README.md` also gained an honest "Done Recently" section and a `DEMO/PREVIEW ONLY, never deploy` label on `mock-server.js`.

## 8.2 Re-verification of your code (all run just now)

| Check | Old | **Now** |
|---|---|---|
| `npm ci` backend / frontend | ❌ no lockfile | ✅ / ✅ |
| `tsc --noEmit` backend | ✅ | ✅ |
| `tsc --noEmit` frontend | ✅ | ✅ |
| `vite build` | ✅ 1,422 kB | ✅ **1,499 kB** (469 kB gzip) — still one chunk |
| `jest` | 8 pass / 5 skip | ✅ **34 pass / 5 skip**, 3 suites |
| Real backend boot | 30 routes | ✅ **54 routes** |
| `npm run lint` | ❌ | ❌ **still no ESLint/Prettier config** (and CI doesn't lint) |
| `docker compose build` | ❌ | ❌ **still fails** — `CMD ["node","dist/main.js"]` but output is `dist/src/main.js`; `tsconfig.json` still has no `include` |
| `/api/v1/audit/logs` | 404 | ❌ **still 404** — `AuditController` still doesn't exist, so the Audit Logs page still only works against the mock |

## 8.3 Findings that are unchanged

Confirmed by re-reading and re-running against `ac47104`:

- **C-1 global login lockout** — `auth.service.ts:19-21` untouched. Still 5 failures from anyone ⇒ every account locked 10 min.
- **C-2 unauthenticated `/auth/attempts*` and `/auth/reset-attempts`** — still no guard (re-tested: `POST /auth/reset-attempts` → **201** anonymously), still returns all 10 `validUsernames`, still says `Demo: Password123!`.
- **C-6 `POST /rbac/effective-access/:userId/evaluate`** — still has no `@RequirePermission` (`rbac.controller.ts:183`).
- **H-1** sessions still write-only; **H-2** JWT secret fallback still in `auth.module.ts:18` + `jwt.strategy.ts:25`; **H-3** `vw_current_access_decisions` still calls `evaluate_access()` twice per row across a 4-way CROSS JOIN; **H-5** Redis still `retryStrategy → null` after 10 attempts (re-observed: "retry limit exceeded, giving up"); **M-1** `AuditInterceptor`/`AllExceptionsFilter` still registered nowhere; **M-3** `changeOrigin` still misspelled; **M-4** password still persisted to `localStorage`; **M-5** migration runner still swallows errors; docker-compose still mounts the nonexistent `./frontend/public`.
- **M-2 is worse:** `PrismaService` is now a provider in **five** modules (auth, rbac, audit, nursing, users) ⇒ five instances / five pools.

## 8.4 🔴 New critical finding — the new admin surface is fully reachable by any nurse when the DB is down

Your new controllers are **correctly decorated** (`@CanView/@CanCreate/@CanEdit('USER_MANAGEMENT')`, `@RequirePermission(...resourceIdParam:'id')` on detail routes). That part is good work. The problem is what sits underneath: `RbacGuard` asks `PrismaService.$queryRawUnsafe('SELECT * FROM rbac.evaluate_access(...)')`, and in mock mode that returns **"Authorization granted: all checks passed (MOCK REAL BACKEND)"** for essentially everything.

I booted your backend with no Postgres and no Redis, logged in as `maria.garcia` (**RN**), and ran:

```
GET  /api/v1/users                      → 200  (full staff list, incl. failedLoginAttempts, lockedUntil)
POST /api/v1/users                      → 201  {"id":11,"username":"evil.nurse","primaryRole":{"code":"SYSTEM_ADMIN"}}
POST /api/v1/users/1/reset-password     → 201  {"message":"Password reset for admin.system"}
POST /api/v1/users/1/status             → 200  {"username":"admin.system","status":"Suspended"}
GET  /api/v1/users/1/login-history      → 200
POST /api/v1/rbac/effective-access/1/evaluate {"menuCode":"SYSTEM_SETTINGS","permissionCode":"MANAGE"} → 201 allowed:true
```

An RN can mint a SYSTEM_ADMIN account, reset the administrator's password and suspend the administrator — **with a DB outage as the only precondition**. Before this branch the blast radius was "reads a mock menu list"; now it is "owns the identity store." This is C-4 and C-6 compounding, and it is the first thing I would fix.

Two independent mitigations, either of which is enough:
1. Refuse to serve when the data layer is fake: in `PrismaService.onModuleInit`, `if (this.isMockMode() && process.env.ALLOW_MOCK_DATA !== 'true') throw` — and flip the mock `evaluate_access` default to **DENY**.
2. Add the missing `@RequirePermission` on `effective-access/:userId/evaluate`, and reject `:userId !== req.user.id` unless the caller holds `USER_MANAGEMENT/VIEW`.

## 8.5 🔴 New high finding — `mock-server.js` has no auth on 46 of its 49 routes

Only `/auth/logout`, `/auth/me` and `/auth/refresh-token` inspect the `Authorization` header (lines 615, 892, 925). Everything else — including writes — is anonymous:

```
GET    /api/v1/users                 (no token) → 200
DELETE /api/v1/nursing/nurses/1      (no token) → 200   # soft-deletes the nurse
```

Your README says "mock auth realism: `/auth/me` now strict 401" — true, but it's the only strict route. Since the mock binds `0.0.0.0:4000` and this sandbox publishes it as a public preview URL, anyone with that URL can read the whole staff list and mutate nursing data without a token. Add one `requireMockAuth` middleware in front of `/api/v1/{users,nursing,rbac,cache,audit}` and the gap closes in ~15 lines.

## 8.6 Two smaller new notes

- **`H-4` data scope is now load-bearing and still a stub.** `nursing.service.ts` accepts `unitId` only as an *optional caller-supplied filter* (`:79`, `:442`) — nothing intersects the caller's `user_data_scopes` with the record's unit. `resourceIdParam:'id'` is dutifully passed to `evaluate_access`, which still only checks that *some* scope row exists. So `NURSE_MASTER/VIEW` = every nurse in every unit. Fix the SQL function, then filter `listNurses`/`listRoster` by the caller's scope server-side (never trust a query param for this).
- **`COUNTRIES` is a 200-name hardcoded array inside `nursing.service.ts`** — including `'Saudi'` (should be `Saudi Arabia`) and `'Palestine'`/`'Syria'` spellings that will need review for a KSA deployment. This belongs in a lookup table or an ISO-3166 package, not in a service file.

## 8.7 Revised priority list

1. **C-4 + §8.4** — fail fast when `PrismaService` is in mock mode; mock `evaluate_access` defaults to DENY. *(biggest real-world risk, ~20 lines)*
2. **C-2** — guard/delete `/auth/attempts*` + `/auth/reset-attempts`; strip `validUsernames` and the `Password123!` hint.
3. **§8.5** — one auth middleware for the mock server's 46 open routes.
4. **C-6** — decorate `effective-access/:userId/evaluate`; pin `:userId` to the caller.
5. **C-1** — replace the global lockout with Redis per-IP + per-username throttling.
6. **C-5** — `"include": ["src"]` in `backend/tsconfig.json` (or `entryFile` in `nest-cli.json`) + fix the Dockerfile CMD, then run `docker compose up` once end-to-end.
7. **C-3 + M-1** — add `AuditController`; bind `AuditInterceptor` and `AllExceptionsFilter` via `APP_INTERCEPTOR`/`APP_FILTER`.
8. **M-2** — one `@Global() PrismaModule` instead of five provider registrations.
9. **H-4** — real data-scope enforcement in SQL *and* in the nursing queries; then un-skip the 5 integration tests in CI with a Postgres service container (your workflow already exists — adding `services: postgres:15` is a small change and would make those 5 tests real).
10. **H-6 remainder** — add ESLint configs and a `lint` step to `ci.yml`; the workflow currently can't catch style/dead-code regressions.
11. **Merge the branch.** `arena/01a09094-nurse-app-v01` is 9 ahead / 0 behind `main` with no PR open, so **CI has never run on it** (`on: push|pull_request → branches: [main]`). Opening a PR would exercise the workflow you just wrote for the first time.
