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
import { captureServerError } from './monitoring';

dotenv.config({ path: ['.env.local', '.env'] });

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'omnisci_session';
const SESSION_DURATION_DAYS = 30;
const ROLLOVER_CAP = 3000;
const FREE_MONTHLY_CREDITS = 50;
const MONTHLY_CREDITS = 10000;
const YEARLY_CREDITS = 13500;
const INVITATION_DURATION_DAYS = 7;

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
type BillingEnvironment = 'test' | 'live';

const configuredDodoEnvironment = process.env.DODO_ENVIRONMENT;
if (
  configuredDodoEnvironment &&
  configuredDodoEnvironment !== 'test_mode' &&
  configuredDodoEnvironment !== 'live_mode'
) {
  throw new Error('DODO_ENVIRONMENT must be exactly test_mode or live_mode.');
}
if (process.env.NODE_ENV === 'production' && !configuredDodoEnvironment) {
  throw new Error('DODO_ENVIRONMENT must be explicitly configured in production.');
}

export const BILLING_ENVIRONMENT: BillingEnvironment =
  configuredDodoEnvironment === 'live_mode' ? 'live' : 'test';

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

async function getCreditBalances(
  userId: string,
  client: Pool | PoolClient = billingPool!,
  environment: BillingEnvironment = BILLING_ENVIRONMENT
): Promise<Record<Bucket, number>> {
  const result = await client.query<{ bucket: Bucket; credits: string }>(
    `SELECT bucket, COALESCE(SUM(remaining), 0)::text AS credits
     FROM credit_grants
     WHERE user_id = $1 AND environment = $2 AND remaining > 0
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
     GROUP BY bucket`,
    [userId, environment]
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

async function ensureFreeMonthlyGrant(
  userId: string,
  client: Pool | PoolClient = billingPool!,
  environment: BillingEnvironment = BILLING_ENVIRONMENT
): Promise<void> {
  const period = currentFreeGrantPeriod();
  await client.query(
    `INSERT INTO credit_grants
       (environment, user_id, bucket, granted, remaining, expires_at, source_event_id)
     VALUES ($1, $2, 'free', $3, $3, $4, $5)
     ON CONFLICT (environment, source_event_id, bucket) DO NOTHING`,
    [environment, userId, FREE_MONTHLY_CREDITS, period.expiresAt, `free:${userId}:${period.id}`]
  );
}

async function getSubscription(
  userId: string,
  client: Pool | PoolClient = billingPool!,
  environment: BillingEnvironment = BILLING_ENVIRONMENT
): Promise<{
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
     WHERE user_id = $1 AND environment = $2
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId, environment]
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
    getSubscription(user.id, billingPool, BILLING_ENVIRONMENT),
    getCreditBalances(user.id, billingPool, BILLING_ENVIRONMENT),
  ]);
  if (!subscription?.isPaid) {
    await ensureFreeMonthlyGrant(user.id, billingPool, BILLING_ENVIRONMENT);
    credits.free = (await getCreditBalances(user.id, billingPool, BILLING_ENVIRONMENT)).free;
  }
  return {
    user: { email: user.email },
    billingEnvironment: BILLING_ENVIRONMENT,
    subscription: subscription ?? { plan: 'free', status: 'inactive', accessExpiresAt: null, isPaid: false },
    credits,
    totalCredits: credits.subscription + credits.rollover + credits.booster,
    canManageInvitations: Boolean(
      process.env.INVITE_ADMIN_EMAIL?.trim() &&
      user.email.toLowerCase() === process.env.INVITE_ADMIN_EMAIL.trim().toLowerCase()
    ),
  };
}

async function getInvitationAdmin(req: Request, res: Response): Promise<BillingUser | null> {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Sign in to manage invitations.' });
    return null;
  }
  const adminEmail = process.env.INVITE_ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    res.status(503).json({ error: 'Invitation management is not configured.' });
    return null;
  }
  if (user.email.toLowerCase() !== adminEmail) {
    res.status(403).json({ error: 'Only the configured invitation administrator can manage invitations.' });
    return null;
  }
  return user;
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

function getPaymentAmount(data: Record<string, any>): number | null {
  const amount = data.total_amount ?? data.amount;
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function getPlanPriceInCents(plan: ProductPlan): number {
  const match = /^\$(\d+(?:\.\d{1,2})?)/.exec(plan.price);
  if (!match) throw new Error(`Could not determine the configured USD price for plan ${plan.key}.`);
  return Math.round(Number(match[1]) * 100);
}

interface RefundQuote {
  eligible: boolean;
  reason?: string;
  paymentAmount: number;
  requestedAmount: number;
  availableAmount: number;
  consumedCredits: number;
  consumedValue: number;
  deduction: number;
  approvedAmount: number;
}

async function calculateRefundQuote(
  client: PoolClient,
  environment: BillingEnvironment,
  userId: string,
  paymentId: string,
  requestedAmount: number
): Promise<RefundQuote> {
  const paymentResult = await client.query<{
    total_amount: string | null;
    currency: string | null;
    product_id: string | null;
    created_at: Date;
  }>(
    `SELECT total_amount::text, currency, product_id, created_at
     FROM billing_payments
     WHERE environment = $1 AND payment_id = $2 AND user_id = $3`,
    [environment, paymentId, userId]
  );
  const payment = paymentResult.rows[0];
  if (!payment || !payment.total_amount || payment.currency !== 'USD') {
    throw new Error('This payment is unavailable for automatic refund processing.');
  }
  const paymentAmount = Number(payment.total_amount);
  if (!Number.isSafeInteger(paymentAmount) || paymentAmount <= 0) {
    throw new Error('The recorded payment amount is invalid.');
  }
  const plan = plans.find((candidate) => candidate.productId === payment.product_id);
  if (!plan) throw new Error('The payment product has no configured refund credit value.');
  const planPriceCents = getPlanPriceInCents(plan);

  const grantResult = await client.query<{
    id: string;
    granted: string;
    bucket: string;
  }>(
    `SELECT id, granted::text, bucket
     FROM credit_grants
     WHERE environment = $1 AND user_id = $2 AND external_payment_id = $3
       AND bucket IN ('booster', 'subscription', 'rollover')
     ORDER BY id
     FOR UPDATE`,
    [environment, userId, paymentId]
  );
  const grantIds = grantResult.rows.map((grant) => grant.id);
  const grantedCredits = grantResult.rows.reduce(
    (total, grant) => total + (grant.bucket === 'rollover' ? 0 : Number(grant.granted)),
    0
  );
  if (grantIds.length === 0 || grantedCredits <= 0) {
    throw new Error('No matching credit grant was found for this payment.');
  }

  const consumedResult = await client.query<{ credits: string }>(
    `SELECT COALESCE(SUM((allocation->>'amount')::bigint), 0)::text AS credits
     FROM credit_reservations reservation
     CROSS JOIN LATERAL jsonb_array_elements(reservation.allocations) AS allocation
     WHERE reservation.environment = $1
       AND reservation.user_id = $2
       AND reservation.status = 'committed'
       AND allocation->>'grantId' = ANY($3::text[])`,
    [environment, userId, grantIds]
  );
  const consumedCredits = Number(consumedResult.rows[0]?.credits ?? 0);
  const consumedValue = Math.ceil((consumedCredits * planPriceCents) / plan.credits);
  const legacyRolloverResult = plan.kind === 'subscription'
    ? await client.query<{ found: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM credit_grants
         WHERE environment = $1 AND user_id = $2 AND bucket = 'rollover'
           AND external_payment_id IS NULL AND created_at >= $3
       ) AS found`,
      [environment, userId, payment.created_at]
    )
    : null;
  const refundTotals = await client.query<{ amount: string; deductions: string }>(
    `SELECT
       COALESCE((
         SELECT SUM(amount) FROM billing_refunds
         WHERE environment = $1 AND payment_id = $2 AND status IN ('processed', 'needs_review')
       ), 0)::text AS amount,
       COALESCE((
         SELECT SUM(consumption_deduction) FROM billing_refund_requests
         WHERE environment = $1 AND payment_id = $2 AND status IN ('submitted', 'processed')
       ), 0)::text AS deductions`,
    [environment, paymentId]
  );
  const pendingTotal = await client.query<{ amount: string }>(
    `SELECT COALESCE(SUM(approved_amount), 0)::text AS amount
     FROM billing_refund_requests
     WHERE environment = $1 AND payment_id = $2
       AND status IN ('submitting', 'submitted', 'needs_review')`,
    [environment, paymentId]
  );
  const alreadyRefunded = Number(refundTotals.rows[0]?.amount ?? 0);
  const reservedAmount = Number(pendingTotal.rows[0]?.amount ?? 0);
  const availableAmount = Math.max(0, paymentAmount - alreadyRefunded - reservedAmount);
  const previouslyDeducted = Number(refundTotals.rows[0]?.deductions ?? 0);
  const deduction = Math.max(0, consumedValue - previouslyDeducted);
  const approvedAmount = requestedAmount - deduction;

  let reason: string | undefined;
  if (!Number.isSafeInteger(requestedAmount) || requestedAmount <= 0) {
    reason = 'Enter a refund amount greater than zero.';
  } else if (requestedAmount > availableAmount) {
    reason = 'The requested amount exceeds the refundable balance for this payment.';
  } else if (consumedValue >= requestedAmount) {
    reason = 'The value of credits already consumed is at least the requested refund amount.';
  } else if (approvedAmount <= 0) {
    reason = 'There is no refundable amount after deducting the value of credits consumed.';
  } else if (legacyRolloverResult?.rows[0]?.found) {
    reason = 'Some rollover credits cannot be linked to this payment, so support must review the refund.';
  }

  return {
    eligible: !reason,
    reason,
    paymentAmount,
    requestedAmount,
    availableAmount,
    consumedCredits,
    consumedValue,
    deduction,
    approvedAmount: reason ? 0 : approvedAmount,
  };
}

async function insertGrant(
  client: PoolClient,
  {
    userId,
    environment,
    bucket,
    credits,
    expiresAt,
    sourceEventId,
    paymentId,
  }: {
    userId: string;
    environment: BillingEnvironment;
    bucket: Bucket;
    credits: number;
    expiresAt: Date | null;
    sourceEventId: string;
    paymentId?: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO credit_grants
       (environment, user_id, bucket, granted, remaining, expires_at, source_event_id, external_payment_id)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
     ON CONFLICT (environment, source_event_id, bucket) DO NOTHING`,
    [environment, userId, bucket, credits, expiresAt, sourceEventId, paymentId ?? null]
  );
}

async function findSubscriptionPaymentId(
  client: PoolClient,
  environment: BillingEnvironment,
  subscriptionId: string,
  periodEnd: Date
): Promise<string | undefined> {
  const result = await client.query<{ payment_id: string }>(
    `SELECT payment_id FROM billing_payments
     WHERE environment = $1 AND subscription_id = $2 AND service_period_end = $3
     ORDER BY created_at DESC LIMIT 1`,
    [environment, subscriptionId, periodEnd]
  );
  return result.rows[0]?.payment_id;
}

async function processSubscriptionEvent(
  client: PoolClient,
  environment: BillingEnvironment,
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
    'SELECT period_ends_at FROM billing_subscriptions WHERE environment = $1 AND subscription_id = $2 FOR UPDATE',
    [environment, subscriptionId]
  );
  const providerEnd = data.next_billing_date ?? data.current_period_end ?? data.period_end;
  const hasProviderEnd = typeof providerEnd === 'string' && !Number.isNaN(Date.parse(providerEnd));
  const cycleEnd =
    eventType === 'subscription.cancelled' && !hasProviderEnd
      ? existingSubscription.rows[0]?.period_ends_at ?? new Date()
      : getCycleEnd(data, plan);
  if (typeof data.payment_id === 'string') {
    await client.query(
      `INSERT INTO billing_payments
         (environment, payment_id, user_id, total_amount, currency, product_id, subscription_id, service_period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (environment, payment_id) DO UPDATE SET
         total_amount = COALESCE(EXCLUDED.total_amount, billing_payments.total_amount),
         currency = COALESCE(EXCLUDED.currency, billing_payments.currency),
         product_id = COALESCE(EXCLUDED.product_id, billing_payments.product_id),
         subscription_id = COALESCE(EXCLUDED.subscription_id, billing_payments.subscription_id),
         service_period_end = COALESCE(EXCLUDED.service_period_end, billing_payments.service_period_end)`,
      [
        environment,
        data.payment_id,
        userId,
        getPaymentAmount(data),
        typeof data.currency === 'string' ? data.currency : null,
        productId,
        subscriptionId,
        cycleEnd,
      ]
    );
  }
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
       (environment, subscription_id, user_id, product_id, plan_type, status, period_ends_at, grace_ends_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (environment, subscription_id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       product_id = EXCLUDED.product_id,
       plan_type = EXCLUDED.plan_type,
       status = EXCLUDED.status,
       period_ends_at = EXCLUDED.period_ends_at,
       grace_ends_at = EXCLUDED.grace_ends_at,
       updated_at = NOW()`,
    [
      environment,
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
    const currentSubscriptionCredits = await client.query<{
      id: string;
      remaining: string;
      external_payment_id: string | null;
    }>(
      `SELECT id, remaining::text, external_payment_id
       FROM credit_grants
       WHERE environment = $1 AND user_id = $2 AND bucket = 'subscription'
         AND remaining > 0 AND revoked_at IS NULL
       ORDER BY created_at, id
       FOR UPDATE`,
      [environment, userId]
    );
    const unusedSubscriptionCredits = currentSubscriptionCredits.rows.reduce(
      (total, grant) => total + Number(grant.remaining),
      0
    );

    await client.query(
      `UPDATE credit_grants SET remaining = 0
      WHERE environment = $1 AND user_id = $2 AND bucket = 'subscription' AND remaining > 0`,
      [environment, userId]
    );

    if (eventType === 'subscription.renewed' && plan.key === 'monthly') {
     await client.query(
       `UPDATE credit_grants SET remaining = 0
       WHERE environment = $1 AND user_id = $2 AND bucket = 'rollover' AND remaining > 0`,
       [environment, userId]
     );
    }

    if (eventType === 'subscription.renewed' && plan.key === 'monthly' && unusedSubscriptionCredits > 0) {
      let rolloverCreditsAvailable = ROLLOVER_CAP;
      for (const grant of currentSubscriptionCredits.rows) {
        const credits = Math.min(Number(grant.remaining), rolloverCreditsAvailable);
        if (credits <= 0) break;
        await insertGrant(client, {
          userId,
          environment,
          bucket: 'rollover',
          credits,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          sourceEventId: `${eventId}:rollover:${grant.id}`,
          paymentId: grant.external_payment_id ?? undefined,
        });
        rolloverCreditsAvailable -= credits;
      }
    }

    const paymentId =
      typeof data.payment_id === 'string'
        ? data.payment_id
        : await findSubscriptionPaymentId(client, environment, subscriptionId, cycleEnd);
    await insertGrant(client, {
      userId,
      environment,
      bucket: 'subscription',
      credits: plan.credits,
      expiresAt: cycleEnd,
      sourceEventId: `${eventId}:subscription`,
      paymentId,
    });
  }

  if (eventType === 'subscription.on_hold' || eventType === 'subscription.expired') {
    await client.query(
      `UPDATE credit_grants SET remaining = 0
       WHERE environment = $1 AND user_id = $2 AND bucket = 'subscription' AND remaining > 0`,
      [environment, userId]
    );
  }
}

async function applyRefund(
  client: PoolClient,
  environment: BillingEnvironment,
  data: Record<string, any>
): Promise<void> {
  const paymentId = typeof data.payment_id === 'string' ? data.payment_id : undefined;
  const refundId = typeof data.refund_id === 'string' ? data.refund_id : undefined;
  if (!paymentId || !refundId) {
    throw new Error('Dodo refund event is missing payment_id or refund_id.');
  }

  const paymentResult = await client.query<{
    user_id: string;
    total_amount: string | null;
    currency: string | null;
    created_at: Date;
  }>(
    `SELECT user_id, total_amount::text, currency, created_at
     FROM billing_payments WHERE environment = $1 AND payment_id = $2 FOR UPDATE`,
    [environment, paymentId]
  );
  const payment = paymentResult.rows[0];
  const grantResult = await client.query<{
    id: string;
    granted: string;
    remaining: string;
    refunded_credits: string;
    bucket: string;
  }>(
    `SELECT id, granted::text, remaining::text, refunded_credits::text, bucket
     FROM credit_grants
     WHERE environment = $1 AND external_payment_id = $2
       AND bucket IN ('booster', 'subscription', 'rollover')
     FOR UPDATE`,
    [environment, paymentId]
  );
  const paidGrantRows = grantResult.rows.filter((grant) => grant.bucket !== 'rollover');
  const rolloverGrantRows = grantResult.rows.filter((grant) => grant.bucket === 'rollover');
  const legacyRolloverResult = payment
    ? await client.query<{ found: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM credit_grants
         WHERE environment = $1 AND user_id = $2 AND bucket = 'rollover'
           AND external_payment_id IS NULL AND created_at >= $3
       ) AS found`,
      [environment, payment.user_id, payment.created_at]
    )
    : null;
  const hasLegacyRollover = Boolean(legacyRolloverResult?.rows[0]?.found);

  const isPartial = data.is_partial === true;
  const reportedAmount = getPaymentAmount(data);
  const paymentAmount = payment?.total_amount === null || payment?.total_amount === undefined
    ? null
    : Number(payment.total_amount);
  const refundCurrency = typeof data.currency === 'string' ? data.currency : null;
  const currencyMismatch = Boolean(payment?.currency && refundCurrency && payment.currency !== refundCurrency);
  const amountExceedsPurchase = paymentAmount !== null && reportedAmount !== null && reportedAmount > paymentAmount;

  if (payment && paidGrantRows.length > 0 && !hasLegacyRollover && !currencyMismatch && paymentAmount !== null && paymentAmount > 0 &&
      !amountExceedsPurchase && (reportedAmount !== null || !isPartial)) {
    const refundAmount = isPartial ? reportedAmount : paymentAmount;
    if (refundAmount === null || refundAmount <= 0) {
      throw new Error(`Dodo refund ${refundId} has an invalid amount.`);
    }

    const inserted = await client.query(
      `INSERT INTO billing_refunds
         (environment, refund_id, payment_id, amount, currency, status)
       VALUES ($1, $2, $3, $4, $5, 'processed')
       ON CONFLICT (environment, refund_id) DO NOTHING
       RETURNING refund_id`,
      [environment, refundId, paymentId, refundAmount, refundCurrency ?? payment.currency]
    );
    if (inserted.rowCount === 0) return;

    const cumulative = await client.query<{ amount: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS amount
       FROM billing_refunds
       WHERE environment = $1 AND payment_id = $2 AND status = 'processed'`,
      [environment, paymentId]
    );
    const cumulativeRefundAmount = Math.min(Number(cumulative.rows[0]?.amount ?? 0), paymentAmount);
    let creditsRemoved = 0;
    let rolloverDemand = 0;

    for (const grant of paidGrantRows) {
      const granted = Number(grant.granted);
      const alreadyRefunded = Number(grant.refunded_credits);
      const targetRefunded = Math.min(granted, Math.floor((granted * cumulativeRefundAmount) / paymentAmount));
      const additionalTarget = Math.max(0, targetRefunded - alreadyRefunded);
      const remaining = Number(grant.remaining);
      const removed = Math.min(remaining, additionalTarget);
      rolloverDemand += additionalTarget - removed;
      await client.query(
        `UPDATE credit_grants
         SET remaining = remaining - $1,
             refunded_credits = $2,
             revoked_at = CASE WHEN $2 >= granted THEN NOW() ELSE revoked_at END
         WHERE environment = $3 AND id = $4`,
        [removed, targetRefunded, environment, grant.id]
      );
      creditsRemoved += removed;
    }

    for (const grant of rolloverGrantRows) {
      if (rolloverDemand <= 0) break;
      const granted = Number(grant.granted);
      const alreadyRefunded = Number(grant.refunded_credits);
      const removed = Math.min(Number(grant.remaining), rolloverDemand);
      const targetRefunded = Math.min(granted, alreadyRefunded + removed);
      await client.query(
        `UPDATE credit_grants
         SET remaining = remaining - $1,
             refunded_credits = $2,
             revoked_at = CASE WHEN $2 >= granted THEN NOW() ELSE revoked_at END
         WHERE environment = $3 AND id = $4`,
        [removed, targetRefunded, environment, grant.id]
      );
      rolloverDemand -= removed;
      creditsRemoved += removed;
    }
    const creditsShortfall = rolloverDemand;

    await client.query(
      `UPDATE billing_refunds SET credits_removed = $1, credits_shortfall = $2
       WHERE environment = $3 AND refund_id = $4`,
      [creditsRemoved, creditsShortfall, environment, refundId]
    );
    await client.query(
      `UPDATE billing_refund_requests SET status = 'processed', updated_at = NOW()
       WHERE environment = $1 AND provider_refund_id = $2`,
      [environment, refundId]
    );
    console.info(
      `Dodo refund credit adjustment paymentId=${paymentId} refundId=${refundId} creditsRemoved=${creditsRemoved} creditsShortfall=${creditsShortfall}`
    );
    return;
  }

  await client.query(
    `INSERT INTO billing_refunds
       (environment, refund_id, payment_id, amount, currency, status)
     VALUES ($1, $2, $3, $4, $5, 'needs_review')
     ON CONFLICT (environment, refund_id) DO NOTHING`,
    [environment, refundId, paymentId, reportedAmount, refundCurrency]
  );
  await client.query(
    `UPDATE billing_refund_requests SET status = 'needs_review', updated_at = NOW()
     WHERE environment = $1 AND provider_refund_id = $2`,
    [environment, refundId]
  );

  if (!isPartial && paidGrantRows.length > 0 && !hasLegacyRollover && !currencyMismatch && !amountExceedsPurchase) {
    let creditsRemoved = 0;
    let creditsShortfall = 0;
    for (const grant of grantResult.rows) {
      const remaining = Number(grant.remaining);
      const granted = Number(grant.granted);
      const alreadyRefunded = Number(grant.refunded_credits);
      const targetRefunded = granted;
      const additionalTarget = Math.max(0, targetRefunded - alreadyRefunded);
      const removed = Math.min(remaining, additionalTarget);
      creditsShortfall += additionalTarget - removed;
      await client.query(
        `UPDATE credit_grants
         SET remaining = remaining - $1, refunded_credits = $2, revoked_at = NOW()
         WHERE environment = $3 AND id = $4`,
        [removed, targetRefunded, environment, grant.id]
      );
      creditsRemoved += removed;
    }
    await client.query(
      `UPDATE billing_refunds
       SET status = 'processed', credits_removed = $1, credits_shortfall = $2
       WHERE environment = $3 AND refund_id = $4`,
      [creditsRemoved, creditsShortfall, environment, refundId]
    );
    await client.query(
      `UPDATE billing_refund_requests SET status = 'processed', updated_at = NOW()
       WHERE environment = $1 AND provider_refund_id = $2`,
      [environment, refundId]
    );
    console.info(
      `Dodo full refund credit adjustment paymentId=${paymentId} refundId=${refundId} creditsRemoved=${creditsRemoved} creditsShortfall=${creditsShortfall}`
    );
    return;
  }

  console.error(
    `Dodo refund needs manual credit review paymentId=${paymentId} refundId=${refundId} reason=${hasLegacyRollover ? 'legacy_rollover_unattributed' : currencyMismatch ? 'currency_mismatch' : amountExceedsPurchase ? 'refund_amount_exceeds_purchase' : isPartial ? 'partial_refund_missing_purchase_amount' : 'purchase_or_credit_grant_not_found'}`
  );
}

async function processDodoEvent(
  client: PoolClient,
  environment: BillingEnvironment,
  eventId: string,
  eventType: string,
  data: Record<string, any>
): Promise<void> {
  if (eventType.startsWith('subscription.')) {
    await processSubscriptionEvent(client, environment, eventId, eventType, data);
    return;
  }

  if (eventType === 'payment.succeeded') {
    const productId = getProductId(data);
    const plan = plans.find((candidate) => candidate.productId === productId);
    if (!plan) return;
    const userId = await findUserForEvent(data, client);
    const paymentId = typeof data.payment_id === 'string' ? data.payment_id : undefined;
    if (paymentId) {
      const servicePeriod = Array.isArray(data.service_periods) ? data.service_periods[0] : undefined;
      const servicePeriodEnd =
        typeof servicePeriod?.ends_at === 'string' && !Number.isNaN(Date.parse(servicePeriod.ends_at))
          ? new Date(servicePeriod.ends_at)
          : null;
      await client.query(
        `INSERT INTO billing_payments
             (environment, payment_id, user_id, total_amount, currency, product_id, subscription_id, service_period_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (environment, payment_id) DO UPDATE SET
           total_amount = COALESCE(EXCLUDED.total_amount, billing_payments.total_amount),
           currency = COALESCE(EXCLUDED.currency, billing_payments.currency),
             product_id = COALESCE(EXCLUDED.product_id, billing_payments.product_id),
             subscription_id = COALESCE(EXCLUDED.subscription_id, billing_payments.subscription_id),
           service_period_end = COALESCE(EXCLUDED.service_period_end, billing_payments.service_period_end)`,
        [
          environment,
          paymentId,
          userId,
          getPaymentAmount(data),
          typeof data.currency === 'string' ? data.currency : null,
          productId,
          typeof servicePeriod?.subscription_id === 'string' ? servicePeriod.subscription_id : null,
          servicePeriodEnd,
        ]
      );
      if (servicePeriodEnd && typeof servicePeriod?.subscription_id === 'string') {
        await client.query(
          `UPDATE credit_grants SET external_payment_id = $1
           WHERE environment = $2 AND user_id = $3 AND bucket = 'subscription'
             AND expires_at = $4 AND external_payment_id IS NULL`,
          [paymentId, environment, userId, servicePeriodEnd]
        );
      }
    }

    if (plan.kind !== 'booster') return;

    const quantity = Number(data.quantity ?? data.product_cart?.[0]?.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new Error('Dodo payment contains an invalid product quantity.');
    }
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    await insertGrant(client, {
      userId,
      environment,
      bucket: 'booster',
      credits: plan.credits * quantity,
      expiresAt: null,
      sourceEventId: `${eventId}:booster`,
      paymentId,
    });
    return;
  }

  if (eventType === 'refund.succeeded') {
    await applyRefund(client, environment, data);
    return;
  }

  if (eventType === 'refund.failed' && typeof data.refund_id === 'string') {
    await client.query(
      `UPDATE billing_refund_requests SET status = 'failed', updated_at = NOW()
       WHERE environment = $1 AND provider_refund_id = $2 AND status IN ('submitted', 'needs_review')`,
      [environment, data.refund_id]
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
  const refundRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  const invitationRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
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
    const rawInvitationToken = req.body.inviteToken;
    const invitationToken = typeof rawInvitationToken === 'string' ? rawInvitationToken : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 128) {
      res.status(400).json({ error: 'Enter a valid email and a password between 12 and 128 characters.' });
      return;
    }
    if ((rawInvitationToken !== undefined && typeof rawInvitationToken !== 'string') || invitationToken.length > 200) {
      res.status(400).json({ error: 'This invitation link is invalid or expired.' });
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
      let invitationId: string | null = null;
      if (invitationToken) {
        const invitation = await client.query<{ id: string; email: string }>(
          `SELECT id, email FROM account_invitations
           WHERE token_hash = $1 AND expires_at > NOW()
             AND redeemed_at IS NULL AND revoked_at IS NULL
           FOR UPDATE`,
          [hashToken(invitationToken)]
        );
        if (!invitation.rows[0] || invitation.rows[0].email.toLowerCase() !== email) {
          await client.query('ROLLBACK');
          res.status(400).json({ error: 'This invitation is invalid, expired, or was issued to a different email address.' });
          return;
        }
        invitationId = invitation.rows[0].id;
      }

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
        `INSERT INTO email_verifications (token_hash, user_id, expires_at, invitation_id)
         VALUES ($1, $2, NOW() + INTERVAL '24 hours', $3)`,
        [hashToken(verificationToken), userId, invitationId]
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
      const result = await client.query<{ user_id: string; invitation_id: string | null }>(
        `DELETE FROM email_verifications
         WHERE token_hash = $1 AND expires_at > NOW()
         RETURNING user_id, invitation_id`,
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
      if (result.rows[0].invitation_id) {
        await client.query(
          `UPDATE account_invitations SET redeemed_at = NOW()
           WHERE id = $1 AND redeemed_at IS NULL AND revoked_at IS NULL`,
          [result.rows[0].invitation_id]
        );
      }
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

  router.get('/invitations', requireDatabase, asyncRoute(async (req, res) => {
    const admin = await getInvitationAdmin(req, res);
    if (!admin) return;

    const result = await billingPool!.query<{
      id: string;
      email: string;
      created_at: Date;
      expires_at: Date;
      redeemed_at: Date | null;
      revoked_at: Date | null;
    }>(
      `SELECT id, email, created_at, expires_at, redeemed_at, revoked_at
       FROM account_invitations
       WHERE created_by = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [admin.id]
    );
    res.json({
      invitations: result.rows.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        createdAt: invitation.created_at.toISOString(),
        expiresAt: invitation.expires_at.toISOString(),
        status: invitation.redeemed_at
          ? 'redeemed'
          : invitation.revoked_at
            ? 'revoked'
            : invitation.expires_at.getTime() <= Date.now()
              ? 'expired'
              : 'pending',
      })),
    });
  }));

  router.post('/invitations', requireDatabase, invitationRateLimit, requireSameOrigin, asyncRoute(async (req, res) => {
    const admin = await getInvitationAdmin(req, res);
    if (!admin) return;

    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const sendEmail = req.body.sendEmail;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof sendEmail !== 'boolean') {
      res.status(400).json({ error: 'Enter a valid email address and choose whether to send the invitation by email.' });
      return;
    }

    const appUrl = process.env.APP_URL;
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;
    const smtpFrom = process.env.SMTP_FROM;
    const smtpPort = Number(process.env.SMTP_PORT || 587);
    if (!appUrl) {
      res.status(503).json({ error: 'The app URL is not configured for invitation links.' });
      return;
    }
    if (sendEmail && (!smtpHost || !smtpUser || !smtpPassword || !smtpFrom || !Number.isInteger(smtpPort))) {
      res.status(503).json({ error: 'Email delivery is not configured. Turn off email delivery to create a copyable invite link.' });
      return;
    }

    let appBaseUrl: URL;
    try {
      appBaseUrl = new URL(appUrl);
    } catch {
      res.status(503).json({ error: 'The configured app URL is invalid.' });
      return;
    }
    if (!['https:', 'http:'].includes(appBaseUrl.protocol) ||
        (process.env.NODE_ENV === 'production' && appBaseUrl.protocol !== 'https:')) {
      res.status(503).json({ error: 'Invitation links must use the app’s public HTTPS URL.' });
      return;
    }

    const invitationId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const inviteUrl = new URL('/', appBaseUrl);
    inviteUrl.searchParams.set('invite', token);
    const client = await billingPool!.connect();
    let expiresAt: Date;
    try {
      await client.query('BEGIN');
      const existingAccount = await client.query(
        'SELECT 1 FROM users WHERE email = $1',
        [email]
      );
      if (existingAccount.rows.length > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'That email already has an account and does not need an invitation.' });
        return;
      }
      await client.query(
        `UPDATE account_invitations
         SET revoked_at = NOW()
         WHERE LOWER(email) = $1 AND redeemed_at IS NULL AND revoked_at IS NULL`,
        [email]
      );
      const insertedInvitation = await client.query<{ expires_at: Date }>(
        `INSERT INTO account_invitations (id, token_hash, email, created_by, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')
         RETURNING expires_at`,
        [invitationId, hashToken(token), email, admin.id]
      );
      expiresAt = insertedInvitation.rows[0].expires_at;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (sendEmail) {
      try {
        const transporter = nodemailer.createTransport({
          host: smtpHost!,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: { user: smtpUser!, pass: smtpPassword! },
        });
        await transporter.sendMail({
          from: smtpFrom!,
          to: email,
          subject: 'You’re invited to OmniSci Foundry',
          text: `You have been invited to try OmniSci Foundry. Register using this email address within ${INVITATION_DURATION_DAYS} days: ${inviteUrl.toString()}`,
          html: `<p>You have been invited to try OmniSci Foundry.</p><p>Register using this email address within ${INVITATION_DURATION_DAYS} days:</p><p><a href="${inviteUrl.toString()}">Accept invitation</a></p>`,
        });
      } catch (error) {
        await billingPool!.query(
          `UPDATE account_invitations SET revoked_at = NOW()
           WHERE id = $1 AND redeemed_at IS NULL`,
          [invitationId]
        );
        console.error(`Invitation email delivery failed invitationId=${invitationId}`);
        captureServerError(error, 'invitation-email');
        res.status(502).json({ error: 'The invitation email could not be sent. The link was not activated; try again or create a copyable link.' });
        return;
      }
    }

    res.status(201).json({
      invitation: {
        id: invitationId,
        email,
        expiresAt: expiresAt.toISOString(),
        status: 'pending',
      },
      inviteUrl: inviteUrl.toString(),
      emailSent: sendEmail,
    });
  }));

  router.delete('/invitations/:id', requireDatabase, requireSameOrigin, asyncRoute(async (req, res) => {
    const admin = await getInvitationAdmin(req, res);
    if (!admin) return;
    const invitationId = req.params.id;
    if (!invitationId || invitationId.length > 80) {
      res.status(400).json({ error: 'Provide a valid invitation ID.' });
      return;
    }
    const result = await billingPool!.query(
      `UPDATE account_invitations SET revoked_at = NOW()
       WHERE id = $1 AND created_by = $2
         AND redeemed_at IS NULL AND revoked_at IS NULL
       RETURNING id`,
      [invitationId, admin.id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Invitation not found or it can no longer be revoked.' });
      return;
    }
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

  router.get('/billing/payments', requireDatabase, asyncRoute(async (req, res) => {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Sign in to view your payments.' });
      return;
    }

    const result = await billingPool!.query<{
      payment_id: string;
      total_amount: string;
      currency: string;
      product_id: string | null;
      created_at: Date;
      credits_granted: string;
      credits_consumed: string;
      refunded_amount: string;
      pending_amount: string;
    }>(
      `SELECT payment.payment_id, payment.total_amount::text, payment.currency, payment.product_id,
              payment.created_at,
              COALESCE((
                SELECT SUM(cg.granted)
                FROM credit_grants cg
                WHERE cg.environment = payment.environment
                  AND cg.external_payment_id = payment.payment_id
                  AND cg.bucket IN ('booster', 'subscription')
              ), 0)::text AS credits_granted,
              COALESCE((
                SELECT SUM((allocation->>'amount')::bigint)
                FROM credit_grants cg
                JOIN credit_reservations reservation
                  ON reservation.environment = cg.environment
                 AND reservation.user_id = cg.user_id
                 AND reservation.status = 'committed'
                CROSS JOIN LATERAL jsonb_array_elements(reservation.allocations) AS allocation
                WHERE cg.environment = payment.environment
                  AND cg.external_payment_id = payment.payment_id
                  AND cg.bucket IN ('booster', 'subscription', 'rollover')
                  AND allocation->>'grantId' = cg.id::text
              ), 0)::text AS credits_consumed,
              COALESCE((
                SELECT SUM(refund.amount)
                FROM billing_refunds refund
                WHERE refund.environment = payment.environment
                  AND refund.payment_id = payment.payment_id
                  AND refund.status IN ('processed', 'needs_review')
              ), 0)::text AS refunded_amount,
              COALESCE((
                SELECT SUM(request.approved_amount)
                FROM billing_refund_requests request
                WHERE request.environment = payment.environment
                  AND request.payment_id = payment.payment_id
                  AND request.status IN ('submitting', 'submitted', 'needs_review')
              ), 0)::text AS pending_amount
       FROM billing_payments payment
       WHERE payment.environment = $1 AND payment.user_id = $2
         AND payment.total_amount IS NOT NULL AND payment.currency = 'USD'
       ORDER BY payment.created_at DESC
       LIMIT 50`,
      [BILLING_ENVIRONMENT, user.id]
    );
    res.json({
      payments: result.rows.map((payment) => ({
        paymentId: payment.payment_id,
        amount: Number(payment.total_amount),
        currency: payment.currency,
        productId: payment.product_id,
        createdAt: payment.created_at.toISOString(),
        creditsGranted: Number(payment.credits_granted),
        creditsConsumed: Number(payment.credits_consumed),
        refundedAmount: Number(payment.refunded_amount),
        pendingAmount: Number(payment.pending_amount),
      })),
    });
  }));

  router.post('/billing/refund-quote', requireDatabase, requireSameOrigin, asyncRoute(async (req, res) => {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Sign in to request a refund.' });
      return;
    }
    const paymentId = typeof req.body.paymentId === 'string' ? req.body.paymentId : '';
    const requestedAmount = req.body.amount;
    if (!paymentId || paymentId.length > 200 || !Number.isSafeInteger(requestedAmount)) {
      res.status(400).json({ error: 'Provide a valid payment ID and refund amount in USD cents.' });
      return;
    }

    const client = await billingPool!.connect();
    try {
      await client.query('BEGIN');
      const quote = await calculateRefundQuote(
        client,
        BILLING_ENVIRONMENT,
        user.id,
        paymentId,
        requestedAmount
      );
      await client.query('COMMIT');
      res.json(quote);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error && error.message.includes('unavailable for automatic refund')) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message.includes('No matching credit grant')) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error instanceof Error && (
        error.message.includes('product has no configured refund credit value') ||
        error.message.includes('recorded payment amount is invalid')
      )) {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    } finally {
      client.release();
    }
  }));

  router.post('/billing/refunds', requireDatabase, requireSameOrigin, refundRateLimit, asyncRoute(async (req, res) => {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Sign in to request a refund.' });
      return;
    }
    const paymentId = typeof req.body.paymentId === 'string' ? req.body.paymentId : '';
    const requestedAmount = req.body.amount;
    const apiKey = process.env.DODO_PAYMENTS_API_KEY;
    if (!paymentId || paymentId.length > 200 || !Number.isSafeInteger(requestedAmount) || requestedAmount <= 0) {
      res.status(400).json({ error: 'Provide a valid payment ID and refund amount in USD cents.' });
      return;
    }
    if (!apiKey) {
      res.status(503).json({ error: 'Refund processing is not configured.' });
      return;
    }

    const client = await billingPool!.connect();
    const requestId = randomUUID();
    let quote: RefundQuote;
    let productId: string;
    try {
      await client.query('BEGIN');
      const payment = await client.query<{ product_id: string | null; currency: string | null }>(
        `SELECT product_id, currency FROM billing_payments
         WHERE environment = $1 AND payment_id = $2 AND user_id = $3
         FOR UPDATE`,
        [BILLING_ENVIRONMENT, paymentId, user.id]
      );
      if (payment.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Payment not found for this account.' });
        return;
      }
      if (!payment.rows[0].product_id || payment.rows[0].currency !== 'USD') {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'This payment is missing the product or currency details required for an automatic refund.' });
        return;
      }
      productId = payment.rows[0].product_id;
      const quoteResult = await calculateRefundQuote(
        client,
        BILLING_ENVIRONMENT,
        user.id,
        paymentId,
        requestedAmount
      );
      if (!quoteResult.eligible) {
        await client.query('ROLLBACK');
        console.info(
          `Dodo refund request denied paymentId=${paymentId} requestedAmount=${requestedAmount} consumedValue=${quoteResult.consumedValue} reason=${quoteResult.reason}`
        );
        res.status(422).json(quoteResult);
        return;
      }
      quote = quoteResult;
      await client.query(
        `INSERT INTO billing_refund_requests
           (request_id, environment, payment_id, user_id, requested_amount, approved_amount,
            consumed_credits, consumed_value, consumption_deduction, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'submitting')`,
        [
          requestId,
          BILLING_ENVIRONMENT,
          paymentId,
          user.id,
          quote.requestedAmount,
          quote.approvedAmount,
          quote.consumedCredits,
          quote.consumedValue,
          quote.deduction,
        ]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error && (
        error.message.includes('unavailable for automatic refund') ||
        error.message.includes('No matching credit grant') ||
        error.message.includes('product has no configured refund credit value') ||
        error.message.includes('recorded payment amount is invalid')
      )) {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    } finally {
      client.release();
    }

    const dodoHost = BILLING_ENVIRONMENT === 'live' ? 'live' : 'test';
    let providerResponse: globalThis.Response;
    try {
      providerResponse = await fetch(`https://${dodoHost}.dodopayments.com/refunds`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payment_id: paymentId,
          currency: 'USD',
          items: [{
            item_id: productId,
            amount: quote.approvedAmount,
            tax_inclusive: true,
          }],
          reason: 'Customer refund request adjusted for consumed credits',
        }),
      });
    } catch (error) {
      await billingPool!.query(
        `UPDATE billing_refund_requests
         SET status = 'needs_review', updated_at = NOW()
         WHERE request_id = $1`,
        [requestId]
      );
      console.error(`Dodo refund request outcome unknown requestId=${requestId} paymentId=${paymentId}`);
      captureServerError(error, 'dodo-refund-request');
      res.status(502).json({ error: 'Refund submission could not be confirmed. Contact support before retrying.' });
      return;
    }

    let providerBody: { refund_id?: unknown; status?: unknown };
    try {
      providerBody = await providerResponse.json() as { refund_id?: unknown; status?: unknown };
    } catch (error) {
      await billingPool!.query(
        `UPDATE billing_refund_requests
         SET status = 'needs_review', updated_at = NOW()
         WHERE request_id = $1`,
        [requestId]
      );
      console.error(`Dodo refund response could not be parsed requestId=${requestId} paymentId=${paymentId}`);
      captureServerError(error, 'dodo-refund-response');
      res.status(502).json({ error: 'Refund status needs confirmation. Contact support before retrying.' });
      return;
    }
    if (!providerResponse.ok) {
      await billingPool!.query(
        `UPDATE billing_refund_requests
         SET status = 'failed', updated_at = NOW()
         WHERE request_id = $1`,
        [requestId]
      );
      console.error(
        `Dodo refund request failed requestId=${requestId} paymentId=${paymentId} status=${providerResponse.status}`
      );
      res.status(502).json({ error: 'Dodo Payments could not process this refund request.' });
      return;
    }
    if (typeof providerBody.refund_id !== 'string' || !providerBody.refund_id) {
      await billingPool!.query(
        `UPDATE billing_refund_requests
         SET status = 'needs_review', updated_at = NOW()
         WHERE request_id = $1`,
        [requestId]
      );
      console.error(`Dodo refund response requires review requestId=${requestId} paymentId=${paymentId}`);
      res.status(502).json({ error: 'Refund status needs confirmation. Contact support before retrying.' });
      return;
    }
    if (providerBody.status === 'failed') {
      await billingPool!.query(
        `UPDATE billing_refund_requests
         SET provider_refund_id = $1, status = 'failed', updated_at = NOW()
         WHERE request_id = $2`,
        [providerBody.refund_id, requestId]
      );
      res.status(502).json({ error: 'Dodo Payments declined this refund request.' });
      return;
    }

    await billingPool!.query(
      `UPDATE billing_refund_requests
       SET provider_refund_id = $1,
           status = CASE
             WHEN EXISTS (
               SELECT 1 FROM billing_refunds
               WHERE environment = $2 AND refund_id = $1
             ) THEN 'processed'
             WHEN status = 'failed' THEN 'failed'
             ELSE 'submitted'
           END,
           updated_at = NOW()
       WHERE request_id = $3`,
      [providerBody.refund_id, BILLING_ENVIRONMENT, requestId]
    );
    res.status(202).json({
      status: typeof providerBody.status === 'string' ? providerBody.status : 'submitted',
      requestedAmount: quote.requestedAmount,
      consumedValue: quote.consumedValue,
      approvedAmount: quote.approvedAmount,
    });
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
        `INSERT INTO dodo_webhook_events (environment, event_id, event_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (environment, event_id) DO NOTHING
         RETURNING event_id`,
        [BILLING_ENVIRONMENT, webhookId, event.type]
      );
      if (inserted.rowCount === 0) {
        await client.query('COMMIT');
        res.status(200).json({ received: true, duplicate: true });
        return;
      }

      await processDodoEvent(client, BILLING_ENVIRONMENT, webhookId, event.type, event.data);
      await client.query('COMMIT');
      res.status(200).json({ received: true });
    } catch (error) {
      captureServerError(error, 'dodo-webhook-processing');
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
    captureServerError(error, 'billing-route');
    console.error('Billing route failed:', error);
    res.status(500).json({ error: 'Billing service request failed.' });
  });

  return router;
}

async function settleReservation(
  reservationId: string,
  environment: BillingEnvironment,
  shouldRefund: boolean
): Promise<void> {
  if (!billingPool) return;

  const client = await billingPool.connect();
  try {
    await client.query('BEGIN');
    const reservationResult = await client.query<{
      user_id: string;
      allocations: CreditAllocation[];
      status: string;
    }>(
      'SELECT user_id, allocations, status FROM credit_reservations WHERE environment = $1 AND id = $2 FOR UPDATE',
      [environment, reservationId]
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
          WHERE environment = $2 AND id = $3 AND user_id = $4
             AND revoked_at IS NULL
             AND (bucket = 'booster' OR expires_at IS NULL OR expires_at > NOW())`,
          [allocation.amount, environment, allocation.grantId, reservation.user_id]
        );
      }
    }

    await client.query(
      `UPDATE credit_reservations
       SET status = $1, updated_at = NOW()
      WHERE environment = $2 AND id = $3`,
      [shouldRefund ? 'refunded' : 'committed', environment, reservationId]
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
      const subscription = await getSubscription(user.id, client, BILLING_ENVIRONMENT);
      const hasPaidSubscription = subscription?.isPaid ?? false;
      if (freeTierAllowed && !hasPaidSubscription) {
        await ensureFreeMonthlyGrant(user.id, client, BILLING_ENVIRONMENT);
      }
      await client.query(
        `UPDATE credit_grants SET remaining = 0
         WHERE environment = $1 AND user_id = $2
           AND bucket IN ('subscription', 'rollover', 'free')
           AND expires_at IS NOT NULL AND expires_at <= NOW() AND remaining > 0`,
        [BILLING_ENVIRONMENT, user.id]
      );
      const grants = await client.query<{
        id: string;
        bucket: Bucket;
        remaining: string;
      }>(
        `SELECT id, bucket, remaining::text
         FROM credit_grants
        WHERE environment = $1 AND user_id = $2 AND remaining > 0
          AND (bucket <> 'subscription' OR $3::boolean)
          AND (bucket <> 'free' OR ($4::boolean AND NOT $3::boolean))
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
        [BILLING_ENVIRONMENT, user.id, hasPaidSubscription, freeTierAllowed]
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
          'UPDATE credit_grants SET remaining = remaining - $1 WHERE environment = $2 AND id = $3',
          [amount, BILLING_ENVIRONMENT, grant.id]
        );
        allocations.push({ grantId: grant.id, bucket: grant.bucket, amount });
        outstanding -= amount;
      }

      const reservationId = randomUUID();
      await client.query(
        `INSERT INTO credit_reservations (id, environment, user_id, allocations, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [reservationId, BILLING_ENVIRONMENT, user.id, JSON.stringify(allocations)]
      );
      await client.query('COMMIT');

      const billingReq = req as BillingRequest;
      billingReq.billingUser = user;
      billingReq.creditReservationId = reservationId;
      res.once('finish', () => {
        void settleReservation(reservationId, BILLING_ENVIRONMENT, res.statusCode >= 400).catch((error) => {
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
