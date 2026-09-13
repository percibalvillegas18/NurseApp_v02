-- =============================================================================
-- V4_2__contract_active_exclusivity.sql
-- Option A: GiST exclusion — at most one Active contract per nurse per day
-- Aligns with nurse_has_valid_contract closed interval [start_date, end_date]
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
DECLARE
  r RECORD;
  keeper BIGINT;
BEGIN
  FOR r IN
    SELECT DISTINCT a.nurse_id
    FROM nursing.employment_contracts a
    JOIN nursing.employment_contracts b
      ON a.nurse_id = b.nurse_id
     AND a.id < b.id
     AND a.status = 'Active'
     AND b.status = 'Active'
     AND a.start_date <= COALESCE(b.end_date, 'infinity'::date)
     AND b.start_date <= COALESCE(a.end_date, 'infinity'::date)
  LOOP
    SELECT c.id INTO keeper
    FROM nursing.employment_contracts c
    WHERE c.nurse_id = r.nurse_id
      AND c.status = 'Active'
    ORDER BY c.activated_at DESC NULLS LAST, c.id DESC
    LIMIT 1;

    UPDATE nursing.employment_contracts c
    SET status = 'Superseded',
        updated_at = CURRENT_TIMESTAMP,
        notes = COALESCE(c.notes || E'\n', '') ||
                format('[V4_2] Auto-superseded: overlapping Active; keeper contract id=%s', keeper)
    WHERE c.nurse_id = r.nurse_id
      AND c.status = 'Active'
      AND c.id <> keeper;

    INSERT INTO nursing.contract_status_history (contract_id, from_status, to_status, reason, changed_by)
    SELECT c.id, 'Active', 'Superseded',
           format('V4_2 exclusivity backfill; keeper id=%s', keeper),
           NULL
    FROM nursing.employment_contracts c
    WHERE c.nurse_id = r.nurse_id
      AND c.status = 'Superseded'
      AND c.updated_at >= CURRENT_TIMESTAMP - INTERVAL '1 minute'
      AND c.notes LIKE '%[V4_2] Auto-superseded%';
  END LOOP;
END;
$$;

ALTER TABLE nursing.employment_contracts
  ADD COLUMN IF NOT EXISTS active_span daterange
  GENERATED ALWAYS AS (
    CASE
      WHEN status = 'Active' THEN
        daterange(
          start_date,
          COALESCE(end_date, 'infinity'::date),
          '[]'
        )
      ELSE NULL
    END
  ) STORED;

COMMENT ON COLUMN nursing.employment_contracts.active_span IS
  'Active-only closed date span for GiST exclusion; NULL when not Active.';

ALTER TABLE nursing.employment_contracts
  DROP CONSTRAINT IF EXISTS emp_contracts_active_no_overlap;

ALTER TABLE nursing.employment_contracts
  ADD CONSTRAINT emp_contracts_active_no_overlap
  EXCLUDE USING gist (
    nurse_id WITH =,
    active_span WITH &&
  )
  WHERE (status = 'Active');

COMMENT ON CONSTRAINT emp_contracts_active_no_overlap ON nursing.employment_contracts IS
  'At most one Active employment contract per nurse for any overlapping calendar day.';

CREATE OR REPLACE FUNCTION nursing.nurse_active_contract_id(
  p_nurse_id BIGINT,
  p_on_date  DATE DEFAULT CURRENT_DATE
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT c.id
  FROM nursing.employment_contracts c
  WHERE c.nurse_id = p_nurse_id
    AND c.status = 'Active'
    AND c.start_date <= p_on_date
    AND (c.end_date IS NULL OR c.end_date >= p_on_date)
  ORDER BY c.activated_at DESC NULLS LAST, c.id DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION nursing.nurse_active_contract_id IS
  'Returns the Active contract id covering p_on_date, or NULL. Exclusivity ensures at most one.';

SELECT 'V4_2__contract_active_exclusivity completed' AS status;
