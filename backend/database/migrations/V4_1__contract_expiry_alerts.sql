-- =============================================================================
-- V4_1__contract_expiry_alerts.sql
-- Automated contract expiry / renewal alert records + mark-expired helper
-- =============================================================================

CREATE TABLE IF NOT EXISTS nursing.contract_alerts (
  id              BIGSERIAL PRIMARY KEY,
  contract_id     BIGINT NOT NULL REFERENCES nursing.employment_contracts(id) ON DELETE CASCADE,
  alert_type      VARCHAR(50)  NOT NULL,
  severity        VARCHAR(20)  NOT NULL DEFAULT 'Warning',
  threshold_days  INTEGER,
  message         TEXT NOT NULL,
  end_date        DATE,
  acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_by BIGINT,
  acknowledged_at TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (contract_id, alert_type, threshold_days)
);

CREATE INDEX IF NOT EXISTS idx_contract_alerts_unacked
  ON nursing.contract_alerts (acknowledged, severity, created_at DESC)
  WHERE acknowledged = FALSE;

CREATE INDEX IF NOT EXISTS idx_contract_alerts_contract
  ON nursing.contract_alerts (contract_id);

COMMENT ON TABLE nursing.contract_alerts IS
  'Automated expiry/renewal alerts for employment contracts. Deduped by (contract, type, threshold).';

CREATE OR REPLACE FUNCTION nursing.mark_expired_contracts()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, status, contract_number
    FROM nursing.employment_contracts
    WHERE status = 'Active'
      AND end_date IS NOT NULL
      AND end_date < CURRENT_DATE
  LOOP
    UPDATE nursing.employment_contracts
    SET status = 'Expired',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = r.id;

    INSERT INTO nursing.contract_status_history (contract_id, from_status, to_status, reason, changed_by)
    VALUES (r.id, 'Active', 'Expired', 'Auto-expired by scheduled job (end_date passed)', NULL);

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION nursing.mark_expired_contracts IS
  'Sets Active contracts past end_date to Expired and writes status history. Returns count updated.';

CREATE OR REPLACE FUNCTION nursing.generate_contract_expiry_alerts(
  p_thresholds INT[] DEFAULT ARRAY[90, 60, 30, 14, 7]
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER := 0;
  t INT;
  r RECORD;
  v_days_left INT;
  v_severity TEXT;
  v_msg TEXT;
  v_inserted INT;
BEGIN
  FOREACH t IN ARRAY p_thresholds LOOP
    FOR r IN
      SELECT c.id, c.contract_number, c.end_date, c.job_no, n.first_name, n.last_name,
             (c.end_date - CURRENT_DATE) AS days_left
      FROM nursing.employment_contracts c
      JOIN nursing.nurses n ON n.id = c.nurse_id
      WHERE c.status = 'Active'
        AND c.end_date IS NOT NULL
        AND c.end_date >= CURRENT_DATE
        AND (c.end_date - CURRENT_DATE) <= t
        AND (c.end_date - CURRENT_DATE) > COALESCE(
              (SELECT MAX(x) FROM unnest(p_thresholds) AS x WHERE x < t),
              -1
            )
    LOOP
      v_days_left := r.days_left;

      IF t <= 7 THEN
        v_severity := 'Critical';
      ELSIF t <= 30 THEN
        v_severity := 'Warning';
      ELSE
        v_severity := 'Info';
      END IF;

      v_msg := format(
        'Contract %s for %s %s (Job No. %s) expires in %s day(s) on %s',
        r.contract_number,
        COALESCE(r.first_name, ''),
        COALESCE(r.last_name, ''),
        COALESCE(r.job_no, '—'),
        v_days_left,
        r.end_date
      );

      INSERT INTO nursing.contract_alerts (
        contract_id, alert_type, severity, threshold_days, message, end_date
      ) VALUES (
        r.id, 'EXPIRING_SOON', v_severity, t, v_msg, r.end_date
      )
      ON CONFLICT (contract_id, alert_type, threshold_days) DO NOTHING;

      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      IF v_inserted > 0 THEN
        v_count := v_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  FOR r IN
    SELECT c.id, c.contract_number, c.end_date, c.job_no, n.first_name, n.last_name
    FROM nursing.employment_contracts c
    JOIN nursing.nurses n ON n.id = c.nurse_id
    WHERE c.status IN ('Active', 'Expired')
      AND c.end_date IS NOT NULL
      AND c.end_date < CURRENT_DATE
  LOOP
    v_msg := format(
      'Contract %s for %s %s (Job No. %s) expired on %s',
      r.contract_number,
      COALESCE(r.first_name, ''),
      COALESCE(r.last_name, ''),
      COALESCE(r.job_no, '—'),
      r.end_date
    );

    INSERT INTO nursing.contract_alerts (
      contract_id, alert_type, severity, threshold_days, message, end_date
    ) VALUES (
      r.id, 'EXPIRED', 'Critical', 0, v_msg, r.end_date
    )
    ON CONFLICT (contract_id, alert_type, threshold_days) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted > 0 THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION nursing.generate_contract_expiry_alerts IS
  'Inserts EXPIRING_SOON / EXPIRED alert rows for Active contracts. Deduped per threshold. Returns new alert count.';

SELECT 'V4_1__contract_expiry_alerts completed' AS status;
