# Contract Master & Employment Contract Management

**Migration:** `V4_0__contract_master.sql`  
**API prefix:** `/api/v1/contracts`  
**Menu code:** `CONTRACT` (under Nursing Workforce)

## Purpose

Single authoritative employment-contract record per nurse engagement, covering:

**Nurse → Job No. → Position Code → Position → Department/Unit → Contract → Credentials → Deployment/Roster**

### Primary objectives

1. Maintain one authoritative employment-contract record per engagement  
2. Track contract start and expiry dates  
3. Support Permanent, FixedTerm, Temporary, Locum, Other  
4. Manage renewals (new contract linked via `renewal_of_id`; prior marked `Superseded`)  
5. Prevent roster deployment without a valid Active contract covering the assignment date  
6. Integrate status with credentialing / rostering / planning  
7. Expiry and renewal watchlists (API: `/contracts/expiring`)  
8. Document metadata + status history for audit  
9. Reporting hooks (list filters by agency, status, date range)

## Contract agencies (Saudi hospital context)

| Code | Name | Type | Notes |
|------|------|------|--------|
| **MOH** | Ministry of Health | Government | Civil servants under Saudi MOH |
| **SOP** | Self-Operating Program (برنامج التشغيل الذاتي) | HospitalDirect | Hospital-specific contracts, not civil service registry |
| **HCC** | HCC Contracting | ThirdParty | Outsourced specialized staffing |
| **HHC** | HHC Contracting | ThirdParty | Outsourced staffing (e.g. ECG, some nursing) |

## Lifecycle statuses

```
Draft → PendingApproval → Active → Expired
                      ↓           ↓
                 Terminated   Superseded (renewal)
                      ↑
                  Suspended
```

| Status | Meaning |
|--------|---------|
| Draft | Data entry; not approved |
| PendingApproval | Submitted for approval |
| Active | In force; eligible for roster if dates cover assignment day |
| Suspended | Temporarily not deployable |
| Expired | Past `end_date` (or marked expired) |
| Terminated | Ended early with reason |
| Superseded | Replaced by a renewal contract |

## API (Nest + mock)

| Method | Path | Permission |
|--------|------|------------|
| GET | `/contracts` | CONTRACT / VIEW |
| GET | `/contracts/expiring?days=90` | CONTRACT / VIEW |
| GET | `/contracts/agencies` | CONTRACT / VIEW |
| GET | `/contracts/positions` | CONTRACT / VIEW |
| GET | `/contracts/:id` | CONTRACT / VIEW |
| GET | `/contracts/:id/history` | CONTRACT / VIEW |
| GET | `/contracts/:id/documents` | CONTRACT / VIEW |
| POST | `/contracts` | CONTRACT / CREATE |
| PATCH | `/contracts/:id` | CONTRACT / EDIT |
| POST | `/contracts/:id/submit` | CONTRACT / EDIT |
| POST | `/contracts/:id/approve` | CONTRACT / APPROVE |
| POST | `/contracts/:id/activate` | CONTRACT / APPROVE |
| POST | `/contracts/:id/suspend` | CONTRACT / EDIT |
| POST | `/contracts/:id/terminate` | CONTRACT / EDIT |
| POST | `/contracts/:id/renew` | CONTRACT / CREATE |
| POST | `/contracts/:id/documents` | CONTRACT / EDIT |

## Roster guard

`nursing.nurse_has_valid_contract(nurse_id, on_date)` returns true when an **Active** contract covers `on_date`. Roster create should reject (409) when false.

## Apply migration

```bash
cd backend
export DATABASE_URL=postgresql://devuser:devpassword@localhost:5432/hospital_rbac_dev
npx ts-node scripts/run-migrations.ts
npx prisma generate
```

## Related

- Nursing domain V3_* (nurses, credentials, roster)
- RBAC menu `CONTRACT`
- PHI read auditing (extend patterns to `/contracts` when using live Nest)
