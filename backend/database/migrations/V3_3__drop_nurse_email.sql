-- ============================================================================
-- V3_3__drop_nurse_email.sql - Nurse email comes from the user account
-- Purpose: Remove nursing.nurses.email - a nurse's email address is owned by
--          the linked login (auth.users.email via user_id). Avoids two
--          sources of truth; the API surfaces the user email on read.
-- ============================================================================

ALTER TABLE nursing.nurses DROP COLUMN IF EXISTS email;

COMMENT ON COLUMN nursing.nurses.user_id IS 'Login account link; email address is sourced from auth.users.email.';
