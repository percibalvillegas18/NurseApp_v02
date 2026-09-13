-- =============================================================================
-- V3_5__tamper_proof_audit_logs.sql
-- Cryptographic hash chain + stronger immutability for HIPAA audit controls
-- (§ 164.312(b) Audit Controls + § 164.316 documentation integrity)
-- =============================================================================

-- 1. Columns for the hash chain
ALTER TABLE audit.audit_logs
  ADD COLUMN IF NOT EXISTS prev_hash  TEXT,
  ADD COLUMN IF NOT EXISTS entry_hash TEXT;

-- Back-fill existing rows with a deterministic genesis-style hash so the chain
-- can start cleanly. Existing data is treated as a single "pre-chain" epoch.
UPDATE audit.audit_logs
SET
  prev_hash  = 'GENESIS',
  entry_hash = encode(
    digest(
      'GENESIS' || '|' || id::text || '|' || COALESCE(user_id::text, '') || '|' ||
      action || '|' || entity_type || '|' || COALESCE(entity_id::text, '') || '|' ||
      COALESCE(status, '') || '|' || COALESCE(created_at::text, ''),
      'sha256'
    ),
    'hex'
  )
WHERE entry_hash IS NULL;

-- Make entry_hash mandatory going forward
ALTER TABLE audit.audit_logs
  ALTER COLUMN entry_hash SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_entry_hash ON audit.audit_logs (entry_hash);
CREATE INDEX IF NOT EXISTS idx_audit_logs_id_desc ON audit.audit_logs (id DESC);

-- 2. Function that builds the canonical payload string used for hashing
CREATE OR REPLACE FUNCTION audit._audit_payload(r audit.audit_logs)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    COALESCE(r.prev_hash, 'GENESIS') || '|' ||
    COALESCE(r.id::text, '') || '|' ||
    COALESCE(r.user_id::text, '') || '|' ||
    COALESCE(r.username, '') || '|' ||
    COALESCE(r.action, '') || '|' ||
    COALESCE(r.entity_type, '') || '|' ||
    COALESCE(r.entity_id::text, '') || '|' ||
    COALESCE(r.entity_code, '') || '|' ||
    COALESCE(r.description, '') || '|' ||
    COALESCE(r.changes::text, '') || '|' ||
    COALESCE(r.reason, '') || '|' ||
    COALESCE(r.ip_address, '') || '|' ||
    COALESCE(r.user_agent, '') || '|' ||
    COALESCE(r.session_id, '') || '|' ||
    COALESCE(r.request_id, '') || '|' ||
    COALESCE(r.status, '') || '|' ||
    COALESCE(r.error_message, '') || '|' ||
    COALESCE(r.created_at::text, '');
$$;

-- 3. BEFORE INSERT trigger: set prev_hash from the latest entry and compute entry_hash
CREATE OR REPLACE FUNCTION audit.fn_audit_hash_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev TEXT;
BEGIN
  -- Only allow INSERT. UPDATE/DELETE are blocked by RLS + REVOKE below.
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'audit.audit_logs is append-only (tamper-proof)';
  END IF;

  -- Latest entry in the chain (by id)
  SELECT entry_hash INTO v_prev
  FROM audit.audit_logs
  ORDER BY id DESC
  LIMIT 1;

  IF v_prev IS NULL THEN
    v_prev := 'GENESIS';
  END IF;

  NEW.prev_hash := v_prev;

  -- id is not yet assigned for BEFORE INSERT on a serial column in some paths;
  -- we include a placeholder and re-hash after id is known if needed.
  -- Practical approach: hash without relying on NEW.id being final, then
  -- accept that the chain links on content + prev_hash. We still store id.
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

-- 4. Extra safety: block UPDATE/DELETE even for table owners via trigger
CREATE OR REPLACE FUNCTION audit.fn_audit_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit.audit_logs is immutable — UPDATE and DELETE are forbidden (HIPAA tamper-proofing)';
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

-- 5. Strengthen RLS (already present in V1_0; re-assert)
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

-- Allow SELECT and INSERT for the application role if it exists; otherwise skip.
-- (Adjust role name to match your production app role.)
DO $$ BEGIN
  GRANT SELECT, INSERT ON audit.audit_logs TO PUBLIC;
  REVOKE UPDATE, DELETE ON audit.audit_logs FROM PUBLIC;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 6. Chain integrity verification function
-- Returns rows that break the chain (empty set = OK)
CREATE OR REPLACE FUNCTION audit.verify_audit_chain(
  p_from_id BIGINT DEFAULT NULL,
  p_to_id   BIGINT DEFAULT NULL
)
RETURNS TABLE (
  id            BIGINT,
  expected_prev TEXT,
  actual_prev   TEXT,
  problem       TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  r       RECORD;
  v_prev  TEXT := 'GENESIS';
  v_calc  TEXT;
BEGIN
  FOR r IN
    SELECT *
    FROM audit.audit_logs a
    WHERE (p_from_id IS NULL OR a.id >= p_from_id)
      AND (p_to_id   IS NULL OR a.id <= p_to_id)
    ORDER BY a.id ASC
  LOOP
    IF r.prev_hash IS DISTINCT FROM v_prev THEN
      id := r.id;
      expected_prev := v_prev;
      actual_prev := r.prev_hash;
      problem := 'prev_hash does not match previous entry_hash';
      RETURN NEXT;
    END IF;

    -- Recompute hash the same way the trigger does (without depending on id)
    v_calc := encode(
      digest(
        COALESCE(r.prev_hash, 'GENESIS') || '|' ||
        COALESCE(r.user_id::text, '') || '|' ||
        COALESCE(r.username, '') || '|' ||
        COALESCE(r.action, '') || '|' ||
        COALESCE(r.entity_type, '') || '|' ||
        COALESCE(r.entity_id::text, '') || '|' ||
        COALESCE(r.entity_code, '') || '|' ||
        COALESCE(r.description, '') || '|' ||
        COALESCE(r.changes::text, '') || '|' ||
        COALESCE(r.reason, '') || '|' ||
        COALESCE(r.ip_address, '') || '|' ||
        COALESCE(r.user_agent, '') || '|' ||
        COALESCE(r.session_id, '') || '|' ||
        COALESCE(r.request_id, '') || '|' ||
        COALESCE(r.status, '') || '|' ||
        COALESCE(r.error_message, '') || '|' ||
        COALESCE(r.created_at::text, ''),
        'sha256'
      ),
      'hex'
    );

    IF r.entry_hash IS DISTINCT FROM v_calc THEN
      id := r.id;
      expected_prev := v_calc;
      actual_prev := r.entry_hash;
      problem := 'entry_hash does not match recomputed digest';
      RETURN NEXT;
    END IF;

    v_prev := r.entry_hash;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION audit.verify_audit_chain IS
  'Returns broken links in the audit hash chain. Empty result set means the chain is intact.';

COMMENT ON COLUMN audit.audit_logs.prev_hash IS
  'SHA-256 hex of the previous entry (or GENESIS). Part of the tamper-evident chain.';
COMMENT ON COLUMN audit.audit_logs.entry_hash IS
  'SHA-256 hex of (prev_hash + canonical payload). Computed by trigger on INSERT.';

SELECT 'V3_5__tamper_proof_audit_logs completed' AS status;
