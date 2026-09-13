# Active contract exclusivity (Option A)

**Migration:** `V4_2__contract_active_exclusivity.sql`

## Rule

At most **one `Active` employment contract per nurse** may cover any given calendar day.

## Implementation

1. Extension **`btree_gist`**
2. Generated column **`active_span daterange`** — only when `status = 'Active'`, closed `'[]'` span
3. Constraint **`emp_contracts_active_no_overlap`** (GiST EXCLUDE on `nurse_id` + `active_span`)
4. Helper **`nursing.nurse_active_contract_id(nurse_id, on_date)`**

## Application behaviour

| Action | Behaviour |
|--------|-----------|
| **Renew** | Draft successor; prior stays Active until activate |
| **Approve / Activate** | Supersede overlapping Actives, then activate (one transaction) |
| Violation | HTTP **409 Conflict** |

Contiguous handoff: next `start_date = prior.end_date + 1 day` (closed ranges overlap on the same day).

## Apply

```bash
cd backend
npx ts-node scripts/run-migrations.ts
```

Requires privilege to `CREATE EXTENSION btree_gist`.
