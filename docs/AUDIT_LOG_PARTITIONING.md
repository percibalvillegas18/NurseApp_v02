# Audit Log Partitioning & Retention

**Migration:** `V3_6__audit_log_partitioning.sql`  
**HIPAA:** § 164.316 — retain documentation (including audit evidence) for **6 years**

## Design

| Item | Choice |
|------|--------|
| Strategy | PostgreSQL declarative **RANGE** partitioning on `created_at` |
| Granularity | **Monthly** partitions (`audit.audit_logs_YYYY_MM`) |
| Primary key | `(id, created_at)` — required when partitioning by `created_at` |
| Writes | `INSERT` into parent `audit.audit_logs`; planner routes to the month partition |
| Row DELETE/UPDATE | Still **forbidden** (triggers + RLS) |
| Retention | **DROP** partitions older than 6 years (not row deletes) |
| Hash chain | Unchanged; tip lookup scans parent ordered by `id` |

## Apply

```bash
cd backend
export DATABASE_URL=postgresql://devuser:devpassword@localhost:5432/hospital_rbac_dev
npx ts-node scripts/run-migrations.ts
# or
psql $DATABASE_URL -f database/migrations/V3_6__audit_log_partitioning.sql
```

After a successful run, compare counts then optionally drop the legacy copy:

```sql
SELECT COUNT(*) FROM audit.audit_logs;
SELECT COUNT(*) FROM audit.audit_logs_legacy;  -- if present
-- DROP TABLE audit.audit_logs_legacy;
```

## Operations

### Ensure future months exist (run monthly via cron)

```sql
SELECT audit.ensure_audit_partitions_ahead(3);  -- current window + 3 months
SELECT audit.ensure_audit_partition('2027-01-15'::date);  -- specific month
```

The `BEFORE INSERT` hash-chain trigger also calls `ensure_audit_partition` for the row's `created_at` as a safety net.

### Drop partitions older than 6 years (HIPAA minimum)

```sql
SELECT * FROM audit.drop_audit_partitions_older_than(INTERVAL '6 years');
-- or longer if policy requires:
SELECT * FROM audit.drop_audit_partitions_older_than(INTERVAL '7 years');
```

Suggested schedule: monthly job after backups.

1. `pg_dump` / snapshot
2. `ensure_audit_partitions_ahead(2)`
3. `drop_audit_partitions_older_than(INTERVAL '6 years')`
4. `SELECT * FROM audit.verify_audit_chain()` on a recent id range (optional sample)

### List partitions

```sql
SELECT c.relname AS partition,
       pg_get_expr(c.relpartbound, c.oid) AS bounds
FROM pg_class c
JOIN pg_inherits i ON i.inhrelid = c.oid
JOIN pg_class p ON p.oid = i.inhparent
JOIN pg_namespace n ON n.oid = p.relnamespace
WHERE n.nspname = 'audit' AND p.relname = 'audit_logs'
ORDER BY 1;
```

## Application / Prisma

- Continue inserting via `prisma.audit_audit_logs.create(...)` — no app change required.
- Parent table name and columns are unchanged from the app's perspective.
- Prisma does not need partition awareness for basic INSERT/SELECT.

## Retention policy (recommended text for compliance docs)

> Audit log records are stored in monthly partitions of `audit.audit_logs`.
> Partitions are retained for a minimum of six (6) years from the end of the
> month in which the events occurred. After that period, partitions are dropped
> as a unit following backup. Individual log rows are not updated or deleted.

## Related

- `docs/TAMPER_PROOF_AUDIT_LOGS.md` — hash chain
- `docs/PHI_READ_AUDITING.md` — what gets written
- `docs/HIPAA_COMPLIANCE_CHECKLIST.md`
