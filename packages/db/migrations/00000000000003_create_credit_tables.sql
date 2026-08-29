-- migrate:up

CREATE TYPE ledger_kind AS ENUM ('purchase', 'reservation', 'settlement', 'release', 'expiry');
CREATE TYPE reservation_status AS ENUM ('reserved', 'settled', 'released', 'expired');

CREATE TABLE org_credit_accounts (
    org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    available bigint NOT NULL DEFAULT 0 CHECK (available >= 0),
    reserved bigint NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credit_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kind ledger_kind NOT NULL,
    delta_available bigint NOT NULL,
    delta_reserved bigint NOT NULL,
    reservation_id uuid,
    purchase_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (delta_available <> 0 OR delta_reserved <> 0)
);

CREATE INDEX idx_credit_ledger_org_created ON credit_ledger (org_id, created_at, id);
CREATE INDEX idx_credit_ledger_reservation ON credit_ledger (reservation_id);

CREATE TABLE credit_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status reservation_status NOT NULL,
    reserved_credits bigint NOT NULL CHECK (reserved_credits > 0),
    max_total_tokens int NOT NULL,
    actual_total_tokens int,
    settled_credits bigint,
    expires_at timestamptz NOT NULL,
    settled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_reservations_org_created ON credit_reservations (org_id, created_at, id);
CREATE INDEX idx_credit_reservations_user_created ON credit_reservations (user_id, created_at, id);
CREATE INDEX idx_credit_reservations_expires_reserved ON credit_reservations (expires_at) WHERE status = 'reserved';

-- migrate:down

DROP TABLE IF EXISTS credit_reservations;
DROP TABLE IF EXISTS credit_ledger;
DROP TABLE IF EXISTS org_credit_accounts;
DROP TYPE IF EXISTS reservation_status;
DROP TYPE IF EXISTS ledger_kind;
