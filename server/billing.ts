import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express, { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Pool, PoolClient } from 'pg';
import { Webhook } from 'standardwebhooks';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config({ path: ['.env.local', '.env'] });

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'omnisci_session';
const SESSION_DURATION_DAYS = 30;
const ROLLOVER_CAP = 3000;
const FREE_MONTHLY_CREDITS = 50;
const MONTHLY_CREDITS = 10000;
const YEARLY_CREDITS = 13500;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const billingPool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.PGSSL === 'true'
          ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' }
          : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
  : null;

type PlanKey = 'monthly' | 'yearly' | 'starter' | 'power';
type Bucket = 'subscription' | 'rollover' | 'booster' | 'free';

interface ProductPlan {
  key: PlanKey;
  label: string;
  price: string;
  productId: string | undefined;
  kind: 'subscription' | 'booster';
  credits: number;
}

interface BillingUser {
  id: string;
  email: string;
}

interface BillingRequest extends Request {
  rawBody?: string;
  billingUser?: BillingUser;
  creditReservationId?: string;
}

interface CreditAllocation {
  grantId: string;
  bucket: Bucket;
  amount: number;
}

const plans: ProductPlan[] = [
  {
    key: 'monthly',
    label: 'Monthly',
    price: '$10/month',
    productId: process.env.DODO_PRODUCT_ID_MONTHLY,
    kind: 'subscription',
    credits: MONTHLY_CREDITS,
  },
  {
    key: 'yearly',
    label: 'Yearly',
    price: '$96/year',
    productId: process.env.DODO_PRODUCT_ID_YEARLY,
    kind: 'subscription',
    credits: YEARLY_CREDITS,
  },
  {
    key: 'starter',
    label: 'Starter Booster',
    price: '$5 one time',
    productId: process.env.DODO_PRODUCT_ID_STARTER,
    kind: 'booster',
    credits: 500,
  },
  {
    key: 'power',
    label: 'Power User Booster',
    price: '$20 one time',
    productId: process.env.DODO_PRODUCT_ID_POWER,
    kind: 'booster',
    credits: 2500,
  },
];

export async function initializeBillingDatabase(): Promise<void> {
  if (!billingPool) return;

  const schemaPath = path.resolve(__dirname, '../db/billing-schema.sql');
  await billingPool.query(readFileSync(schemaPath, 'utf8'));
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function getCookie(req: Request, name: string): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;

  const entry = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : undefined;
}

function setSessionCookie(res: Response, token: string): void {
  const maxAge = SESSION_DURATION_DAYS * 24 * 60 * 60;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function clearSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function getProductPlan(key: unknown): ProductPlan | undefined {
  return plans.find((plan) => plan.key === key && plan.productId);
}

async function getSessionUser(req: Request): Promise<BillingUser | null> {
  if (!billingPool) return null;

  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;

  const result = await billingPool.query<BillingUser>(
    `SELECT users.id, users.email
     FROM user_sessions
     JOIN users ON users.id = user_sessions.user_id
     WHERE user_sessions.token_hash = $1
       AND user_sessions.expires_at > NOW()
       AND users.email_verified = TRUE`,
    [hashToken(token)]
  );

  return result.rows[0] ?? null;
}

async function createSession(userId: string, res: Response): Promise<void> {
  if (!billingPool) throw new Error('Billing database is unavailable.');

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000);
  await billingPool.query(
    `INSERT INTO user_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, $3)`,
    [hashToken(token), userId, expiresAt]
  );
  setSessionCookie(res, token);
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, saltValue, expectedValue] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !saltValue || !expectedValue) return false;

  const salt = Buffer.from(saltValue, 'base64url');
  const expected = Buffer.from(expectedValue, 'base64url');
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function getCreditBalances(userId: string, client: Pool | PoolClient = billingPool!): Promise<Record<Bucket, number>> {
  const result = await client.query<{ bucket: Bucket; credits: string }>(
    `SELECT bucket, COALESCE(SUM(remaining), 0)::text AS credits
     FROM credit_grants
     WHERE user_id = $1 AND remaining > 0
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
     GROUP BY bucket`,
    [userId]
  );

  const balances: Record<Bucket, number> = { subscription: 0, rollover: 0, booster: 0, free: 0 };
  for (const row of result.rows) balances[row.bucket] = Number(row.credits);
  return balances;
}

function currentFreeGrantPeriod(now = new Date()): { id: string; expiresAt: Date } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const nextMonth = new Date(Date.UTC(year, month + 1, 1));
  return {
    id: `${year}-${String(month + 1).padStart(2, '0')}`,
    expiresAt: nextMonth,
  };
}

async function ensureFreeMonthlyGrant(userId: string, client: Pool | PoolClient = billingPool!): Promise<void> {
  const period = currentFreeGrantPeriod();
  await client.query(
    `INSERT INTO credit_grants
       (user_id, bucket, granted, remaining, expires_at, source_event_id)
     VALUES ($1, 'free', $2, $2, $3, $4)
     ON CONFLICT (source_event_id, bucket) DO NOTHING`,
    [userId, FREE_MONTHLY_CREDITS, period.expiresAt, `free:${userId}:${period.id}`]
  );
}

async function getSubscription(userId: string, client: Pool | PoolClient = billingPool!): Promise<{
  plan: string;
  status: string;
  accessExpiresAt: string | null;
  isPaid: boolean;
} | null> {
  const result = await client.query<{
    plan_type: string;
    status: string;
    period_ends_at: Date | null;
    grace_ends_at: Date | null;
  }>(
    `SELECT plan_type, status, period_ends_at, grace_ends_at
     FROM billing_subscriptions
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId]
  );
  const subscription = result.rows[0];
  if (!subscription) return null;

  const now = Date.now();
  const periodEnd = subscription.period_ends_at?.getTime() ?? 0;
  const graceEnd = subscription.grace_ends_at?.getTime() ?? 0;
  const isPaid =
    (['active', 'cancelled'].includes(subscription.status) && periodEnd > now) ||
    (subscription.status === 'past_due' && graceEnd > now);

  return {
    plan: subscription.plan_type,
    status: subscription.status,
    accessExpiresAt: subscription.period_ends_at?.toISOString() ?? null,
    isPaid,
  };
}

async function getAccount(user: BillingUser) {
  if (!billingPool) throw new Error('Billing database is unavailable.');

  const [subscription, credits] = await Promise.all([
    getSubscription(user.id),
    getCreditBalances(user.id),
  ]);
  if (!subscription?.isPaid) {
    await ensureFreeMonthlyGrant(user.id);
    credits.free = (await getCreditBalances(user.id)).free;
  }
  return {
    user: { email: user.email },
    subscription: subscription ?? { plan: 'free', status: 'inactive', accessExpiresAt: null, isPaid: false },
    credits,
    totalCredits: credits.subscription + credits.rollover + credits.booster,
  };
}

function requireDatabase(_req: Request, res: Response, next: NextFunction): void {
  if (!billingPool) {
    res.status(503).json({ error: 'Billing is not configured. Set DATABASE_URL on the server.' });
    return;
  }
  next();
}

function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get('origin');
  const appUrl = process.env.APP_URL;
  let allowed = false;
  try {
    const expectedOrigin = appUrl ? new URL(appUrl).origin : `${req.protocol}://${req.get('host')}`;
    allowed = Boolean(origin) && new URL(origin!).origin === expectedOrigin;
  } catch {
    allowed = false;
  }
  if (!allowed) {
    res.status(403).json({ error: 'Request origin is not allowed.' });
    return;
  }
  next();
}

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

async function findUserForEvent(data: Record<string, any>, client: PoolClient): Promise<string> {
  const metadata = data.metadata ?? data.subscription?.metadata ?? {};
  const userId = typeof metadata.user_id === 'string' ? metadata.user_id : undefined;
  if (userId) {
    const result = await client.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (result.rows[0]) return result.rows[0].id;
  }

  const email = data.customer?.email ?? data.customer_email;
  if (typeof email === 'string') {
    const result = await client.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (result.rows[0]) return result.rows[0].id;
  }

  throw new Error('Dodo event could not be matched to an account.');
}

function getProductId(data: Record<string, any>): string | undefined {
  if (typeof data.product_id === 'string') return data.product_id;
  const item = Array.isArray(data.product_cart) ? data.product_cart[0] : undefined;
  return typeof item?.product_id === 'string' ? item.product_id : undefined;
}

function getCycleEnd(data: Record<string, any>, plan: ProductPlan): Date {
  const nextBillingDate = data.next_billing_date ?? data.current_period_end ?? data.period_end;
  if (typeof nextBillingDate === 'string' && !Number.isNaN(Date.parse(nextBillingDate))) {
    return new Date(nextBillingDate);
  }

  const end = new Date();
  if (plan.key === 'monthly') end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCFullYear(end.getUTCFullYear() + 1);
  return end;
}

async function insertGrant(
  client: PoolClient,
  {
    userId,
    bucket,
    credits,
    expiresAt,
    sourceEventId,
    paymentId,
  }: {
    userId: string;
    bucket: Bucket;
    credits: number;
    expiresAt: Date | null;
    sourceEventId: string;
    paymentId?: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO credit_grants
       (user_id, bucket, granted, remaining, expires_at, source_event_id, external_payment_id)
     VALUES ($1, $2, $3, $3, $4, $5, $6)
     ON CONFLICT (source_event_id, bucket) DO NOTHING`,
    [userId, bucket, credits, expiresAt, sourceEventId, paymentId ?? null]
  );
}

async function processSubscriptionEvent(
  client: PoolClient,
  eventId: string,
  eventType: string,
  data: Record<string, any>
): Promise<void> {
  const subscriptionId = data.subscription_id;
  if (typeof subscriptionId !== 'string') throw new Error('Dodo subscription event is missing subscription_id.');
  const productId = getProductId(data);
  const plan = plans.find((candidate) => candidate.kind === 'subscription' && candidate.productId === productId);
  if (!plan) throw new Error('Dodo subscription product is not mapped to a configured plan.');

  const userId = await findUserForEvent(data, client);
  await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
  const existingSubscription = await client.query<{ period_ends_at: Date | null }>(
    'SELECT period_ends_at FROM billing_subscriptions WHERE subscription_id = $1 FOR UPDATE',
    [subscriptionId]
  );
  const providerEnd = data.next_billing_date ?? data.current_period_end ?? data.period_end;
  const hasProviderEnd = typeof providerEnd === 'string' && !Number.isNaN(Date.parse(providerEnd));
  const cycleEnd =
    eventType === 'subscription.cancelled' && !hasProviderEnd
      ? existingSubscription.rows[0]?.period_ends_at ?? new Date()
      : getCycleEnd(data, plan);
  const status =
    eventType === 'subscription.past_due'
      ? 'past_due'
      : eventType === 'subscription.cancelled'
        ? 'cancelled'
        : eventType === 'subscription.on_hold' || eventType === 'subscription.expired'
          ? 'inactive'
          : 'active';

  const graceDeadline = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const providerGrace = typeof data.past_due_ends_at === 'string' ? new Date(data.past_due_ends_at) : graceDeadline;
  const graceEnd = eventType === 'subscription.past_due' && providerGrace < graceDeadline ? providerGrace : graceDeadline;

  await client.query(
    `INSERT INTO billing_subscriptions
       (subscription_id, user_id, product_id, plan_type, status, period_ends_at, grace_ends_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (subscription_id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       product_id = EXCLUDED.product_id,
       plan_type = EXCLUDED.plan_type,
       status = EXCLUDED.status,
       period_ends_at = EXCLUDED.period_ends_at,
       grace_ends_at = EXCLUDED.grace_ends_at,
       updated_at = NOW()`,
    [
      subscriptionId,
      userId,
      plan.productId,
      plan.key,
      status,
      cycleEnd,
      eventType === 'subscription.past_due' ? graceEnd : null,
    ]
  );

  if (eventType === 'subscription.active' || eventType === 'subscription.renewed') {
    const currentSubscriptionCredits = await client.query<{ credits: string }>(
      `SELECT COALESCE(SUM(remaining), 0)::text AS credits
       FROM credit_grants
       WHERE user_id = $1 AND bucket = 'subscription'
         AND remaining > 0 AND revoked_at IS NULL`,
      [userId]
    );
    const unusedSubscriptionCredits = Number(currentSubscriptionCredits.rows[0]?.credits ?? 0);

    await client.query(
      `UPDATE credit_grants SET remaining = 0
      WHERE user_id = $1 AND bucket = 'subscription' AND remaining > 0`,
      [userId]
    );

    if (eventType === 'subscription.renewed' && plan.key === 'monthly') {
     await client.query(
       `UPDATE credit_grants SET remaining = 0
        WHERE user_id = $1 AND bucket = 'rollover' AND remaining > 0`,
       [userId]
     );
    }

    if (eventType === 'subscription.renewed' && plan.key === 'monthly' && unusedSubscriptionCredits > 0) {
      await insertGrant(client, {
        userId,
        bucket: 'rollover',
        credits: Math.min(unusedSubscriptionCredits, ROLLOVER_CAP),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        sourceEventId: `${eventId}:rollover`,
      });
    }

    await insertGrant(client, {
      userId,
      bucket: 'subscription',
      credits: plan.credits,
      expiresAt: cycleEnd,
      sourceEventId: `${eventId}:subscription`,
    });
  }

  if (eventType === 'subscription.on_hold' || eventType === 'subscription.expired') {
    await client.query(
      `UPDATE credit_grants SET remaining = 0
       WHERE user_id = $1 AND bucket = 'subscription' AND remaining > 0`,
      [userId]
    );
  }
}

async function processDodoEvent(
  client: PoolClient,
  eventId: string,
  eventType: string,
  data: Record<string, any>
): Promise<void> {
  if (eventType.startsWith('subscription.')) {
    await processSubscriptionEvent(client, eventId, eventType, data);
    return;
  }

  if (eventType === 'payment.succeeded') {
    const productId = getProductId(data);
    const booster = plans.find((plan) => plan.kind === 'booster' && plan.productId === productId);
    if (!booster) return;

    const userId = await findUserForEvent(data, client);
    const quantity = Number(data.quantity ?? data.product_cart?.[0]?.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new Error('Dodo payment contains an invalid product quantity.');
    }
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    await insertGrant(client, {
      userId,
      bucket: 'booster',
      credits: booster.credits * quantity,
      expiresAt: null,
      sourceEventId: `${eventId}:booster`,
      paymentId: typeof data.payment_id === 'string' ? data.payment_id : undefined,
    });
    return;
  }

  if (eventType === 'refund.succeeded' && typeof data.payment_id === 'string') {
    await client.query(
      `UPDATE credit_grants SET remaining = 0, revoked_at = NOW()
       WHERE external_payment_id = $1 AND bucket = 'booster'`,
      [data.payment_id]
    );
  }
}

export function createBillingRouter(): Router {
  const router = express.Router();
  const loginRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  const registrationRateLimit = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    limit: 3,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Registration limit reached for this network. Please try again later.' },
  });
  const verificationRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  router.get('/billing/plans', (_req, res) => {
    res.json({
      currency: 'USD',
      plans: plans.map(({ key, label, price, productId, kind, credits }) => ({
        key,
        label,
        price,
        kind,
        credits,
        available: Boolean(productId),
      })),
    });
  });

  router.post('/auth/register', requireDatabase, registrationRateLimit, requireSameOrigin, asyncRoute(async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 128) {
      res.status(400).json({ error: 'Enter a valid email and a password between 12 and 128 characters.' });
      return;
    }
    const appUrl = process.env.APP_URL;
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;
    const smtpFrom = process.env.SMTP_FROM;
    const smtpPort = Number(process.env.SMTP_PORT || 587);
    if (!appUrl || !smtpHost || !smtpUser || !smtpPassword || !smtpFrom || !Number.isInteger(smtpPort)) {
      res.status(503).json({ error: 'Email verification is not configured. Please try again later.' });
      return;
    }

    const client = await billingPool!.connect();
    let userId: string;
    try {
      await client.query('BEGIN');
      const passwordHash = await hashPassword(password);
      const result = await client.query<{ id: string; email: string }>(
        `INSERT INTO users (id, email, password_hash, email_verified)
         VALUES ($1, $2, $3, FALSE)
         RETURNING id, email`,
        [randomUUID(), email, passwordHash]
      );
      userId = result.rows[0].id;
      const verificationToken = randomBytes(32).toString('base64url');
      await client.query(
        `INSERT INTO email_verifications (token_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
        [hashToken(verificationToken), userId]
      );

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPassword },
      });
      const verificationUrl = `${appUrl.replace(/\/$/, '')}/api/auth/verify?token=${encodeURIComponent(verificationToken)}`;
      await transporter.sendMail({
        from: smtpFrom,
        to: result.rows[0].email,
        subject: 'Verify your OmniSci account',
        text: `Verify your OmniSci account by opening this link within 24 hours: ${verificationUrl}`,
        html: `<p>Verify your OmniSci account by opening this link within 24 hours:</p><p><a href="${verificationUrl}">Verify email address</a></p>`,
      });
      await client.query('COMMIT');
      res.status(201).json({ verificationRequired: true });
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'An account with that email already exists.' });
        return;
      }
      console.error('Account registration or verification email delivery failed:', error);
      res.status(502).json({ error: 'Could not create the account or send its verification email.' });
    } finally {
      client.release();
    }
  }));

  router.get('/auth/verify', requireDatabase, verificationRateLimit, asyncRoute(async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token || token.length > 200) {
      res.status(400).send('Invalid or expired email verification link.');
      return;
    }

    const client = await billingPool!.connect();
    let user: BillingUser | undefined;
    try {
      await client.query('BEGIN');
      const result = await client.query<{ user_id: string }>(
        `DELETE FROM email_verifications
         WHERE token_hash = $1 AND expires_at > NOW()
         RETURNING user_id`,
        [hashToken(token)]
      );
      if (!result.rows[0]) {
        await client.query('ROLLBACK');
        res.status(400).send('This email verification link is invalid or has expired.');
        return;
      }

      const updated = await client.query<{ id: string; email: string }>(
        `UPDATE users SET email_verified = TRUE
         WHERE id = $1
         RETURNING id, email`,
        [result.rows[0].user_id]
      );
      user = updated.rows[0];
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (!user) {
      res.status(500).send('Could not verify the account.');
      return;
    }
    await createSession(user.id, res);
    res.redirect(303, `${process.env.APP_URL?.replace(/\/$/, '')}/?verified=1`);
  }));

  router.post('/auth/login', requireDatabase, loginRateLimit, requireSameOrigin, asyncRoute(async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const result = await billingPool!.query<{ id: string; email: string; password_hash: string; email_verified: boolean }>(
      'SELECT id, email, password_hash, email_verified FROM users WHERE email = $1',
      [email]
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      res.status(401).json({ error: 'Email or password is incorrect.' });
      return;
    }
    if (!user.email_verified) {
      res.status(403).json({ error: 'Verify your email address using the link we sent before signing in.' });
      return;
    }

    await createSession(user.id, res);
    res.json({ user: { email: user.email } });
  }));

  router.post('/auth/logout', requireDatabase, requireSameOrigin, asyncRoute(async (req, res) => {
    const token = getCookie(req, SESSION_COOKIE);
    if (token) await billingPool!.query('DELETE FROM user_sessions WHERE token_hash = $1', [hashToken(token)]);
    clearSessionCookie(res);
    res.status(204).end();
  }));

  router.get('/billing/account', requireDatabase, asyncRoute(async (req, res) => {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Sign in to view your account.' });
      return;
    }
    res.json(await getAccount(user));
  }));

  router.post('/billing/checkout', requireDatabase, requireSameOrigin, asyncRoute(async (req, res) => {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Sign in before starting checkout.' });
      return;
    }

    const plan = getProductPlan(req.body.plan);
    const apiKey = process.env.DODO_PAYMENTS_API_KEY;
    const appUrl = process.env.APP_URL;
    if (!plan || !apiKey || !appUrl) {
      res.status(503).json({ error: 'This plan is not configured for checkout yet.' });
      return;
    }
    if (plan.kind === 'subscription' && (await getSubscription(user.id))?.isPaid) {
      res.status(409).json({ error: 'You already have active subscription access. Manage that subscription before starting another.' });
      return;
    }

    const environment = process.env.DODO_ENVIRONMENT === 'live_mode' ? 'live' : 'test';
    const endpoint = `https://${environment}.dodopayments.com/checkouts`;
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        product_cart: [{ product_id: plan.productId, quantity: 1 }],
        customer: { email: user.email },
        billing_currency: 'USD',
        return_url: `${appUrl.replace(/\/$/, '')}/?checkout=complete`,
        metadata: { user_id: user.id, plan: plan.key },
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      console.error('Dodo checkout session request failed:', response.status, details.slice(0, 1000));
      res.status(502).json({ error: 'Unable to start checkout. Please try again later.' });
      return;
    }

    const session = (await response.json()) as { checkout_url?: string };
    if (!session.checkout_url || !session.checkout_url.startsWith('https://')) {
      console.error('Dodo checkout response did not contain a valid checkout URL.');
      res.status(502).json({ error: 'Payment provider returned an invalid checkout session.' });
      return;
    }
    res.json({ checkoutUrl: session.checkout_url });
  }));

  router.post('/webhooks/dodo', asyncRoute(async (req: BillingRequest, res) => {
    if (!billingPool) {
      res.status(503).send('Billing database is not configured.');
      return;
    }
    const signingSecret = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    if (!signingSecret) {
      res.status(503).send('Dodo webhook verification is not configured.');
      return;
    }

    const webhookId = req.get('webhook-id');
    const signature = req.get('webhook-signature');
    const timestamp = req.get('webhook-timestamp');
    if (!req.rawBody || !webhookId || !signature || !timestamp) {
      res.status(400).send('Missing webhook body or signature headers.');
      return;
    }

    let event: { type?: string; data?: Record<string, any> };
    try {
      const webhook = new Webhook(signingSecret);
      await webhook.verify(req.rawBody, {
        'webhook-id': webhookId,
        'webhook-signature': signature,
        'webhook-timestamp': timestamp,
      });
      event = JSON.parse(req.rawBody);
    } catch (error) {
      console.error('Dodo webhook signature or payload validation failed:', error);
      res.status(400).send('Invalid webhook signature or payload.');
      return;
    }

    if (!event.type || !event.data) {
      res.status(400).send('Invalid webhook event payload.');
      return;
    }

    const client = await billingPool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO dodo_webhook_events (event_id, event_type)
         VALUES ($1, $2)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [webhookId, event.type]
      );
      if (inserted.rowCount === 0) {
        await client.query('COMMIT');
        res.status(200).json({ received: true, duplicate: true });
        return;
      }

      await processDodoEvent(client, webhookId, event.type, event.data);
      await client.query('COMMIT');
      res.status(200).json({ received: true });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Dodo webhook processing failed:', error);
      res.status(500).send('Webhook processing failed.');
    } finally {
      client.release();
    }
  }));

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    console.error('Billing route failed:', error);
    res.status(500).json({ error: 'Billing service request failed.' });
  });

  return router;
}

async function settleReservation(reservationId: string, shouldRefund: boolean): Promise<void> {
  if (!billingPool) return;

  const client = await billingPool.connect();
  try {
    await client.query('BEGIN');
    const reservationResult = await client.query<{
      user_id: string;
      allocations: CreditAllocation[];
      status: string;
    }>(
      'SELECT user_id, allocations, status FROM credit_reservations WHERE id = $1 FOR UPDATE',
      [reservationId]
    );
    const reservation = reservationResult.rows[0];
    if (!reservation || reservation.status !== 'pending') {
      await client.query('COMMIT');
      return;
    }

    if (shouldRefund) {
      for (const allocation of reservation.allocations) {
        await client.query(
          `UPDATE credit_grants
           SET remaining = remaining + $1
           WHERE id = $2 AND user_id = $3
             AND revoked_at IS NULL
             AND (bucket = 'booster' OR expires_at IS NULL OR expires_at > NOW())`,
          [allocation.amount, allocation.grantId, reservation.user_id]
        );
      }
    }

    await client.query(
      `UPDATE credit_reservations
       SET status = $1, updated_at = NOW()
       WHERE id = $2`,
      [shouldRefund ? 'refunded' : 'committed', reservationId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function requireCredits(cost: number, options: { freeTierAllowed?: boolean } = {}) {
  if (!Number.isInteger(cost) || cost < 1) throw new Error('Credit cost must be a positive integer.');
  const freeTierAllowed = options.freeTierAllowed ?? cost === 1;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!billingPool) {
      res.status(503).json({ error: 'Paid AI access is not configured. Set up the billing database first.' });
      return;
    }
    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({ error: 'AI generation is temporarily unavailable; no credits were charged.' });
      return;
    }

    let user: BillingUser | null;
    try {
      user = await getSessionUser(req);
    } catch (error) {
      console.error('Could not validate billing session:', error);
      res.status(503).json({ error: 'Account service is temporarily unavailable.' });
      return;
    }
    if (!user) {
      res.status(401).json({ error: 'Sign in to use AI features.' });
      return;
    }

    const client = await billingPool.connect();
    const allocations: CreditAllocation[] = [];
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const subscription = await getSubscription(user.id, client);
      const hasPaidSubscription = subscription?.isPaid ?? false;
      if (freeTierAllowed && !hasPaidSubscription) await ensureFreeMonthlyGrant(user.id, client);
      await client.query(
        `UPDATE credit_grants SET remaining = 0
         WHERE user_id = $1 AND bucket IN ('subscription', 'rollover', 'free')
           AND expires_at IS NOT NULL AND expires_at <= NOW() AND remaining > 0`,
        [user.id]
      );
      const grants = await client.query<{
        id: string;
        bucket: Bucket;
        remaining: string;
      }>(
        `SELECT id, bucket, remaining::text
         FROM credit_grants
         WHERE user_id = $1 AND remaining > 0
           AND (bucket <> 'subscription' OR $2::boolean)
           AND (bucket <> 'free' OR ($3::boolean AND NOT $2::boolean))
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY
           CASE bucket
             WHEN 'subscription' THEN 0
             WHEN 'rollover' THEN 1
             WHEN 'free' THEN 2
             ELSE 3
           END,
           expires_at ASC NULLS LAST,
           created_at ASC,
           id ASC
         FOR UPDATE`,
        [user.id, hasPaidSubscription, freeTierAllowed]
      );

      const available = grants.rows.reduce((total, grant) => total + Number(grant.remaining), 0);
      if (available < cost) {
        await client.query('ROLLBACK');
        if (!hasPaidSubscription && !freeTierAllowed && available < cost) {
          res.status(403).json({
            error: 'This feature requires a paid subscription or sufficient booster credits.',
            upgradeRequired: true,
            required: cost,
            available,
          });
          return;
        }
        res.status(402).json({
          error: freeTierAllowed && !hasPaidSubscription
            ? 'Your free monthly credits are exhausted. Upgrade or buy a booster pack to continue.'
            : 'Insufficient credits. Purchase a booster pack to continue.',
          upgradeRequired: true,
          required: cost,
          available,
        });
        return;
      }

      let outstanding = cost;
      for (const grant of grants.rows) {
        if (outstanding === 0) break;
        const amount = Math.min(outstanding, Number(grant.remaining));
        await client.query(
          'UPDATE credit_grants SET remaining = remaining - $1 WHERE id = $2',
          [amount, grant.id]
        );
        allocations.push({ grantId: grant.id, bucket: grant.bucket, amount });
        outstanding -= amount;
      }

      const reservationId = randomUUID();
      await client.query(
        `INSERT INTO credit_reservations (id, user_id, allocations, status)
         VALUES ($1, $2, $3, 'pending')`,
        [reservationId, user.id, JSON.stringify(allocations)]
      );
      await client.query('COMMIT');

      const billingReq = req as BillingRequest;
      billingReq.billingUser = user;
      billingReq.creditReservationId = reservationId;
      res.once('finish', () => {
        void settleReservation(reservationId, res.statusCode >= 400).catch((error) => {
          console.error('Could not finalize AI credit reservation:', error);
        });
      });
      next();
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Could not reserve AI credits:', error);
      res.status(500).json({ error: 'Could not reserve credits for this request.' });
    } finally {
      client.release();
    }
  };
}
