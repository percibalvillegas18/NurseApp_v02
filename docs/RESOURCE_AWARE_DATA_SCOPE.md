# Resource-aware data scope (V4_4)

## Problem
`rbac.evaluate_access(p_resource_id)` previously set `data_scope_valid = TRUE` whenever the user had **any** active `user_data_scopes` row. An ICU-scoped nurse could pass the RBAC guard for a Medical-Ward resource id.

App-layer filters in `NursingService` already scoped list/get queries; this migration closes the **guard** hole.

## Behaviour (first cut)
When `p_resource_id` is set:

| Case | Result |
|------|--------|
| User has `scope_type = All` | ALLOW |
| Resource resolves to a nursing unit (nurse / roster / credential) | ALLOW only if user has matching NursingUnit, Department, Hospital, or Post scope |
| Nursing menu (`NURSE_MASTER`, `CREDENTIALS`, `NURSE_ROSTER`, `CONTRACT`, `DOCUMENTS`) and resource unknown | **DENY** (fail closed) |
| Non-nursing menu / unresolved resource | Legacy “any active scope” |
| `p_resource_id` null (list endpoints) | Scope valid; app must filter |

## Apply
```bash
cd backend && npx ts-node scripts/run-migrations.ts
# or re-run docker compose so migrations apply
```

## Follow-ups
- Pass explicit `resourceType` into SQL (avoid id-space collisions across tables).
- Un-skip `ICU nurse should NOT access Medical Ward resource` integration test with Postgres.
- Tighten mock `PrismaService` evaluate_access matrix similarly for preview parity.
