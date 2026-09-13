# PHI Read Auditing

**HIPAA:** § 164.312(b) Audit Controls — record access to systems that contain or use ePHI.

## What is logged

Authenticated **GET** requests to nursing resources that expose workforce PHI (or strong personal identifiers used in healthcare operations):

| Path pattern | Entity type | Example actions |
|--------------|-------------|-----------------|
| `/api/v1/nursing/nurses` | `Nurse` | `VIEW_NURSE` |
| `/api/v1/nursing/nurses/:id` | `Nurse` | `VIEW_NURSE` |
| `/api/v1/nursing/nurses/:id/credentials` | `NurseCredential` | `VIEW_NURSECREDENTIAL` |
| `/api/v1/nursing/credentials/*` | `Credential` | `VIEW_CREDENTIAL` |
| `/api/v1/nursing/roster` | `RosterAssignment` | `VIEW_ROSTERASSIGNMENT` |

Failed reads are logged as `FAILED_VIEW_*` with status `Failure`.

Mutating methods (POST/PUT/PATCH/DELETE) continue to be audited as before.

## What is intentionally **not** logged

- **Response bodies** — would duplicate ePHI into the audit store. Only metadata is stored: user, action, entity type/id, path, sanitized query/params, IP, user-agent, session, outcome, duration.
- `/nursing/lookups` — reference data only.
- `/auth/*` — handled by `AuthService` (avoids double-logging and credential material).
- Unauthenticated requests — no user context; rejected by JWT guard before meaningful PHI access.

## Implementation

- Global `AuditInterceptor` (`backend/src/common/interceptors/audit.interceptor.ts`)
- Registered in `AppModule` via `APP_INTERCEPTOR`
- Writes go through `AuditService.log()` → append-only `audit.audit_logs` (hash chain via V3_5)

## Query examples

```sql
-- Who viewed nurse 42?
SELECT created_at, username, action, ip_address, changes
FROM audit.audit_logs
WHERE entity_type = 'Nurse' AND entity_id = 42 AND action LIKE 'VIEW%'
ORDER BY created_at DESC;

-- Recent PHI reads
SELECT created_at, username, action, entity_type, entity_id, description
FROM audit.audit_logs
WHERE action LIKE 'VIEW_%'
ORDER BY created_at DESC
LIMIT 50;
```

## Privacy note

Audit rows for reads may still contain **identifiers** (nurse id, search strings in query). Treat the audit system as sensitive, restrict `AUDIT_LOGS` access, and apply the same retention and integrity controls as other ePHI-related records.

## Related

- `docs/HIPAA_COMPLIANCE_CHECKLIST.md`
- `docs/TAMPER_PROOF_AUDIT_LOGS.md`
- `backend/src/modules/audit/audit.service.ts`
