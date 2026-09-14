/**
 * Run raw SQL migrations in order, with a persisted history table.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Client } from 'pg';

const migrationsDir = path.join(__dirname, '../database/migrations');

const order = [
  'V1_0__initial_schema.sql',
  'V1_1__system_tables.sql',
  'V2_0__effective_access_function.sql',
  'V2_1__role_model_redesign.sql',
  'V2_2__rbac_tables_role_updates.sql',
  'V2_3__seed_hospital_roles_and_users.sql',
  'V2_4__seed_rbac_configuration.sql',
  'V2_5__fix_evaluate_access_multirole.sql',
  'V3_0__nursing_domain.sql',
  'V3_1__seed_nursing_demo.sql',
  'V3_2__nurse_personal_fields.sql',
  'V3_3__drop_nurse_email.sql',
  'V3_4__nurse_job_no.sql',
  'V3_5__tamper_proof_audit_logs.sql',
  'V3_6__audit_log_partitioning.sql',
  'V4_0__contract_master.sql',
  'V4_1__contract_expiry_alerts.sql',
  'V4_2__contract_active_exclusivity.sql',
  'V4_3__staff_credential_tracking.sql',
  'V4_4__resource_aware_data_scope.sql',
  'V4_5__evaluate_access_resource_type.sql',
  'V4_10__positions_hierarchy.sql',
];

interface Flags {
  dryRun: boolean;
  baseline: boolean;
  force: boolean;
  continueOnError: boolean;
}

function parseFlags(argv: string[]): Flags {
  return {
    dryRun: argv.includes('--dry-run'),
    baseline: argv.includes('--baseline'),
    force: argv.includes('--force'),
    continueOnError: argv.includes('--continue-on-error'),
  };
}

function checksumOf(sql: string): string {
  return crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

async function ensureHistoryTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename     TEXT PRIMARY KEY,
      checksum     TEXT NOT NULL,
      applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      duration_ms  INTEGER,
      status       TEXT NOT NULL DEFAULT 'Success',
      applied_by   TEXT
    )
  `);
}

async function run() {
  const flags = parseFlags(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    if (flags.dryRun) {
      console.log('DATABASE_URL not set - dry-run order:');
      order.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2, ' ')}. ${f}`));
      return;
    }
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  console.log('Connected to database');
  await ensureHistoryTable(client);

  const { rows } = await client.query(
    'SELECT filename, checksum, status FROM public.schema_migrations',
  );
  const applied = new Map<string, { checksum: string; status: string }>(
    rows.map((r) => [r.filename, { checksum: r.checksum, status: r.status }]),
  );

  const missing = order.filter((f) => !fs.existsSync(path.join(migrationsDir, f)));
  if (missing.length > 0) {
    console.error(`Missing migration file(s): ${missing.join(', ')}`);
    await client.end();
    process.exit(1);
  }

  let appliedCount = 0;
  let skippedCount = 0;
  const failures: string[] = [];

  for (const file of order) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');
    const checksum = checksumOf(sql);
    const previous = applied.get(file);

    if (previous && !flags.force) {
      if (previous.status !== 'Success') {
        console.error(`${file} recorded as '${previous.status}'. Fix or use --force.`);
        failures.push(file);
        if (!flags.continueOnError) break;
        continue;
      }
      skippedCount++;
      continue;
    }

    if (flags.dryRun) {
      console.log(`\n[dry-run] would apply ${file}`);
      appliedCount++;
      continue;
    }

    if (flags.baseline) {
      await client.query(
        `INSERT INTO public.schema_migrations (filename, checksum, status, applied_by)\n         VALUES ($1, $2, 'Success', $3)\n         ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, status = 'Success'`,
        [file, checksum, 'baseline'],
      );
      console.log(`${file} baselined`);
      appliedCount++;
      continue;
    }

    console.log(`\nRunning ${file}...`);
    const startedAt = Date.now();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      const duration = Date.now() - startedAt;
      await client.query(
        `INSERT INTO public.schema_migrations (filename, checksum, duration_ms, status, applied_by)\n         VALUES ($1, $2, $3, 'Success', $4)\n         ON CONFLICT (filename) DO UPDATE\n           SET checksum = EXCLUDED.checksum, duration_ms = EXCLUDED.duration_ms,\n               status = 'Success', applied_at = now()`,
        [file, checksum, duration, process.env.USER || 'unknown'],
      );
      await client.query('COMMIT');
      console.log(`${file} completed in ${duration}ms`);
      appliedCount++;
    } catch (error: any) {
      console.error(`${file} failed: ${error.message}`);
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      failures.push(file);
      if (!flags.continueOnError) break;
    }
  }

  await client.end();
  if (failures.length > 0) {
    console.error(`\nFailed: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log(`\nDone - ${appliedCount} applied, ${skippedCount} skipped.`);
}

run().catch((e) => {
  console.error('Migration runner crashed:', e);
  process.exit(1);
});
