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
| Lockfiles | **None committed** |
| CI | **None** (`.github/` does not exist) |
| Tests | 1 spec file (13 cases: 8 pass, 5 hard-skipped) |

**Stack**
- **Backend:** NestJS 10 + Prisma 5 + raw PL/pgSQL, PostgreSQL 15, Redis 7 (ioredis), JWT via passport-jwt, bcryptjs.
- **Frontend:** React 18 + Vite 5 + TypeScript (strict) + Ant Design 5 + TanStack Query 5 + react-router 6.
- **Infra:** docker-compose.yml (postgres, redis, pgadmin, backend, frontend), multi-stage Dockerfiles, nginx SPA config.

---

## 2. Critical Findings (🔴)

### C-1 — Global login lockout is a one-request DoS
5 failed logins from anyone lock every account for 10 minutes. In-process memory only — not shared between instances, lost on restart.
**Fix:** per-IP + per-username Redis counter instead.

### C-2 — Unauthenticated endpoints disclose the user list
`GET /auth/attempts`, `GET /auth/attempts/:username`, `POST /auth/reset-attempts` have no guard. Error bodies expose all usernames and `Demo: Password123!`.
**Fix:** guard or delete; use a single generic error message.

### C-3 — `/audit/logs` does not exist on the real backend
`AuditController` was never created. The Audit Logs page only works against the mock server.
**Fix:** add `audit.controller.ts` and register it in `AuditModule`.

### C-4 — PrismaService fails OPEN on authorization
When DB is unavailable, the service silently falls back to mock mode which returns ALLOW for essentially all RBAC checks.
**Fix:** throw on init in production (`NODE_ENV=production` or `ALLOW_MOCK_DATA !== 'true'`).

### C-5 — Docker image cannot start; npm ci cannot run
Dockerfile uses `CMD ["node", "dist/main.js"]` but `nest build` outputs to `dist/src/main.js`. No lockfiles committed.
**Fix:** add `"include": ["src"]` to tsconfig; fix Dockerfile CMD; commit lockfiles.

---

## 3. High Findings (🟠)

- **H-1** Sessions are write-only (no read/revoke UI)
- **H-2** JWT secret has an insecure fallback in source code
- **H-3** `vw_current_access_decisions` calls `evaluate_access()` twice per row across a 4-way CROSS JOIN
- **H-4** Data scope validation is a stub (COUNT > 0 only)
- **H-5** Redis `retryStrategy → null` after 10 attempts — gives up silently
- **H-6** No CI, no ESLint/Prettier config

---

## 4. New Critical (Post-merge, §8.4)

**New admin surface fails open when DB is down.**
An RN with no DB connected can: create a SYSTEM_ADMIN account, reset the admin password, suspend the admin. Root cause: C-4 + missing `@RequirePermission` on `effective-access/:userId/evaluate`.

**Fix priority order:**
1. `PrismaService` fail-fast in production + mock `evaluate_access` defaults to DENY
2. Guard `/auth/attempts*` + strip username/password hints
3. Auth middleware on mock server's 46 unguarded routes
4. Decorate `effective-access/:userId/evaluate`
5. Replace global lockout with Redis per-IP throttle
6. Fix Dockerfile CMD + tsconfig include
7. Add `AuditController`
8. One `@Global() PrismaModule` instead of 5 registrations
9. Real data-scope enforcement in SQL + nursing queries
10. Add ESLint + lint step to CI
