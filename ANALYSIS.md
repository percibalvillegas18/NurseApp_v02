# Nurse-App_v01 - Deep Repository Analysis
**Date:** 2026-09-11  
**Branch:** arena/01a08f14-nurse-app-v01  
**Commit:** 7583a49 "Add files via upload"  
**Analyst:** Arena Agent

---

## 1. Repository Snapshot

```
Nurse-App_v01/
├── README.md (15 bytes, placeholder)
├── Hospital-RBAC-Complete-Documentation-v1.0.md (76,711 bytes)
└── Effective Access Function + Role Model + Tests + Real Data.txt (62,363 bytes)
```

- **Git history:** 1 commit on main, 0 code commits
- **Working tree:** clean, no source code, no package.json, no Dockerfile, no migrations folder, no backend/frontend scaffolding
- **State:** Documentation-only repo, pre-implementation Phase 0

This is not yet an app. It's a spec dump for a Hospital RBAC system intended to underpin a Nurse Workforce Management App.

---

## 2. Document Inventory

### 2.1 Doc A: `Hospital-RBAC-Complete-Documentation-v1.0.md`
Claims 500+ pages, ~50k words. Structure:

- **Part 1 - Logical Blueprint:** AccessLevel, Menu, Permission, RoleMenuAccess, RolePermission, UserDataScope, EffectiveAccess, Audit
- **Part 2 - Physical Data Model:** Schemas `auth`, `rbac`, `audit`, `system`; tables for users, sessions, access_levels, menus, permissions, role_menu_access, role_permissions, org hierarchy (organizations, departments, nursing_units, posts, shifts), user_data_scopes, audit_logs
- **Part 3 - SQL Implementation:** V1_0 initial schema, V1_1 system tables, seed data, audit triggers, `get_user_effective_access()` simple version
- **Part 4 - REST API Spec:** Auth endpoints, RBAC CRUD, effective-access evaluation, audit logs, error codes
- **Part 5 - Dev Env & Arch:** Stack proposal (Node 18/20 + Express/NestJS + Prisma/TypeORM + PG 14+ + Redis 7+ + Docker), docker-compose, repo structure
- **Part 6 - Roadmap:** 5 phases / 20 weeks (Foundation, RBAC Core, Advanced, Testing, Prod)
- **Part 7 - Quick Ref:** curl examples, troubleshooting, maintenance
- **Appendices:** Glossary, security checklist, deployment checklist, env vars, monitoring

**Approved Roles (old model):** Administrator, Moderator, User-01, User-02, User-03, Guest  
**Approved Access Levels:** FULL, MGMT, STD, READ, RESTRICTED  
**Permissions:** VIEW, CREATE, EDIT, DELETE, APPROVE, EXPORT, MANAGE, ASSIGN, VERIFY, SUBMIT, REJECT, REVIEW

### 2.2 Doc B: `Effective Access Function + Role Model + Tests + Real Data.txt`
1715 lines, Phase 0 Critical Implementation. Much more mature:

- **V2_0__effective_access_function.sql:** Authoritative `rbac.evaluate_access(p_user_id, p_menu_code, p_permission_code, p_resource_id)` returning ALLOW/DENY with reason, menu_accessible, permission_granted, data_scope_valid, cache_ttl, evaluated_at, user_role. Implements:
  - AND-Logic: User Active AND Menu Active+accessible AND Permission Active+granted AND DataScope valid AND temporal checks
  - Deny by default
  - Temporal filtering (effective_from/to)
  - Functions: `get_user_full_access()`, `preview_access_change()`, view `vw_current_access_decisions`, indexes, grants
- **V2_1__role_model_redesign.sql:** New tables `system.hospital_roles` and `auth.user_role_assignments`, drops `users.role` and `access_level`, adds `primary_role_id`, views `vw_user_current_roles`, helpers `get_user_primary_role()`, `get_user_all_roles()`, `assign_role_to_user()`
- **V2_2__rbac_tables_role_updates.sql:** Migrate `role_menu_access` and `role_permissions` to use `role_code` FK to hospital_roles
- **V2_3__seed_hospital_roles_and_users.sql:** Real roles: RN, LPN, CNA, CHARGE_NURSE, NURSE_MANAGER, SCHEDULER, HR_ADMIN, COMPLIANCE_OFFICER, SYSTEM_ADMIN, READONLY_USER + 10 real users (admin.system, susan.lee, james.wilson, maria.garcia, ahmed.hassan, jennifer.smith, david.kim, rachel.brown, patricia.johnson, michael.wong)
- **Test Suite Outline:** 50+ tests in 8 suites: AND-logic, temporal filtering, deny-by-default, role scenarios, data scope, user status, caching, full matrix, performance benchmarks
- **Checklist & Validation Queries**

**This is the authoritative spec.** Doc A is legacy V1, Doc B is V2 Phase 0 redesign.

---

## 3. Core Domain Model (Synthesized)

### Auth Schema
- `users`: id, username, email, password_hash, full_name, primary_role_id FK → hospital_roles, status (Active/Inactive/Suspended/PendingVerification), email_verified, failed_login_attempts, locked_until, audit cols
- `user_role_assignments`: user_id, role_id, assigned_by, effective_from/to, reason, status
- `sessions`: id, user_id, ip, user_agent, login_at, last_activity, expires_at, absolute_timeout, status

### System Schema
- `hospital_roles`: code PK (RN, CHARGE_NURSE...), name, description, category (Clinical/Administrative/System/Support), department, assignable_by_roles[], is_exclusive, status
- (Legacy) `user_roles`: Administrator, Moderator, User-01...

### RBAC Schema
- `access_levels`: code, name, priority, default_menu_behavior, default_permission_set JSONB
- `menus`: code unique, name, parent_menu_id self-ref, display_order, route, icon, is_functional, is_external_link, status
- `permissions`: code unique, name, category (Standard/Administrative/Workflow/Sensitive), risk_level (Low/Med/High/Critical)
- `role_menu_access`: role_code FK, menu_id FK, visible, enabled, assignment_source (AccessLevelDefault/ManualOverride/SystemDefault), override_flag, effective_from/to, status, UK(role_code, menu_id)
- `role_permissions`: role_code, menu_id, permission_id, allowed, source, override_flag, effective_from/to, status, UK(role_code, menu_id, permission_id)
- Org hierarchy: `organizations` → `departments` → `nursing_units` → `posts`, plus `shifts`
- `user_data_scopes`: user_id, scope_type (Hospital/Department/NursingUnit/Post/Shift/Assigned/All), org/dept/unit/post/shift ids, assignment_rule, assignment_rule_config JSONB, effective_from/to, status

### Audit Schema
- `audit_logs`: user_id, username, action, entity_type, entity_id, entity_code, description, changes JSONB, reason, ip, user_agent, session_id, status (Success/Failure/Denied), RLS prevents UPDATE/DELETE

---

## 4. Effective Access Decision Engine (Critical)

**Function:** `rbac.evaluate_access(user_id, menu_code, perm_code, resource_id?)`

**Algorithm:**
1. User exists? Active? Has primary_role?
2. Menu exists? Active?
3. RoleMenuAccess exists? visible AND enabled? temporal bounds valid?
4. Permission exists? Active?
5. RolePermission exists? allowed? temporal bounds valid?
6. If resource_id provided: user_data_scopes has Active valid scope?
7. All pass → ALLOW else DENY with specific reason

**Decision Matrix:**
| Menu | Perm | Scope | Result |
|------|------|-------|--------|
| YES | YES | YES | ALLOW |
| ANY NO | - | - | DENY |

**Cache TTL Guidance:** ALLOW → 300s (5min) due to temporal expiry risk; DENY → 1800s (30min)

**View:** `get_user_full_access(user_id)` returns cross join menus x permissions with COALESCE accessible/allowed booleans – for building dashboards.

**Strengths:** Single source of truth, explicit deny-by-default, audit-friendly reason field, temporal support, data scope placeholder.

**Weaknesses / TODOs in spec:**
- Only checks primary_role, ignores multi-role assignment (auth.get_user_all_roles exists but not used in evaluate_access). Real need: evaluate across all active roles with OR logic, or enforce primary only – spec inconsistent.
- Data scope validation is stub: `COUNT(*) >0` → valid. No resource-type specific logic. For nurse master, should check if resource's unit is within user's scopes.
- `preview_access_change` is stub, not implemented.
- No RLS enforcement at DB layer beyond function.
- Performance: view `vw_current_access_decisions` calls evaluate_access per row (CROSS JOIN) – will explode (users * menus * perms). Materialized view would be needed.
- Password hashes in seed are fake `$2b$10$abcdef...` – not real bcrypt.
- `assign_role_to_user` only allows SYSTEM_ADMIN, hardcoded – no RBAC check using new model.

---

## 5. Contradictions & Migration Debt

| Area | V1 (Doc A) | V2 (Doc B) | Impact |
|------|------------|------------|--------|
| User role | `users.role VARCHAR(50)` FK to `system.user_roles` (Administrator...) | `users.primary_role_id BIGINT` FK to `hospital_roles` + `user_role_assignments` many-to-many | Breaking migration, no script to migrate existing users |
| Role identifier | `role_menu_access.role_id VARCHAR(50)` | `role_menu_access.role_code VARCHAR(50)` FK to hospital_roles.code | Column rename + FK change, data loss risk |
| Access Levels | Central concept, drives defaults | Not mentioned in V2, seems deprecated but menus still have access_level field | Unclear if FULL/MGMT/STD/READ/RESTRICTED still used |
| Effective Access | Simple join, no temporal, no DENY reason | Full PL/pgSQL function with AND logic, temporal, reason | V1 function must be dropped |
| Org model | Mentioned but not seeded | Same tables, but seed only roles/users, not org hierarchy | V2_4 seed missing |
| Test | Not defined | 50+ tests outlined but not implemented | No coverage |

**Conclusion:** V2 is a hard redesign, not additive. Requires V2_0 to V2_4 migrations to be run in order, but repo has no migrations folder.

---

## 6. Security Analysis

**Good Practices in Spec:**
- bcrypt 10+ rounds, JWT 1h + refresh 7d, session absolute timeout 24h, lockout after 5 fails, password reset 15min
- Deny by default, backend enforcement (not just UI hiding)
- Immutable audit log via RLS
- Audit all config changes, access denials, override reasons
- At least 1 active Admin protection
- TLS enforced, no PII in audit, sensitive fields encrypted

**Gaps / Risks:**
- No MFA / 2FA spec
- No password complexity rules defined
- No rate limiting implementation details (just says 100 req/min)
- No secret management (JWT secrets in env example are weak)
- No row-level security for data scope – relies on app to filter, easy to bypass
- No mention of SQL injection protection (ORM helps but not explicit)
- No CORS origin validation beyond example
- No encryption at rest for PII (full_name, email)
- Audit log has no partitioning strategy – will grow huge, queries slow
- No GDPR / HIPAA considerations for hospital data (required for US)
- No vulnerability scanning in pipeline

---

## 7. What is Missing for a Real Nurse-App?

The RBAC spec is thorough, but the actual Nurse App domain is barely defined:

- **Nurse Master:** No table for nurses (should be separate from users? Or users = nurses?)
- **Scheduling:** Roster, shift assignment, leave requests, float pool – only menu names mentioned
- **Credentials / Certifications:** Menu mentions but no tables
- **Workforce Analytics:** No spec
- **Frontend:** No wireframes, no React/Vue components
- **Backend:** No NestJS modules, no controllers, no services, no DTOs
- **DevOps:** No Dockerfile, no docker-compose.yml, no CI/CD, no Terraform
- **Docs:** No OpenAPI/Swagger file, no Postman collection

Essentially, the repo has the foundation for auth, but 90% of product is missing.

---

## 8. Recommended Implementation Roadmap (Pragmatic)

### Immediate: Phase 0 Foundation (2 weeks) – as spec says BLOCKING

1. **Scaffold Monorepo:**
   ```
   /backend
     /src
       /modules/auth, rbac, audit, nursing, scheduling
       /database/migrations (Flyway style V1_0...V2_4)
       /common/guards, decorators, interceptors
     package.json, Dockerfile, .env.example
   /frontend
     /src/pages, components, services
   docker-compose.yml (postgres 14, redis 7, pgadmin)
   /docs
   ```

2. **Implement Migrations V1_0 to V2_4 exactly as spec, but fix TODOs:**
   - V1_0: schemas, types, base tables
   - V2_0: evaluate_access with multi-role support (change to check ANY active role, not just primary)
   - V2_1: hospital_roles + user_role_assignments + primary_role_id
   - V2_2: role_code migration
   - V2_3: real seed with proper bcrypt hashes (generate via script)
   - V2_4: org hierarchy seed + role_menu_access + role_permissions matrix for 10 roles x ~20 menus x 12 perms
   - Add V2_5: proper data scope validation (resource type aware)

3. **Backend MVP (NestJS + Prisma):**
   - AuthService: login, JWT, refresh, session Redis
   - RbacService: evaluateAccess, getUserFullAccess, preview
   - Guard: @RequirePermission(menu, perm) that calls evaluate_access
   - AuditService + interceptor
   - Endpoints as per Part 4 spec

4. **Testing:** Implement Jest tests from outline – 50+ tests, >95% coverage for evaluate_access

### Phase 1: Nurse Domain (4 weeks)
- Tables: nurses, credentials, certifications, rosters, leave_requests
- CRUD APIs with data scope enforcement
- Frontend: Nurse Master list, roster calendar, leave management

### Phase 2: Scheduling & Analytics (4 weeks)
- Scheduling engine, conflict detection, float pool
- Analytics dashboards

### Phase 3: Hardening (2 weeks)
- Security scan, load test 1000 RPS, RLS, partitioning audit_logs, MFA

---

## 9. Proposed Tech Stack (Aligned with Spec but Modernized)

- **Runtime:** Node 20 LTS, TypeScript 5
- **Backend Framework:** NestJS 10 (better than raw Express for guards/decorators)
- **ORM:** Prisma (migrations, type safety) – or TypeORM if need complex queries for evaluate_access raw SQL
- **DB:** PostgreSQL 15, Redis 7
- **Auth:** Passport JWT, bcrypt 12 rounds
- **Validation:** class-validator + class-transformer
- **Testing:** Jest + Supertest + pg-mem for unit, real PG for integration
- **Frontend:** React 18 + Vite + TanStack Query + Ant Design / MUI + React Router
- **DevOps:** Docker Compose for local, GitHub Actions CI, Flyway or Prisma Migrate

---

## 10. Immediate Action Items for Repo Owner

- [ ] Decide: Keep V1 roles (Administrator/Moderator/User-01) or fully migrate to hospital roles (RN, Charge Nurse...)? Recommend V2 only – archive V1 docs to /docs/legacy.
- [ ] Generate real bcrypt hashes for seed users – don't commit fake hashes
- [ ] Implement missing V2_4 seed (menus, permissions, role_menu_access, role_permissions, org hierarchy)
- [ ] Fix evaluate_access to support multiple roles (OR logic across all active assignments)
- [ ] Implement proper data scope validation (switch on menu_code → check resource's org/dept/unit)
- [ ] Create backend scaffold with `npm init` and migrations folder
- [ ] Add `.gitignore`, `docker-compose.yml`, `README.md` with setup instructions
- [ ] Add CI workflow for tests

---

## 11. Risk Assessment

**HIGH:**
- No code = no product – 20-week roadmap is optimistic without team
- evaluate_access as sole authz source – bug = security bypass – needs exhaustive tests + audit
- Data scope stub = horizontal privilege escalation risk

**MEDIUM:**
- Audit log immutability via RLS only – superuser can still delete – need trigger + separate audit DB
- No MFA for hospital system – compliance failure for HIPAA

**LOW:**
- Documentation duplication causes confusion – consolidate into single source of truth

---

## 12. Conclusion

The repo contains a **well-thought-out, production-grade RBAC design** with a critical Phase 0 implementation spec that is **solid in theory but incomplete in practice**. The effective access function design with AND-logic, deny-by-default, temporal filtering is **industry best practice**. The role model redesign from generic User-01 to real hospital roles (RN, Charge Nurse, Nurse Manager) is **correct and necessary**.

However, **zero implementation exists**. To become a Nurse-App, you must:

1. Execute Phase 0 migrations and fix TODOs
2. Scaffold backend/frontend
3. Build nurse workforce domain on top of RBAC
4. Harden security and compliance

**Next Step Recommendation:** Start by scaffolding backend and implementing V2_0..V2_4 migrations with real tests. I can generate that scaffold for you if you want.

---
*End of Analysis*
