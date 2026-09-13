# ContractsService changes for V4_2

## renew()
- Do **not** set prior to Superseded on renew
- Only set `renewal_of_id` on the new Draft
- Audit action: `CONTRACT_RENEWAL_DRAFT`
- Prior remains Active until successor is activated (closes coverage gap)

## approve() / activate()
- Wrap in `prisma.$transaction`
- If `renewalOfId` points to an Active prior → set prior Superseded + history
- Supersede any other Active rows for the same nurse that overlap this contract’s dates
- Then set this row to Active
- Map PostgreSQL `emp_contracts_active_no_overlap` / `exclusion_violation` → HTTP 409 `ConflictException`

## Import
- Ensure `ConflictException` is imported from `@nestjs/common`

These changes pair with migration `V4_2__contract_active_exclusivity.sql`.
