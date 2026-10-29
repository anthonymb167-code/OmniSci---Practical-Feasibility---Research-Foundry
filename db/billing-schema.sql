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
  subscription_id TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'test' CHECK (environment IN ('test', 'live')),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('monthly', 'yearly')),
  status TEXT NOT NULL,
  period_ends_at TIMESTAMPTZ,
  grace_ends_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (environment, subscription_id)
);

ALTER TABLE billing_subscriptions
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'test';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'billing_subscriptions'::regclass
      AND conname = 'billing_subscriptions_pkey'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (subscription_id)'
  ) THEN
    ALTER TABLE billing_subscriptions DROP CONSTRAINT billing_subscriptions_pkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'billing_subscriptions'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE billing_subscriptions
      ADD CONSTRAINT billing_subscriptions_pkey PRIMARY KEY (environment, subscription_id);
  END IF;
END $$;

ALTER TABLE billing_subscriptions
  DROP CONSTRAINT IF EXISTS billing_subscriptions_environment_check;
ALTER TABLE billing_subscriptions
  ADD CONSTRAINT billing_subscriptions_environment_check
  CHECK (environment IN ('test', 'live'));

CREATE INDEX IF NOT EXISTS billing_subscriptions_environment_user_idx
  ON billing_subscriptions(environment, user_id);

CREATE TABLE IF NOT EXISTS credit_grants (
  id BIGSERIAL PRIMARY KEY,
  environment TEXT NOT NULL DEFAULT 'test' CHECK (environment IN ('test', 'live')),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL CHECK (bucket IN ('subscription', 'rollover', 'booster', 'free')),
  granted BIGINT NOT NULL CHECK (granted >= 0),
  remaining BIGINT NOT NULL CHECK (remaining >= 0 AND remaining <= granted),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  source_event_id TEXT NOT NULL,
  external_payment_id TEXT,
  refunded_credits BIGINT NOT NULL DEFAULT 0 CHECK (refunded_credits >= 0 AND refunded_credits <= granted),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, source_event_id, bucket)
);

ALTER TABLE credit_grants
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'test';
ALTER TABLE credit_grants
  ADD COLUMN IF NOT EXISTS refunded_credits BIGINT NOT NULL DEFAULT 0;
ALTER TABLE credit_grants
  DROP CONSTRAINT IF EXISTS credit_grants_refunded_credits_check;
ALTER TABLE credit_grants
  ADD CONSTRAINT credit_grants_refunded_credits_check
  CHECK (refunded_credits >= 0 AND refunded_credits <= granted);

ALTER TABLE credit_grants
  DROP CONSTRAINT IF EXISTS credit_grants_source_event_id_bucket_key;
ALTER TABLE credit_grants
  DROP CONSTRAINT IF EXISTS credit_grants_environment_check;
ALTER TABLE credit_grants
  ADD CONSTRAINT credit_grants_environment_check
  CHECK (environment IN ('test', 'live'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'credit_grants'::regclass
      AND conname = 'credit_grants_environment_source_event_id_bucket_key'
  ) THEN
    ALTER TABLE credit_grants
      ADD CONSTRAINT credit_grants_environment_source_event_id_bucket_key
      UNIQUE (environment, source_event_id, bucket);
  END IF;
END $$;

ALTER TABLE credit_grants DROP CONSTRAINT IF EXISTS credit_grants_bucket_check;
ALTER TABLE credit_grants
  ADD CONSTRAINT credit_grants_bucket_check
  CHECK (bucket IN ('subscription', 'rollover', 'booster', 'free'));

CREATE INDEX IF NOT EXISTS credit_grants_environment_available_idx
  ON credit_grants(environment, user_id, bucket, expires_at, created_at)
  WHERE remaining > 0 AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS credit_grants_environment_payment_idx
  ON credit_grants(environment, external_payment_id)
  WHERE external_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_payments (
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  payment_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_amount BIGINT CHECK (total_amount IS NULL OR total_amount >= 0),
  currency TEXT,
  subscription_id TEXT,
  service_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (environment, payment_id)
);

CREATE INDEX IF NOT EXISTS billing_payments_environment_subscription_period_idx
  ON billing_payments(environment, subscription_id, service_period_end);

CREATE TABLE IF NOT EXISTS billing_refunds (
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  refund_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  amount BIGINT CHECK (amount IS NULL OR amount >= 0),
  currency TEXT,
  status TEXT NOT NULL CHECK (status IN ('processed', 'needs_review')),
  credits_removed BIGINT NOT NULL DEFAULT 0 CHECK (credits_removed >= 0),
  credits_shortfall BIGINT NOT NULL DEFAULT 0 CHECK (credits_shortfall >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (environment, refund_id)
);

CREATE TABLE IF NOT EXISTS credit_reservations (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL DEFAULT 'test' CHECK (environment IN ('test', 'live')),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  allocations JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE credit_reservations
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'test';
ALTER TABLE credit_reservations
  DROP CONSTRAINT IF EXISTS credit_reservations_environment_check;
ALTER TABLE credit_reservations
  ADD CONSTRAINT credit_reservations_environment_check
  CHECK (environment IN ('test', 'live'));

CREATE INDEX IF NOT EXISTS credit_reservations_environment_user_idx
  ON credit_reservations(environment, user_id, created_at);

CREATE TABLE IF NOT EXISTS dodo_webhook_events (
  event_id TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'test' CHECK (environment IN ('test', 'live')),
  event_type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (environment, event_id)
);

ALTER TABLE dodo_webhook_events
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'test';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'dodo_webhook_events'::regclass
      AND conname = 'dodo_webhook_events_pkey'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (event_id)'
  ) THEN
    ALTER TABLE dodo_webhook_events DROP CONSTRAINT dodo_webhook_events_pkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'dodo_webhook_events'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE dodo_webhook_events
      ADD CONSTRAINT dodo_webhook_events_pkey PRIMARY KEY (environment, event_id);
  END IF;
END $$;

ALTER TABLE dodo_webhook_events
  DROP CONSTRAINT IF EXISTS dodo_webhook_events_environment_check;
ALTER TABLE dodo_webhook_events
  ADD CONSTRAINT dodo_webhook_events_environment_check
  CHECK (environment IN ('test', 'live'));
