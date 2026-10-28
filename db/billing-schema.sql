CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('monthly', 'yearly')),
  status TEXT NOT NULL,
  period_ends_at TIMESTAMPTZ,
  grace_ends_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS billing_subscriptions_user_id_idx
  ON billing_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS credit_grants (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL CHECK (bucket IN ('subscription', 'rollover', 'booster', 'free')),
  granted BIGINT NOT NULL CHECK (granted >= 0),
  remaining BIGINT NOT NULL CHECK (remaining >= 0 AND remaining <= granted),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  source_event_id TEXT NOT NULL,
  external_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_event_id, bucket)
);

ALTER TABLE credit_grants DROP CONSTRAINT IF EXISTS credit_grants_bucket_check;
ALTER TABLE credit_grants
  ADD CONSTRAINT credit_grants_bucket_check
  CHECK (bucket IN ('subscription', 'rollover', 'booster', 'free'));

CREATE INDEX IF NOT EXISTS credit_grants_available_idx
  ON credit_grants(user_id, bucket, expires_at, created_at)
  WHERE remaining > 0 AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS credit_grants_payment_idx
  ON credit_grants(external_payment_id)
  WHERE external_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS credit_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  allocations JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS credit_reservations_user_id_idx
  ON credit_reservations(user_id, created_at);

CREATE TABLE IF NOT EXISTS dodo_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
