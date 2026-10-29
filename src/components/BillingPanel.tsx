import { FormEvent, useEffect, useState } from 'react';
import { Copy, CreditCard, LogOut, Mail, RefreshCw, ShieldCheck, UserPlus, UserRound } from 'lucide-react';

type Plan = {
  key: string;
  label: string;
  price: string;
  kind: 'subscription' | 'booster';
  credits: number;
  available: boolean;
};

type Payment = {
  paymentId: string;
  amount: number;
  currency: string;
  productId: string | null;
  createdAt: string;
  creditsGranted: number;
  creditsConsumed: number;
  refundedAmount: number;
  pendingAmount: number;
};

type Invitation = {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'redeemed' | 'expired' | 'revoked';
};

type RefundQuote = {
  eligible: boolean;
  reason?: string;
  paymentAmount: number;
  requestedAmount: number;
  availableAmount: number;
  consumedCredits: number;
  consumedValue: number;
  deduction: number;
  approvedAmount: number;
};

type Account = {
  user: { email: string };
  canManageInvitations: boolean;
  billingEnvironment: 'test' | 'live';
  subscription: {
    plan: string;
    status: string;
    accessExpiresAt: string | null;
    isPaid: boolean;
  };
  credits: {
    subscription: number;
    rollover: number;
    booster: number;
    free: number;
  };
  totalCredits: number;
};

export function BillingPanel() {
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite') ?? '');
  const [expanded, setExpanded] = useState(Boolean(inviteToken));
  const [account, setAccount] = useState<Account | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invitationEmail, setInvitationEmail] = useState('');
  const [sendInvitationEmail, setSendInvitationEmail] = useState(true);
  const [createdInviteUrl, setCreatedInviteUrl] = useState('');
  const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>({});
  const [refundQuotes, setRefundQuotes] = useState<Record<string, RefundQuote>>({});
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [accountResponse, plansResponse, paymentsResponse] = await Promise.all([
      fetch('/api/billing/account'),
      fetch('/api/billing/plans'),
      fetch('/api/billing/payments'),
    ]);

    if (accountResponse.ok) {
      const currentAccount = (await accountResponse.json()) as Account;
      setAccount(currentAccount);
      if (currentAccount.canManageInvitations) {
        const invitationResponse = await fetch('/api/invitations');
        const invitationBody = await invitationResponse.json();
        if (!invitationResponse.ok) {
          throw new Error(invitationBody.error || 'Could not load invitations.');
        }
        setInvitations((invitationBody as { invitations: Invitation[] }).invitations);
      } else {
        setInvitations([]);
      }
    } else if (accountResponse.status === 401) {
      setAccount(null);
      setPayments([]);
      setInvitations([]);
    } else {
      const body = await accountResponse.json().catch(() => ({}));
      throw new Error(body.error || 'Could not load billing account.');
    }

    if (plansResponse.ok) {
      const body = (await plansResponse.json()) as { plans: Plan[] };
      setPlans(body.plans);
    }

    if (paymentsResponse.ok) {
      const body = (await paymentsResponse.json()) as { payments: Payment[] };
      setPayments(body.payments);
    } else if (paymentsResponse.status !== 401) {
      const body = await paymentsResponse.json().catch(() => ({}));
      throw new Error(body.error || 'Could not load payment history.');
    }
  };

  useEffect(() => {
    if (!inviteToken) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [inviteToken]);

  useEffect(() => {
    const handleRefresh = () => {
      void refresh().catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not load billing details.');
      });
    };
    const handleUpgrade = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setExpanded(true);
      setNotice(detail?.message || 'This request needs additional credits or a paid plan.');
      handleRefresh();
    };
    window.addEventListener('billing:updated', handleRefresh);
    window.addEventListener('billing:upgrade', handleUpgrade);
    void refresh().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not load billing details.');
    });
    return () => {
      window.removeEventListener('billing:updated', handleRefresh);
      window.removeEventListener('billing:upgrade', handleUpgrade);
    };
  }, []);

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/auth/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(mode === 'register' && inviteToken ? { inviteToken } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not sign in.');
      setPassword('');
      if (body.verificationRequired) {
        setNotice('Check your email and open the verification link to finish creating your account.');
        return;
      }
      setNotice('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  const handleInvitationSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    setCreatedInviteUrl('');
    try {
      const response = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: invitationEmail, sendEmail: sendInvitationEmail }),
      });
      const body = await response.json() as { inviteUrl?: string; emailSent?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not create the invitation.');
      if (!body.inviteUrl) throw new Error('The server did not return the invitation link.');
      setCreatedInviteUrl(body.inviteUrl);
      setInvitationEmail('');
      setNotice(body.emailSent ? 'Invitation email sent. You can also copy the link below.' : 'Invitation link created. Copy and share it with the invited email address.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the invitation.');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(createdInviteUrl);
      setNotice('Invitation link copied.');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? `Could not copy the link: ${cause.message}` : 'Could not copy the invitation link.');
    }
  };

  const handleRevokeInvitation = async (invitation: Invitation) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(invitation.id)}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not revoke the invitation.');
      setNotice(`Invitation for ${invitation.email} revoked.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not revoke the invitation.');
    } finally {
      setBusy(false);
    }
  };

  const handleCheckout = async (plan: Plan) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: plan.key }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not start checkout.');
      window.location.assign(body.checkoutUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start checkout.');
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Could not sign out.');
      setAccount(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out.');
    } finally {
      setBusy(false);
    }
  };

  const handleRefundQuote = async (event: FormEvent<HTMLFormElement>, payment: Payment) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const amount = Math.round(Number(refundAmounts[payment.paymentId]) * 100);
      const response = await fetch('/api/billing/refund-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: payment.paymentId, amount }),
      });
      const body = await response.json() as RefundQuote & { error?: string };
      if (!response.ok && response.status !== 422) {
        throw new Error(body.error || 'Could not calculate refund eligibility.');
      }
      setRefundQuotes((previous) => ({ ...previous, [payment.paymentId]: body }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not calculate refund eligibility.');
    } finally {
      setBusy(false);
    }
  };

  const handleRefundSubmit = async (payment: Payment, quote: RefundQuote) => {
    if (!quote.eligible) return;
    const requestedAmount = Math.round(Number(refundAmounts[payment.paymentId]) * 100);
    const approvedDollars = (quote.approvedAmount / 100).toFixed(2);
    const deductionDollars = (quote.deduction / 100).toFixed(2);
    if (!window.confirm(
      `Submit this refund to Dodo? After deducting $${deductionDollars} for consumed credits, the refund will be $${approvedDollars}.`
    )) return;

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/billing/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: payment.paymentId, amount: requestedAmount }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not submit refund request.');
      setNotice(`Refund request submitted to Dodo. Adjusted amount: $${(body.approvedAmount / 100).toFixed(2)}. The provider will confirm the final status.`);
      setRefundQuotes((previous) => {
        const next = { ...previous };
        delete next[payment.paymentId];
        return next;
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit refund request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/70 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-950 text-cyan-300">
            {account ? <ShieldCheck className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-100">
              {account ? account.user.email : 'Account, plans & credits'}
            </p>
            <p className="text-xs text-slate-400">
              {account ? (
                <>
                  <span className={account.billingEnvironment === 'live' ? 'text-emerald-400' : 'text-amber-400'}>
                    {account.billingEnvironment.toUpperCase()} MODE
                  </span>
                  {' · '}
                  {account.subscription.isPaid ? account.subscription.plan : 'Pay as you go'}
                  {' · '}
                  {account.totalCredits.toLocaleString()} paid credits
                </>
              ) : (
                'Sign in to purchase credits or a subscription'
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {account && (
            <button
              type="button"
              onClick={() => void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Refresh failed.'))}
              className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800"
              aria-label="Refresh account and credit balance"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-slate-700"
          >
            {expanded ? 'Close' : account ? 'Manage account' : 'Sign in / Sign up'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 px-4 py-4">
          {notice && (
            <p role="status" className="mb-4 rounded-lg border border-cyan-900 bg-cyan-950/50 px-3 py-2 text-sm text-cyan-100">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="mb-4 rounded-lg border border-rose-900 bg-rose-950/50 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          )}

          {!account ? (
            <>
            {inviteToken && mode === 'register' && (
              <p className="mb-3 rounded-lg border border-cyan-900 bg-cyan-950/40 px-3 py-2 text-sm text-cyan-100">
                Invitation link detected. Register with the email address this invitation was sent to.
              </p>
            )}
            <form onSubmit={handleAuth} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <label className="text-xs text-slate-400">
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
                />
              </label>
              <label className="text-xs text-slate-400">
                Password
                <input
                  type="password"
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  minLength={mode === 'register' ? 12 : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="self-end rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
              </button>
              <button
                type="button"
                onClick={() => setMode((value) => (value === 'register' ? 'login' : 'register'))}
                className="text-left text-xs text-cyan-300 hover:text-cyan-200 sm:col-span-3"
              >
                {mode === 'register' ? 'Already have an account? Sign in' : 'New here? Create an account'}
              </button>
              {mode === 'register' && (
                <p className="text-xs text-slate-500 sm:col-span-3">
                  Use at least 12 characters. Your password is stored as a one-way hash.
                </p>
              )}
            </form>
            </>
          ) : (
            <>
              <div className="mb-4 grid gap-2 text-sm sm:grid-cols-3">
                {!account.subscription.isPaid && <Balance label="Free this month" amount={account.credits.free} />}
                <Balance label="Subscription" amount={account.credits.subscription} />
                <Balance label="Rollover" amount={account.credits.rollover} />
                <Balance label="Booster (never expires)" amount={account.credits.booster} />
              </div>
              {!account.subscription.isPaid && account.credits.free === 0 && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-700/70 bg-amber-950/40 p-4">
                  <div>
                    <p className="text-sm font-semibold text-amber-100">You’ve used your 50 free credits for this month.</p>
                    <p className="mt-1 text-xs text-amber-200/80">Upgrade for 10,000 credits each monthly billing cycle.</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy || !plans.find((plan) => plan.key === 'monthly')?.available}
                    onClick={() => {
                      const monthly = plans.find((plan) => plan.key === 'monthly');
                      if (monthly) void handleCheckout(monthly);
                    }}
                    className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                  >
                    {plans.find((plan) => plan.key === 'monthly')?.available ? 'Upgrade for $10/month' : 'Monthly product setup required'}
                  </button>
                </div>
              )}
              <p className="mb-4 text-xs text-slate-400">
                Usage costs: simple requests 1 credit, complex analysis or translation 2 credits. Credits are deducted from subscription, rollover, then booster balances.
              </p>
              <p className="mb-4 text-xs text-slate-400">
                Unused monthly subscription credits roll into a separate bucket capped at 3,000 and expire after 30 days. At each monthly renewal, the previous rollover bucket is replaced; booster credits never expire.
              </p>
              {account.subscription.status === 'past_due' && (
                <p className="mb-4 rounded-lg border border-amber-900 bg-amber-950/50 px-3 py-2 text-sm text-amber-100">
                  Your subscription payment needs attention. Paid access is temporarily in its grace period.
                </p>
              )}
              {account.canManageInvitations && (
                <section className="mb-6 space-y-3 rounded-xl border border-cyan-900/70 bg-cyan-950/20 p-4">
                  <div className="flex items-center gap-2">
                    <UserPlus className="h-4 w-4 text-cyan-300" />
                    <h3 className="text-sm font-semibold text-slate-100">Invite testers</h3>
                  </div>
                  <p className="text-xs text-slate-400">
                    Invitations are single-use, expire after 7 days, and must be accepted using the invited email address.
                  </p>
                  <form onSubmit={(event) => void handleInvitationSubmit(event)} className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <label className="text-xs text-slate-400">
                      Tester email
                      <input
                        type="email"
                        autoComplete="email"
                        value={invitationEmail}
                        onChange={(event) => setInvitationEmail(event.target.value)}
                        required
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={busy}
                      className="self-end inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
                    >
                      <Mail className="h-4 w-4" /> {sendInvitationEmail ? 'Email invite & create link' : 'Create invite link'}
                    </button>
                    <label className="flex items-center gap-2 text-xs text-slate-400 sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={sendInvitationEmail}
                        onChange={(event) => setSendInvitationEmail(event.target.checked)}
                        className="accent-cyan-500"
                      />
                      Send invitation by email (you can also copy the link)
                    </label>
                  </form>
                  {createdInviteUrl && (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        readOnly
                        aria-label="Created invitation link"
                        value={createdInviteUrl}
                        className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCopyInviteLink()}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
                      >
                        <Copy className="h-3.5 w-3.5" /> Copy link
                      </button>
                    </div>
                  )}
                  {invitations.length > 0 && (
                    <ul className="divide-y divide-slate-800">
                      {invitations.map((invitation) => (
                        <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                          <span className="text-slate-200">{invitation.email}</span>
                          <span className="text-slate-400">
                            {invitation.status} · expires {new Date(invitation.expiresAt).toLocaleDateString()}
                          </span>
                          {invitation.status === 'pending' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleRevokeInvitation(invitation)}
                              className="text-rose-300 hover:text-rose-200 disabled:opacity-50"
                            >
                              Revoke
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {plans.map((plan) => (
                  <div key={plan.key} className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-100">{plan.label}</p>
                      <CreditCard className="h-4 w-4 text-cyan-400" />
                    </div>
                    <p className="text-sm text-cyan-200">{plan.price}</p>
                    <p className="mb-3 text-xs text-slate-400">{plan.credits.toLocaleString()} credits</p>
                    <button
                      type="button"
                      disabled={busy || !plan.available || (plan.kind === 'subscription' && account.subscription.isPaid)}
                      onClick={() => void handleCheckout(plan)}
                      className="w-full rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                    >
                      {!plan.available
                        ? 'Product setup required'
                        : plan.kind === 'subscription' && account.subscription.isPaid
                          ? 'Subscription active'
                          : 'Continue to secure checkout'}
                    </button>
                  </div>
                ))}
              </div>
              <section className="mt-6 space-y-3 border-t border-slate-800 pt-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">Payment history &amp; refund requests</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Request refunds here so the consumed-credit adjustment is checked before submission to Dodo. Amounts are USD.
                  </p>
                </div>
                {payments.length === 0 ? (
                  <p className="text-xs text-slate-500">No eligible payment records are available for this account yet.</p>
                ) : (
                  payments.map((payment) => {
                    const quote = refundQuotes[payment.paymentId];
                    const remainingAmount = payment.amount - payment.refundedAmount - payment.pendingAmount;
                    return (
                      <div key={payment.paymentId} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                        <div className="flex flex-wrap justify-between gap-2 text-xs">
                          <span className="font-medium text-slate-200">
                            ${(payment.amount / 100).toFixed(2)} {payment.currency} · {new Date(payment.createdAt).toLocaleDateString()}
                          </span>
                          <span className="text-slate-500">Payment {payment.paymentId}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          {payment.creditsGranted.toLocaleString()} credits granted · {payment.creditsConsumed.toLocaleString()} consumed · ${(remainingAmount / 100).toFixed(2)} refundable before usage adjustment
                        </p>
                        {remainingAmount > 0 ? (
                          <>
                            <form onSubmit={(event) => void handleRefundQuote(event, payment)} className="mt-3 flex flex-wrap items-end gap-2">
                              <label className="text-xs text-slate-400">
                                Requested amount (USD)
                                <input
                                  type="number"
                                  min="0.01"
                                  max={(remainingAmount / 100).toFixed(2)}
                                  step="0.01"
                                  required
                                  value={refundAmounts[payment.paymentId] ?? ''}
                                  onChange={(event) => {
                                    setRefundAmounts((previous) => ({ ...previous, [payment.paymentId]: event.target.value }));
                                    setRefundQuotes((previous) => {
                                      const next = { ...previous };
                                      delete next[payment.paymentId];
                                      return next;
                                    });
                                  }}
                                  className="ml-2 w-32 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                                />
                              </label>
                              <button
                                type="submit"
                                disabled={busy}
                                className="rounded-lg border border-cyan-800 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-950 disabled:opacity-50"
                              >
                                Calculate eligible refund
                              </button>
                            </form>
                            {quote && (
                              <div className={`mt-3 rounded-lg border p-3 text-xs ${quote.eligible ? 'border-emerald-900 bg-emerald-950/30 text-emerald-100' : 'border-amber-900 bg-amber-950/30 text-amber-100'}`}>
                                <p>
                                  {quote.eligible
                                    ? `$${(quote.approvedAmount / 100).toFixed(2)} will be submitted after deducting $${(quote.deduction / 100).toFixed(2)} for ${quote.consumedCredits.toLocaleString()} consumed credits.`
                                    : quote.reason || 'This refund is not eligible.'}
                                </p>
                                {quote.eligible && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void handleRefundSubmit(payment, quote)}
                                    className="mt-2 rounded-lg bg-cyan-700 px-3 py-1.5 font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
                                  >
                                    Confirm and submit to Dodo
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">No refundable amount remains for this payment.</p>
                        )}
                      </div>
                    );
                  })
                )}
              </section>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSignOut()}
                  className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200"
                >
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Balance({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="font-mono text-lg font-semibold text-slate-100">{amount.toLocaleString()}</p>
    </div>
  );
}
