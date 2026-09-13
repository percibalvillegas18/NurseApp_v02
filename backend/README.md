# Nurse-App Backend - Hospital RBAC System

NestJS + Prisma + PostgreSQL + Redis implementation of Hospital Nursing Workforce Management RBAC.

## Architecture

- **Auth Module**: JWT, sessions, login, refresh, logout, bcrypt 12 rounds
- **RBAC Module**: Effective access evaluation, role-menu-access, role-permissions, data scopes
- **Audit Module**: Immutable audit logs with RLS
- **Effective Access Engine**: `rbac.evaluate_access()` SQL function is single source of truth

## Quick Start

### Prerequisites
- Node.js 20 LTS
- Docker & Docker Compose
- PostgreSQL 15 (via Docker)
- Redis 7 (via Docker)

### 1. Clone and install
```bash
cd backend
npm install
cp .env.example .env.development
```

### 2. Start infrastructure
```bash
# From repo root
docker-compose up -d postgres redis pgadmin

# Wait for healthy
docker-compose ps
```

### 3. Run migrations (raw SQL)
```bash
# Using psql
export DATABASE_URL=postgresql://devuser:devpassword@localhost:5432/hospital_rbac_dev
psql $DATABASE_URL -f database/migrations/V1_0__initial_schema.sql
psql $DATABASE_URL -f database/migrations/V1_1__system_tables.sql
psql $DATABASE_URL -f database/migrations/V2_1__role_model_redesign.sql
psql $DATABASE_URL -f database/migrations/V2_2__rbac_tables_role_updates.sql
psql $DATABASE_URL -f database/migrations/V2_3__seed_hospital_roles_and_users.sql
psql $DATABASE_URL -f database/migrations/V2_4__seed_rbac_configuration.sql
psql $DATABASE_URL -f database/migrations/V2_5__fix_evaluate_access_multirole.sql

# Or use Prisma migrations (after raw SQL for functions)
npx prisma migrate dev --name init
npx prisma generate
```

### 4. Seed via Prisma (alternative to SQL seed)
```bash
npm run prisma:seed
```

### 5. Start backend
```bash
npm run start:dev
# API at http://localhost:4000/api/v1
```

### 6. Test auth
```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin.system","password":"Password123!"}'

# Use token
TOKEN=<from response>
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/v1/rbac/menus/hierarchy?accessibleOnly=true
```

## API Endpoints

### Auth
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout` (JWT)
- `POST /api/v1/auth/refresh-token`
- `GET /api/v1/auth/me` (JWT)

### RBAC
- `GET /api/v1/rbac/access-levels`
- `POST /api/v1/rbac/access-levels` (MANAGE)
- `GET /api/v1/rbac/menus`
- `GET /api/v1/rbac/menus/hierarchy?accessibleOnly=true`
- `GET /api/v1/rbac/permissions`
- `GET /api/v1/rbac/roles/:roleId/menu-access`
- `PATCH /api/v1/rbac/roles/:roleId/menu-access/:menuId` (MANAGE)
- `GET /api/v1/rbac/roles/:roleId/permissions`
- `PATCH /api/v1/rbac/roles/:roleId/permissions/:permissionId?menuId=1` (MANAGE)
- `GET /api/v1/rbac/users/:userId/data-scopes`
- `POST /api/v1/rbac/users/:userId/data-scopes` (MANAGE)
- `GET /api/v1/rbac/effective-access/:userId`
- `POST /api/v1/rbac/effective-access/:userId/evaluate`
- `POST /api/v1/rbac/effective-access/:userId/preview` (MANAGE)

## Effective Access Function - Fixed Version

### Problem with V2_0
- Only checked `primary_role_id`, ignored `user_role_assignments` many-to-many
- Data scope validation was stub (COUNT>0)
- No OR logic for multi-role

### Fix in V2_5
```sql
-- Get ALL active roles
SELECT ARRAY_AGG(DISTINCT hr.code) INTO v_all_role_codes
FROM auth.user_role_assignments ura
JOIN system.hospital_roles hr ON hr.id = ura.role_id
WHERE ura.user_id = p_user_id AND ura.status='Active' AND temporal valid;

-- Check ANY role grants access (OR logic)
SELECT BOOL_OR(rma.visible AND rma.enabled) FROM rbac.role_menu_access rma
WHERE rma.role_code = ANY(v_all_role_codes) ...

SELECT BOOL_OR(rp.allowed) FROM rbac.role_permissions rp
WHERE rp.role_code = ANY(v_all_role_codes) ...
```

- Now supports users with multiple roles (e.g., RN + CHARGE_NURSE during shift)
- Proper cache TTL reduction when temporal bounds near expiry
- Returns `user_roles TEXT[]` for audit

## Security

- Passwords bcrypt 12 rounds
- JWT 1h expiry, refresh 7d
- Account lockout after 5 fails (15 min)
- RLS on audit_logs prevents DELETE/UPDATE
- RBAC Guard enforces backend (UI hiding is cosmetic only)
- Deny by default
- Audit all config changes and ACCESS_DENIED

## Testing

```bash
npm run test
npm run test:cov
```

Test suite covers:
- AND-logic validation
- Temporal filtering
- Deny by default
- Role scenarios (RN vs Charge vs Manager vs Admin)
- Data scope enforcement
- User status validation
- Caching
- Full matrix
- Performance (<50ms per decision, <500ms full matrix)

## Default Users (Password: Password123!)

| Username | Role | Scope |
|----------|------|-------|
| admin.system | SYSTEM_ADMIN | Hospital Central |
| susan.lee | NURSE_MANAGER | Department ICU |
| james.wilson | CHARGE_NURSE | Unit ICU_A |
| maria.garcia | RN | Unit ICU_A |
| ahmed.hassan | RN | Unit ICU_A |
| jennifer.smith | LPN | Unit ICU_A |
| david.kim | CNA | Unit ICU_A |
| rachel.brown | SCHEDULER | Hospital Central |
| patricia.johnson | HR_ADMIN | All |
| michael.wong | COMPLIANCE_OFFICER | All |

## Next Steps

- [ ] Implement nursing domain (nurses, credentials, rosters)
- [ ] Add Redis caching for evaluate_access (with invalidation on config change)
- [ ] Add MFA
- [ ] Partition audit_logs by month
- [ ] Implement resource-specific data scope validation (nurse's unit must be in user's scopes)
- [ ] Frontend React app
- [ ] Load testing 1000 RPS

## Troubleshooting

**User cannot access menu:**
```sql
SELECT * FROM rbac.evaluate_access(1, 'USER_MANAGEMENT', 'VIEW');
SELECT * FROM auth.vw_user_current_roles WHERE user_id=1;
SELECT * FROM rbac.role_menu_access WHERE role_code='RN';
```

**Performance:**
```sql
EXPLAIN ANALYZE SELECT * FROM rbac.evaluate_access(1, 'NURSE_ROSTER', 'VIEW');
```

## License
Proprietary - Hospital Use Only
