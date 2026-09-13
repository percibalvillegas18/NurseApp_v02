# Nurse-App Frontend

React 18 + Vite + TanStack Query + Ant Design + React Router + Zustand

## Features

- **RBAC-Aware UI**: All menu visibility and button enablement via `useEffectiveAccess` hooks that call backend `rbac.evaluate_access()`
- **Protected Routes**: `ProtectedRoute` component checks `menuCode + permissionCode` via `usePermission` hook
- **Multi-Role Support**: Displays all active roles (RN, CHARGE_NURSE, etc.) with OR logic
- **Effective Access Debug**: Page to evaluate any user/menu/permission combination and see ALLOW/DENY reason, cache TTL, roles
- **Audit Logs**: Immutable audit trail viewer
- **Role Management**: View and override role_menu_access with ManualOverride tracking

## Pages

- `/login` - Login with demo accounts (Password: Password123!)
- `/dashboard` - Stats, roster, access summary, full matrix debug
- `/nursing/master` - Nurse Master with VIEW/CREATE/EDIT/DELETE permission checks
- `/scheduling/roster` - Roster calendar with ASSIGN permission
- `/admin/rbac` - Hospital roles + menu access override (MANAGE required)
- `/admin/effective-access` - Evaluate any access, preview impact
- `/admin/audit` - Audit logs with filters
- `/403` - Forbidden (when backend guard denies)
- `/404` - Not found

## Hooks

### `useEffectiveAccess`
Core RBAC hooks:

```tsx
// Get accessible menus for current user (for navigation)
const { data: menus } = useAccessibleMenus();

// Get full access matrix
const { data: fullAccess } = useUserFullAccess(userId);

// Evaluate specific permission
const { allowed, decision, isLoading } = usePermission('NURSE_MASTER', 'EDIT', resourceId);

// Evaluate multiple
const { data: checks } = usePermissions([
  { menuCode: 'NURSE_MASTER', permissionCode: 'VIEW' },
  { menuCode: 'NURSE_MASTER', permissionCode: 'EDIT' },
]);

// Preview impact
const previewMutation = usePreviewAccessChange();
previewMutation.mutate({ userId, changeType: 'PERMISSION_GRANT', menuId, permissionId, proposedAllowed: true });
```

**Important:** Backend `RbacGuard` is authoritative. Frontend hiding is UX only. All API calls still enforce backend check and log ACCESS_DENIED to audit.

### `useAuth`
```tsx
const { user, isAuthenticated, login, logout } = useAuth();
```

## API Client

`src/api/client.ts` - Axios with JWT interceptor, refresh token logic, x-request-id, x-session-id headers.

- Auto adds `Authorization: Bearer <token>`
- On 401, tries refresh token, then logout
- All requests proxied via Vite proxy `/api` -> `http://localhost:4000`

## Quick Start

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
# http://localhost:3000
```

### With Docker

```bash
# From repo root
docker-compose up -d postgres redis backend
cd frontend && npm run dev
# Or build frontend container (add to docker-compose)
```

## Env

```
VITE_API_URL=http://localhost:4000/api/v1
```

## Build

```bash
npm run build
npm run preview
```

## Demo Accounts

Password for all: `Password123!`

| Username | Role | Access |
|----------|------|--------|
| admin.system | SYSTEM_ADMIN | Full |
| susan.lee | NURSE_MANAGER | Broad |
| james.wilson | CHARGE_NURSE | Clinical + scheduling |
| maria.garcia | RN | Limited |
| rachel.brown | SCHEDULER | Scheduling |
| patricia.johnson | HR_ADMIN | Users + creds |

## RBAC Integration

- **AppLayout** builds menu from `useAccessibleMenus()` which calls `GET /rbac/menus/hierarchy?accessibleOnly=true` which uses `role_menu_access` with multi-role OR logic
- **ProtectedRoute** calls `usePermission(menuCode, permissionCode)` which calls `POST /rbac/effective-access/:userId/evaluate`
- **NurseMaster** shows buttons only if `canCreate`, `canEdit` etc.
- **Roles** page allows MANAGE override, sets `assignment_source=ManualOverride`, `override_flag=true`

## Next Steps

- Add Zustand store for roster, nurses
- Add real nurse master CRUD with data scope enforcement
- Add WebSocket for real-time roster updates
- Add i18n (Arabic for SA)
- Add PWA
- Add unit tests for hooks

## Security Notes

- Never trust frontend permission checks alone - backend guard is required
- Audit all DENY events
- Cache TTL: ALLOW 300s, DENY 1800s, expiring soon 60s
- Multi-role OR logic means user with RN + CHARGE_NURSE gets union of permissions
