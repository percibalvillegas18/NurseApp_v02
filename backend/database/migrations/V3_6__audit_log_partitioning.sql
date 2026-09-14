-- =============================================================================
-- V3_6__audit_log_partitioning.sql
-- Monthly RANGE partitioning of audit.audit_logs for performance + HIPAA
-- 6-year retention (§ 164.316 documentation retention).
--
-- Strategy:
--   1. Rename existing table to audit_logs_legacy
--   2. Create partitioned parent audit.audit_logs BY RANGE (created_at)
--   3. Create monthly partitions (past 3 months through +2 months ahead)
--   4. Copy data from legacy into parent (routes to partitions)
--   5. Recreate indexes, RLS, hash-chain + immutability triggers
--   6. Helpers: ensure_audit_partition, ensure_audit_partitions_ahead,
--      drop_audit_partitions_older_than
--
-- Note: PostgreSQL requires the partition key in UNIQUE/PRIMARY KEY definitions,
-- so PK becomes (id, created_at). The global id sequence is preserved.
-- Row-level DELETE remains forbidden; retention is done by DROP PARTITION only.
-- =============================================================================

-- Guard: skip if already partitioned
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'audit' AND c.relname = 'audit_logs'
  ) THEN
    RAISE NOTICE 'audit.audit_logs is already partitioned — skipping structural migration';
    RETURN;
  END IF;

  -- --------------------------------------------------------------------------
  -- 1. Drop triggers on old table (will recreate on parent)
  -- --------------------------------------------------------------------------
  DROP TRIGGER IF EXISTS trg_audit_hash_chain ON audit.audit_logs;
  DROP TRIGGER IF EXISTS trg_audit_no_update ON audit.audit_logs;
  DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit.audit_logs;

  -- Drop RLS policies (recreate on parent)
  DROP POLICY IF EXISTS audit_logs_no_delete ON audit.audit_logs;
  DROP POLICY IF EXISTS audit_logs_no_update ON audit.audit_logs;

  -- --------------------------------------------------------------------------
  -- 2. Rename live table out of the way
  -- --------------------------------------------------------------------------
  ALTER TABLE IF EXISTS audit.audit_logs RENAME TO audit_logs_legacy;

  -- Rename old indexes so names are free for the parent
  ALTER INDEX IF EXISTS audit.idx_audit_logs_user_id RENAME TO idx_audit_logs_legacy_user_id;
  ALTER INDEX IF EXISTS audit.idx_audit_logs_action RENAME TO idx_audit_logs_legacy_action;
  ALTER INDEX IF EXISTS audit.idx_audit_logs_entity_type RENAME TO idx_audit_logs_legacy_entity_type;
  ALTER INDEX IF EXISTS audit.idx_audit_logs_created_at RENAME TO idx_audit_logs_legacy_created_at;
  ALTER INDEX IF EXISTS audit.idx_audit_logs_entry_hash RENAME TO idx_audit_logs_legacy_entry_hash;
  ALTER INDEX IF EXISTS audit.idx_audit_logs_id_desc RENAME TO idx_audit_logs_legacy_id_desc;

  -- --------------------------------------------------------------------------
  -- 3. Create partitioned parent (same columns as V1_0 + V3_5)
  -- --------------------------------------------------------------------------
  CREATE TABLE audit.audit_logs (
    id            BIGSERIAL,
    user_id       BIGINT,
    username      VARCHAR(100),
    action        VARCHAR(100) NOT NULL,
    entity_type   VARCHAR(100) NOT NULL,
    entity_id     BIGINT,
    entity_code   VARCHAR(255),
    description   TEXT,
    changes       JSONB,
    reason        VARCHAR(500),
    ip_address    VARCHAR(45),
    user_agent    VARCHAR(500),
    session_id    VARCHAR(100),
    request_id    VARCHAR(100),
    status        VARCHAR(50) DEFAULT 'Success',
    error_message TEXT,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    prev_hash     TEXT,
    entry_hash    TEXT NOT NULL,
    PRIMARY KEY (id, created_at)
  ) PARTITION BY RANGE (created_at);

  -- Keep sequence in sync with legacy max(id) so new ids do not collide
  PERFORM setval(
    pg_get_serial_sequence('audit.audit_logs', 'id'),
    GREATEST(
      (SELECT COALESCE(MAX(id), 1) FROM audit.audit_logs_legacy),
      1
    )
  );

  COMMENT ON TABLE audit.audit_logs IS
    'Append-only HIPAA audit trail. PARTITION BY RANGE (created_at) monthly. '
    'Integrity: hash chain (prev_hash/entry_hash). Retention: drop partitions older than 6 years.';
END $$;

-- =============================================================================
-- Partition management functions (created even if table was already partitioned)
-- =============================================================================

CREATE OR REPLACE FUNCTION audit.ensure_audit_partition(p_month DATE)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_start     DATE := date_trunc('month', p_month)::date;
  v_end       DATE := (date_trunc('month', p_month) + INTERVAL '1 month')::date;
  v_name      TEXT := format('audit_logs_%s', to_char(v_start, 'YYYY_MM'));
  v_qualified TEXT := format('audit.%I', v_name);
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'audit' AND c.relname = v_name
  ) THEN
    RETURN v_qualified || ' (already exists)';
  END IF;

  EXECUTE format(
    'CREATE TABLE audit.%I PARTITION OF audit.audit_logs
       FOR VALUES FROM (%L) TO (%L)',
    v_name,
    v_start,
    v_end
  );

  -- Per-partition indexes (created_at is the partition key; still useful locally)
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON audit.%I (user_id)',
    v_name || '_user_id', v_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON audit.%I (action)',
    v_name || '_action', v_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON audit.%I (entity_type)',
    v_name || '_entity_type', v_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON audit.%I (created_at DESC)',
    v_name || '_created_at', v_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON audit.%I (entry_hash)',
    v_name || '_entry_hash', v_name
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON audit.%I (id DESC)',
    v_name || '_id_desc', v_name
  );

  RETURN v_qualified || ' created';
END;
$$;

COMMENT ON FUNCTION audit.ensure_audit_partition(DATE) IS
  'Create a monthly partition of audit.audit_logs for the month containing p_month, if missing.';

-- Ensure partitions from start month through N months ahead of "today"
CREATE OR REPLACE FUNCTION audit.ensure_audit_partitions_ahead(p_months_ahead INT DEFAULT 2)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_month DATE;
  v_end   DATE;
  v_msg   TEXT := '';
  v_one   TEXT;
BEGIN
  v_month := date_trunc('month', CURRENT_DATE - INTERVAL '3 months')::date;
  v_end   := date_trunc('month', CURRENT_DATE + (p_months_ahead || ' months')::interval)::date;

  WHILE v_month <= v_end LOOP
    v_one := audit.ensure_audit_partition(v_month);
    v_msg := v_msg || v_one || E'\n';
    v_month := (v_month + INTERVAL '1 month')::date;
  END LOOP;

  RETURN v_msg;
END;
$$;

-- Drop whole partitions whose upper bound is older than the retention window.
-- Default 6 years (HIPAA § 164.316). This is DROP TABLE of the partition child,
-- not row-level DELETE (which remains forbidden by triggers).
CREATE OR REPLACE FUNCTION audit.drop_audit_partitions_older_than(
  p_retain INTERVAL DEFAULT INTERVAL '6 years'
)
RETURNS TABLE (dropped_partition TEXT, range_to DATE)
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
  v_cutoff DATE := (date_trunc('month', CURRENT_DATE) - p_retain)::date;
  v_to DATE;
BEGIN
  FOR r IN
    SELECT c.relname AS part_name,
           pg_get_expr(c.relpartbound, c.oid) AS bound_expr
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = p.relnamespace
    WHERE n.nspname = 'audit'
      AND p.relname = 'audit_logs'
      AND c.relkind = 'r'
  LOOP
    -- bound_expr looks like: FOR VALUES FROM ('2024-01-01') TO ('2024-02-01')
    -- NOTE (repair 2026-09): the regex literal MUST use a distinct dollar-quote
    -- tag. The original nested quote terminated the function body early and the
    -- file failed with 'syntax error at or near "TO"'. Do NOT write the body's
    -- own quote tag anywhere in here, not even inside a comment.
    v_to := substring(r.bound_expr from $re$TO \('([0-9-]+)'\)$re$)::date;
    IF v_to IS NOT NULL AND v_to <= v_cutoff THEN
      EXECUTE format('DROP TABLE IF EXISTS audit.%I', r.part_name);
      dropped_partition := 'audit.' || r.part_name;
      range_to := v_to;
      RETURN NEXT;
    END IF;
  END LOOP;
  RETURN;
END;
$$;

COMMENT ON FUNCTION audit.drop_audit_partitions_older_than(INTERVAL) IS
  'Drop monthly audit partitions whose range ends on or before (current_month - retain). Default retain = 6 years.';

-- =============================================================================
-- Bootstrap partitions + migrate legacy data (only when legacy table exists)
-- =============================================================================

DO $$
DECLARE
  v_min TIMESTAMP;
  v_max TIMESTAMP;
  v_month DATE;
BEGIN
  -- Always ensure a window of partitions exists
  PERFORM audit.ensure_audit_partitions_ahead(2);

  IF to_regclass('audit.audit_logs_legacy') IS NULL THEN
    RAISE NOTICE 'No audit.audit_logs_legacy — nothing to backfill';
    RETURN;
  END IF;

  SELECT MIN(created_at), MAX(created_at) INTO v_min, v_max
  FROM audit.audit_logs_legacy;

  IF v_min IS NOT NULL THEN
    v_month := date_trunc('month', v_min)::date;
    WHILE v_month <= date_trunc('month', COALESCE(v_max, CURRENT_TIMESTAMP))::date LOOP
      PERFORM audit.ensure_audit_partition(v_month);
      v_month := (v_month + INTERVAL '1 month')::date;
    END LOOP;
  END IF;

  -- Copy legacy rows into partitioned parent (trigger will NOT re-hash if we
  -- disable user triggers for the session copy — we preserve existing hashes).
  ALTER TABLE audit.audit_logs DISABLE TRIGGER USER;

  INSERT INTO audit.audit_logs (
    id, user_id, username, action, entity_type, entity_id, entity_code,
    description, changes, reason, ip_address, user_agent, session_id,
    request_id, status, error_message, created_at, prev_hash, entry_hash
  )
  SELECT
    id, user_id, username, action, entity_type, entity_id, entity_code,
    description, changes, reason, ip_address, user_agent, session_id,
    request_id, status, error_message,
    COALESCE(created_at, CURRENT_TIMESTAMP),
    COALESCE(prev_hash, 'GENESIS'),
    COALESCE(
      entry_hash,
      encode(digest('LEGACY|' || id::text, 'sha256'), 'hex')
    )
  FROM audit.audit_logs_legacy
  ORDER BY id
  ON CONFLICT DO NOTHING;

  ALTER TABLE audit.audit_logs ENABLE TRIGGER USER;

  -- Resync sequence after copy
  PERFORM setval(
    pg_get_serial_sequence('audit.audit_logs', 'id'),
    GREATEST(
      (SELECT COALESCE(MAX(id), 1) FROM audit.audit_logs),
      1
    )
  );

  RAISE NOTICE 'Migrated rows from audit.audit_logs_legacy into partitioned audit.audit_logs';
END $$;

-- =============================================================================
-- Recreate triggers + RLS on partitioned parent
-- =============================================================================

-- Hash chain (same logic as V3_5; works across partitions via parent scan)
CREATE OR REPLACE FUNCTION audit.fn_audit_hash_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'audit.audit_logs is append-only (tamper-proof)';
  END IF;

  -- Ensure the partition for NEW.created_at exists (safety net)
  PERFORM audit.ensure_audit_partition(COALESCE(NEW.created_at, clock_timestamp())::date);

  SELECT entry_hash INTO v_prev
  FROM audit.audit_logs
  ORDER BY id DESC
  LIMIT 1;

  IF v_prev IS NULL THEN
    v_prev := 'GENESIS';
  END IF;

  NEW.prev_hash := v_prev;
  NEW.created_at := COALESCE(NEW.created_at, clock_timestamp());

  NEW.entry_hash := encode(
    digest(
      COALESCE(NEW.prev_hash, 'GENESIS') || '|' ||
      COALESCE(NEW.user_id::text, '') || '|' ||
      COALESCE(NEW.username, '') || '|' ||
      COALESCE(NEW.action, '') || '|' ||
      COALESCE(NEW.entity_type, '') || '|' ||
      COALESCE(NEW.entity_id::text, '') || '|' ||
      COALESCE(NEW.entity_code, '') || '|' ||
      COALESCE(NEW.description, '') || '|' ||
      COALESCE(NEW.changes::text, '') || '|' ||
      COALESCE(NEW.reason, '') || '|' ||
      COALESCE(NEW.ip_address, '') || '|' ||
      COALESCE(NEW.user_agent, '') || '|' ||
      COALESCE(NEW.session_id, '') || '|' ||
      COALESCE(NEW.request_id, '') || '|' ||
      COALESCE(NEW.status, 'Success') || '|' ||
      COALESCE(NEW.error_message, '') || '|' ||
      COALESCE(NEW.created_at::text, clock_timestamp()::text),
      'sha256'
    ),
    'hex'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_hash_chain ON audit.audit_logs;
CREATE TRIGGER trg_audit_hash_chain
  BEFORE INSERT ON audit.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit.fn_audit_hash_chain();

CREATE OR REPLACE FUNCTION audit.fn_audit_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit.audit_logs is immutable — UPDATE and DELETE are forbidden (HIPAA tamper-proofing). Use partition drop for retention.';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit.audit_logs;
CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE ON audit.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit.fn_audit_immutable();

DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit.audit_logs;
CREATE TRIGGER trg_audit_no_delete
  BEFORE DELETE ON audit.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit.fn_audit_immutable();

ALTER TABLE audit.audit_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY audit_logs_no_delete ON audit.audit_logs
    AS RESTRICTIVE FOR DELETE USING (FALSE);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY audit_logs_no_update ON audit.audit_logs
    AS RESTRICTIVE FOR UPDATE USING (FALSE);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  GRANT SELECT, INSERT ON audit.audit_logs TO PUBLIC;
  REVOKE UPDATE, DELETE ON audit.audit_logs FROM PUBLIC;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Optional: drop legacy after successful migration (kept by default for safety).
-- Uncomment after verifying row counts:
-- DROP TABLE IF EXISTS audit.audit_logs_legacy;

SELECT 'V3_6__audit_log_partitioning completed' AS status;
