/**
 * Standalone contract expiry scan (for system cron or manual ops).
 *
 * Usage:
 *   export DATABASE_URL=postgresql://...
 *   npx ts-node scripts/run-contract-expiry-alerts.ts
 *
 * Env:
 *   CONTRACT_ALERT_THRESHOLDS=90,60,30,14,7   (optional)
 */
import { Client } from 'pg';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('\u274c DATABASE_URL not set');
    process.exit(1);
  }

  const thresholds = (process.env.CONTRACT_ALERT_THRESHOLDS || '90,60,30,14,7')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  console.log('\u2705 Connected \u2014 running contract expiry scan');
  console.log(`   thresholds: [${thresholds.join(', ')}]`);

  try {
    const expired = await client.query(`SELECT nursing.mark_expired_contracts() AS n`);
    const expiredMarked = Number(expired.rows[0]?.n ?? 0);

    const alerts = await client.query(
      `SELECT nursing.generate_contract_expiry_alerts($1::int[]) AS n`,
      [thresholds],
    );
    const alertsCreated = Number(alerts.rows[0]?.n ?? 0);

    console.log(`\u2705 Done \u2014 expiredMarked=${expiredMarked}, alertsCreated=${alertsCreated}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('\ud83d\udca5 Contract expiry scan failed:', e);
  process.exit(1);
});
