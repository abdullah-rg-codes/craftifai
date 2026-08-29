-- migrate:up

CREATE TYPE purchase_status AS ENUM ('pending', 'completed', 'failed');
CREATE TYPE idempotency_status AS ENUM ('pending', 'completed', 'failed');
CREATE TYPE deployment_mode AS ENUM ('saas', 'onprem');

CREATE TABLE purchases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    credits bigint NOT NULL CHECK (credits > 0),
    status purchase_status NOT NULL DEFAULT 'pending',
    provider_event_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

CREATE INDEX idx_purchases_org_created ON purchases (org_id, created_at, id);

CREATE TABLE webhook_events (
    provider_event_id text PRIMARY KEY,
    payload_hash bytea NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz
);

CREATE TABLE idempotency_keys (
    org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    endpoint text NOT NULL,
    key text NOT NULL,
    request_fingerprint bytea NOT NULL,
    status idempotency_status NOT NULL DEFAULT 'pending',
    response_status int,
    response_body jsonb,
    reservation_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (org_id, endpoint, key)
);

CREATE INDEX idx_idempotency_keys_expires_pending ON idempotency_keys (expires_at) WHERE status = 'pending';

CREATE TABLE model_configurations (
    org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    deployment_mode deployment_mode NOT NULL DEFAULT 'saas',
    endpoint_url text NOT NULL,
    model_name text NOT NULL,
    credential_ciphertext bytea,
    credential_key_version int,
    credential_updated_at timestamptz,
    timeout_ms int NOT NULL DEFAULT 30000 CHECK (timeout_ms BETWEEN 1000 AND 120000),
    ca_bundle bytea,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action text NOT NULL,
    target_type text,
    target_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_events_org_created ON audit_events (org_id, created_at, id);

-- migrate:down

DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS model_configurations;
DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS webhook_events;
DROP TABLE IF EXISTS purchases;
DROP TYPE IF EXISTS deployment_mode;
DROP TYPE IF EXISTS idempotency_status;
DROP TYPE IF EXISTS purchase_status;
