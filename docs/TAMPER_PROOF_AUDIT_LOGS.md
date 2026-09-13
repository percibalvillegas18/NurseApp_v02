# Tamper-Proof Audit Logs

**Migration:** `V3_5__tamper_proof_audit_logs.sql`  
**HIPAA mapping:** § 164.312(b) Audit Controls + documentation integrity under § 164.316

## What was implemented

1. **Append-only table**
   - RLS policies already blocked `UPDATE` / `DELETE`.
   - Additional `BEFORE UPDATE` and `BEFORE DELETE` triggers raise an exception even for privileged roles that might bypass RLS.
   - `REVOKE UPDATE, DELETE` from `PUBLIC` (adjust for your app role in production).

2. **Cryptographic hash chain**
   - Columns: `prev_hash`, `entry_hash` (SHA-256 hex).
   - `BEFORE INSERT` trigger:
     - Reads the latest `entry_hash` (or `GENESIS`).
     - Sets `prev_hash`.
     - Computes `entry_hash = SHA-256(prev_hash || canonical payload)`.
   - Any modification of a past row breaks the chain and is detectable.

3. **Verification function**
   ```sql
   SELECT * FROM audit.verify_audit_chain();           -- full chain
   SELECT * FROM audit.verify_audit_chain(1000, 2000); -- range
   ```
   Empty result set = chain is intact.

4. **Application support**
   - `AuditService.verifyChain(fromId?, toId?)` calls the SQL function.
   - Inserts remain ordinary `create()` calls; the DB trigger owns the hashes so the application cannot forge a consistent chain without knowing the previous hash and the exact payload rules.

## How the chain detects tampering

| Attack | Detection |
|--------|-----------|
| Delete a middle row | Next row’s `prev_hash` no longer matches |
| Alter action / user / changes | Recomputed `entry_hash` mismatches stored value |
| Insert a forged row in the middle | Broken `prev_hash` links |
| Reorder rows | Chain order is by `id` ASC; mismatch surfaces |

## Operational notes

- **Run the migration** after V3_4:
  ```bash
  psql $DATABASE_URL -f backend/database/migrations/V3_5__tamper_proof_audit_logs.sql
  # or
  npx ts-node scripts/run-migrations.ts
  ```
- Existing rows are back-filled with a deterministic hash so the chain continues from the current tip.
- **Retention (6 years):** still required. Pair this with monthly partitioning + archival in a later migration; the hash chain works across partitions if you keep a global order or store the tip hash when rotating.
- **Superuser risk:** a PostgreSQL superuser can still disable triggers or modify the table. Mitigate with:
  - Dedicated audit DB / schema owned by a different role
  - Streaming logs to an external WORM / SIEM store
  - Regular `verify_audit_chain()` jobs that alert on any row returned

## Application usage

```typescript
// Normal logging (unchanged API)
await this.auditService.log({ action: 'LOGIN_SUCCESS', entityType: 'Auth', ... });

// Integrity check (admin / compliance job)
const broken = await this.auditService.verifyChain();
if (broken.length > 0) {
  // alert security officer
}
```

## Limitations (honest)

- Hash chain proves **integrity of the sequence the database accepted**. It does not replace offline / external backups or a separate append-only log store.
- Clock skew on `created_at` is included in the payload; keep DB time synchronized (NTP).
- High concurrency: the trigger reads the current tip with a simple `ORDER BY id DESC LIMIT 1`. Under extreme insert load, consider advisory locks or a dedicated chain tip table if gaps become a concern.

## Related

- `docs/HIPAA_COMPLIANCE_CHECKLIST.md` — audit controls section
- `backend/src/modules/audit/audit.service.ts`
- `backend/src/common/interceptors/audit.interceptor.ts`
