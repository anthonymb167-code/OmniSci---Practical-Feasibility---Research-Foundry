import { FormEvent, useEffect, useState } from 'react';
import { CreditCard, LogOut, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';

type Plan = {
  key: string;
  label: string;
  price: string;
  kind: 'subscription' | 'booster';
  credits: number;
  available: boolean;
};

type Account = {
  user: { email: string };
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
  const [expanded, setExpanded] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [accountResponse, plansResponse] = await Promise.all([
      fetch('/api/billing/account'),
      fetch('/api/billing/plans'),
    ]);

    if (accountResponse.ok) {
      setAccount((await accountResponse.json()) as Account);
    } else if (accountResponse.status === 401) {
      setAccount(null);
    } else {
      const body = await accountResponse.json().catch(() => ({}));
      throw new Error(body.error || 'Could not load billing account.');
    }

    if (plansResponse.ok) {
      const body = (await plansResponse.json()) as { plans: Plan[] };
      setPlans(body.plans);
    }
  };

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
        body: JSON.stringify({ email, password }),
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
