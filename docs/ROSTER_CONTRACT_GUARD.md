# Roster ↔ contract guard

## Status (2026-09-13, P0 + mock guard)

- **SQL:** `nursing.nurse_has_valid_contract(nurse_id, on_date)` is defined in **V4_0**.
- **Prisma:** V4 Contract Master models on `main`.
- **Nest:** `nursing.service.ts` restored; `assertNurseHasValidContract` on roster create/update.
- **Mock:** `mock-contract-routes` registered; roster POST/PATCH call `app.locals.hasValidContract` → 409 if missing Active contract.

```bash
cd Nurse-App_v01
git checkout c903bc8 -- backend/src/modules/nursing/nursing.service.ts
# then apply the Nest patch below (or cherry-pick once re-pushed)
```

- **PRs #3 and #4** were closed as superseded / schema-conflicting with V4 on `main`.

---

## Nest (`nursing.service.ts`)

### 1) Helper (place near other private helpers, e.g. before `toDateOnly`)

```ts
/**
 * Blocks roster create/update when the nurse has no Active employment contract
 * covering the assignment date (nursing.nurse_has_valid_contract).
 * If the SQL function is missing (migrations not applied), log and allow so
 * local Nest use is not hard-broken — production must run V4_0+.
 */
private async assertNurseHasValidContract(
  nurseId: number,
  assignmentDate: Date | string,
): Promise<void> {
  const onDate = this.toDateOnly(assignmentDate);
  try {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
      `SELECT nursing.nurse_has_valid_contract($1::bigint, $2::date) AS ok`,
      nurseId,
      onDate,
    );
    if (!rows?.[0]?.ok) {
      throw new ConflictException(
        `Nurse #${nurseId} has no valid Active employment contract covering ${onDate}. Update Contract Master before rostering.`,
      );
    }
  } catch (e: any) {
    if (e instanceof ConflictException) throw e;
    this.logger.warn(
      `Contract validity check skipped (nurse #${nurseId}, ${onDate}): ${e?.message || e}`,
    );
  }
}
```

(`ConflictException` is already imported in this service.)

### 2) `createRosterAssignment`

After `validateRosterAssignmentScope`, before `create`:

```ts
await this.assertNurseHasValidContract(dto.nurse_id, dto.assignment_date);
```

### 3) `updateRosterAssignment`

After scope validation, before `update`:

```ts
const nurseId = dto.nurse_id !== undefined ? dto.nurse_id : Number(existing.nurse_id);
const onDate =
  dto.assignment_date !== undefined ? dto.assignment_date : existing.assignment_date;
await this.assertNurseHasValidContract(nurseId, onDate);
```

---

## Mock (`mock-server.js` roster POST)

After nurse exists check (requires `mock-contract-routes` to set `app.locals.hasValidContract`):

```js
if (typeof app.locals.hasValidContract === 'function' && !app.locals.hasValidContract(b.nurse_id, date)) {
  return res.status(409).json({
    success: false,
    message: 'Nurse #' + b.nurse_id + ' has no valid Active employment contract covering ' + date + '. Update Contract Master before rostering.',
    timestamp: new Date().toISOString(),
  });
}
```

---

## Related

- `nursing.nurse_has_valid_contract` (V4_0)
- V4_2 Active exclusivity + deferred supersede on renew
- Prisma models: `nursing_employment_contracts`, `nursing_contract_alerts`, …
