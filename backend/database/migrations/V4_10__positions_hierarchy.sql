-- V4_10__positions_hierarchy.sql
-- Additive position hierarchy for the existing nursing.positions catalog.
-- Position hierarchy is employment metadata; it is not an authorization role
-- hierarchy and does not change nurse position_code compatibility.

ALTER TABLE nursing.positions
  ADD COLUMN IF NOT EXISTS parent_position_id BIGINT
    REFERENCES nursing.positions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_positions_parent
  ON nursing.positions(parent_position_id);

CREATE OR REPLACE FUNCTION nursing.validate_position_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.parent_position_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_position_id = NEW.id THEN
    RAISE EXCEPTION 'A position cannot be its own parent';
  END IF;

  IF EXISTS (
    WITH RECURSIVE ancestors(id, level) AS (
      SELECT p.parent_position_id, 1
      FROM nursing.positions p
      WHERE p.id = NEW.parent_position_id
      UNION ALL
      SELECT p.parent_position_id, a.level + 1
      FROM nursing.positions p
      JOIN ancestors a ON a.id = p.id
      WHERE a.id IS NOT NULL
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Position hierarchy cannot contain a cycle';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_position_parent ON nursing.positions;
CREATE TRIGGER trg_validate_position_parent
  BEFORE INSERT OR UPDATE OF parent_position_id ON nursing.positions
  FOR EACH ROW EXECUTE FUNCTION nursing.validate_position_parent();

-- The supplied catalog is retained; these links describe reporting levels
-- without changing the existing position codes or contract references.
UPDATE nursing.positions child
SET parent_position_id = parent.id
FROM nursing.positions parent
WHERE child.code = 'AHN' AND parent.code = 'HN';

UPDATE nursing.positions child
SET parent_position_id = parent.id
FROM nursing.positions parent
WHERE child.code IN ('CI', 'CN', 'MW') AND parent.code = 'HN';

UPDATE nursing.positions child
SET parent_position_id = parent.id
FROM nursing.positions parent
WHERE child.code IN ('SN', 'PCT', 'TEC', 'HCA') AND parent.code = 'CN';

COMMENT ON COLUMN nursing.positions.parent_position_id IS
  'Optional parent position in the employment hierarchy; authorization roles remain separate.';
