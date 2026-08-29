-- migrate:up

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE org_credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_credit_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE credit_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE model_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_configurations FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

CREATE FUNCTION app_current_org_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$
    SELECT NULLIF(current_setting('app.current_org', true), '')::uuid
$$;

CREATE FUNCTION app_is_system() RETURNS boolean
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE(NULLIF(current_setting('app.is_system', true), '')::boolean, false)
$$;

CREATE POLICY org_isolation ON organizations FOR ALL
    USING (id = app_current_org_id() OR app_is_system())
    WITH CHECK (id = app_current_org_id() OR app_is_system());

CREATE POLICY org_isolation ON memberships FOR ALL
    USING (org_id = app_current_org_id() OR app_is_system())
    WITH CHECK (org_id = app_current_org_id() OR app_is_system());

CREATE POLICY org_isolation ON invitations FOR ALL
    USING (org_id = app_current_org_id() OR app_is_system())
    WITH CHECK (org_id = app_current_org_id() OR app_is_system());

CREATE POLICY org_isolation ON org_credit_accounts FOR ALL
    USING (org_id = app_current_org_id() OR app_is_system())
    WITH CHECK (org_id = app_current_org_id() OR app_is_system());

CREATE POLICY org_isolation ON credit_ledger FOR ALL
    USING (org_id = app_current_org_id() OR app_is_system())
    WITH CHECK (org_id = app_current_org_id() OR app_is_system());

CREATE POLICY org_isolation ON credit_reservations FOR ALL
    USING (org_id = app_current_org_id() OR app_is_system())
    WITH CHECK (org_id = app_current_org_id() OR app_is_system());

CREATE POLICY org_isolation ON purchases FOR ALL
    USING (org_id = app_current_org_id() OR app_is_system())
    WITH CHECK (org_id = app_current_org_id() OR app_is_system());

CREATE POLICY org_isolation ON idempotency_keys FOR ALL
    USING (org_id = app_current_org_id() OR app_is_system())
    WITH CHECK (org_id = app_current_org_id() OR app_is_system());

CREATE POLICY org_isolation ON model_configurations FOR ALL
    USING (org_id = app_current_org_id() OR app_is_system())
    WITH CHECK (org_id = app_current_org_id() OR app_is_system());

CREATE POLICY org_isolation ON audit_events FOR ALL
    USING (org_id = app_current_org_id() OR app_is_system())
    WITH CHECK (org_id = app_current_org_id() OR app_is_system());

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'craftifai_app') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA public TO craftifai_app';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO craftifai_app';
        EXECUTE 'REVOKE UPDATE, DELETE ON credit_ledger, audit_events FROM craftifai_app';
    END IF;
END
$$;

-- migrate:down

DROP POLICY IF EXISTS org_isolation ON audit_events;
DROP POLICY IF EXISTS org_isolation ON model_configurations;
DROP POLICY IF EXISTS org_isolation ON idempotency_keys;
DROP POLICY IF EXISTS org_isolation ON purchases;
DROP POLICY IF EXISTS org_isolation ON credit_reservations;
DROP POLICY IF EXISTS org_isolation ON credit_ledger;
DROP POLICY IF EXISTS org_isolation ON org_credit_accounts;
DROP POLICY IF EXISTS org_isolation ON invitations;
DROP POLICY IF EXISTS org_isolation ON memberships;
DROP POLICY IF EXISTS org_isolation ON organizations;
DROP FUNCTION IF EXISTS app_is_system();
DROP FUNCTION IF EXISTS app_current_org_id();

ALTER TABLE audit_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE model_configurations DISABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys DISABLE ROW LEVEL SECURITY;
ALTER TABLE purchases DISABLE ROW LEVEL SECURITY;
ALTER TABLE credit_reservations DISABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger DISABLE ROW LEVEL SECURITY;
ALTER TABLE org_credit_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE invitations DISABLE ROW LEVEL SECURITY;
ALTER TABLE memberships DISABLE ROW LEVEL SECURITY;
ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;
