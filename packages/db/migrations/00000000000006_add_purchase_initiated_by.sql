-- migrate:up

ALTER TABLE purchases
    ADD COLUMN initiated_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;

-- migrate:down

ALTER TABLE purchases DROP COLUMN IF EXISTS initiated_by_user_id;
