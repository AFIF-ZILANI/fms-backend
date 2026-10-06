-- The audit log is the record of who did what, so it must not be editable. Nothing in the app updates
-- or deletes it (the routes are read-only), which makes this a pure backstop: a buggy service, a stray
-- script or a manual fix can no longer rewrite history.
--
--  * UPDATE and TRUNCATE are always refused.
--  * DELETE is refused unless the session has set app.allow_audit_purge = 'on' (inside its own
--    transaction). That exists only so test cleanup can remove the rows it created; the app never sets it.
--
-- This stops bugs and casual edits, not a determined database owner: anyone with ownership can drop the
-- trigger or set the flag. Real tamper-proofing is REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" from
-- the role the app connects as (migrations run as the owner) -- see docs/audit/*/07-status.md.
CREATE FUNCTION audit_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only (% is not allowed)', TG_OP;
END
$$;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_guard();
