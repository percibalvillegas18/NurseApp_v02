# Automated Contract Expiry Alerts

**Migration:** `V4_1__contract_expiry_alerts.sql`  
**Objective:** Primary goal #7 of Contract Master — automated renewal and expiry alerts.

## What it does

1. **Marks expired contracts** — Active rows whose `end_date` is before today → status `Expired` + status history entry.
2. **Generates alerts** at configurable day thresholds (default **90, 60, 30, 14, 7**).
3. **Dedupes** per `(contract_id, alert_type, threshold_days)` so the same band is not re-alerted every day.
4. **Severity**
   - ≤ 7 days → **Critical**
   - ≤ 30 days → **Warning**
   - else → **Info**
5. **EXPIRED** alerts (threshold `0`) for contracts already past end date.

## Schedule

| Mode | How |
|------|-----|
| **Nest cron** | `ContractAlertsScheduler` runs **every day at 06:00** (`@Cron(EVERY_DAY_AT_6AM)`) |
| **CLI / system cron** | `npx ts-node scripts/run-contract-expiry-alerts.ts` |
| **Manual (UI/API)** | `POST /api/v1/contracts/alerts/scan` (CONTRACT / APPROVE) |

Disable Nest job:

```bash
CONTRACT_ALERTS_ENABLED=false
```

Custom thresholds:

```bash
CONTRACT_ALERT_THRESHOLDS=90,60,30,14,7
```

## API

| Method | Path | Permission |
|--------|------|------------|
| GET | `/contracts/alerts/summary` | VIEW |
| GET | `/contracts/alerts?acknowledged=false` | VIEW |
| POST | `/contracts/alerts/scan` | APPROVE |
| POST | `/contracts/alerts/:id/acknowledge` | EDIT |

## Apply

```bash
cd backend
npm install   # picks up @nestjs/schedule
export DATABASE_URL=postgresql://devuser:devpassword@localhost:5432/hospital_rbac_dev
npx ts-node scripts/run-migrations.ts   # includes V4_1
npm run alerts:scan   # optional first run
```

Example system crontab:

```cron
0 6 * * * cd /opt/nurse-app/backend && DATABASE_URL=... npx ts-node scripts/run-contract-expiry-alerts.ts >> /var/log/contract-alerts.log 2>&1
```

## Mock / preview

`backend/mock-contract-routes.js` implements the same endpoints in memory and seeds alerts on boot from demo contract end dates.

## Related

- `docs/CONTRACT_MASTER.md`
- `nursing.nurse_has_valid_contract` — roster still blocked for expired / missing Active contracts
