-- migrate:up

CREATE TYPE membership_role AS ENUM ('administrator', 'member');
CREATE TYPE membership_status AS ENUM ('active', 'suspended');
CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');

CREATE TABLE memberships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role membership_role NOT NULL,
    status membership_status NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, user_id)
);

CREATE INDEX idx_memberships_org_created ON memberships (org_id, created_at, id);
CREATE INDEX idx_memberships_user_id ON memberships (user_id);
CREATE INDEX idx_memberships_org_role_status ON memberships (org_id, role, status);

CREATE TABLE invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email citext NOT NULL,
    role membership_role NOT NULL,
    token_hash bytea NOT NULL UNIQUE,
    invited_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status invitation_status NOT NULL DEFAULT 'pending',
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, email) WHERE status = 'pending'
);

CREATE INDEX idx_invitations_org ON invitations (org_id);

-- migrate:down

DROP TABLE IF EXISTS invitations;
DROP TABLE IF EXISTS memberships;
DROP TYPE IF EXISTS invitation_status;
DROP TYPE IF EXISTS membership_status;
DROP TYPE IF EXISTS membership_role;
