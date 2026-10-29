import { ReactNode } from 'react';

type LegalPage = 'terms' | 'privacy' | 'refunds';

const pageTitles: Record<LegalPage, string> = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
  refunds: 'Refund Policy',
};

function getLegalPage(pathname: string): LegalPage | null {
  if (pathname === '/terms') return 'terms';
  if (pathname === '/privacy') return 'privacy';
  if (pathname === '/refunds') return 'refunds';
  return null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-cyan-200">{title}</h2>
      <div className="space-y-3 leading-7 text-slate-300">{children}</div>
    </section>
  );
}

export function LegalPages() {
  const page = getLegalPage(window.location.pathname);
  if (!page) return null;

  return (
    <div className="min-h-screen bg-[#090d16] px-4 py-8 text-slate-100 sm:px-6">
      <header className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <a href="/" className="font-mono text-lg font-bold text-cyan-300 hover:text-cyan-200">
          OmniSci Foundry
        </a>
        <nav aria-label="Legal pages" className="flex flex-wrap gap-4 text-sm text-slate-300">
          {(Object.keys(pageTitles) as LegalPage[]).map((key) => (
            <a key={key} href={`/${key}`} className={page === key ? 'text-cyan-300' : 'hover:text-white'}>
              {pageTitles[key]}
            </a>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-4xl space-y-8 py-8">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-cyan-400">OmniSci · Uganda</p>
          <h1 className="mt-2 text-3xl font-bold">{pageTitles[page]}</h1>
          <p className="mt-3 text-sm text-slate-400">
            These pages describe the current service. They do not limit any rights that cannot be limited under applicable law.
          </p>
        </div>

        {page === 'terms' && (
          <>
            <Section title="The service">
              <p>
                OmniSci provides tools for organizing research projects and generating AI-assisted scientific feasibility
                analyses, translations, and note suggestions. AI-generated material can be incomplete or incorrect; it is
                informational only and is not professional, engineering, laboratory, medical, regulatory, or investment
                advice. Independently verify important claims and obtain qualified review before relying on an output or
                carrying out an experiment.
              </p>
              <p>
                You are responsible for the content you submit and for using the service lawfully. Do not submit material
                you are not authorized to share or use the service to cause harm, break the law, or interfere with the
                service or other users.
              </p>
            </Section>
            <Section title="Accounts and saved work">
              <p>
                You must provide an email address you control and verify it to use account and paid features. Keep your
                sign-in credentials private. Research projects are currently stored in your browser and may not sync across
                devices; clearing browser storage can remove that locally saved work.
              </p>
            </Section>
            <Section title="Plans, credits, and billing">
              <p>
                Current plans are $10 USD monthly for 10,000 credits, $96 USD yearly for 13,500 credits, a $5 USD
                500-credit booster, and a $20 USD 2,500-credit booster. The free allowance is 50 credits per UTC calendar
                month. Prices and availability shown at checkout control if they differ from this summary.
              </p>
              <p>
                A simple request costs 1 credit; feasibility analysis and historical translation cost 2. Monthly
                subscription credits expire with their cycle. Eligible unused monthly credits can roll over up to 3,000
                credits for 30 days; monthly renewal replaces the prior rollover balance. Booster credits do not expire.
                Credits are account-bound, have no cash value, and cannot be transferred.
              </p>
              <p>
                Subscriptions recur until cancellation is processed. Checkout and payment processing are provided by
                Dodo Payments as Merchant of Record and are subject to the terms presented by Dodo Payments. To request
                cancellation, email the contact below. Cancellation is not currently available inside the app; support
                will confirm when the cancellation takes effect. Cancellation alone does not issue a refund.
              </p>
            </Section>
            <Section title="Availability and changes">
              <p>
                We may maintain, change, or discontinue features. We aim to keep the service available but do not promise
                uninterrupted operation. Nothing in these terms excludes rights or remedies that applicable law does not
                permit us to exclude.
              </p>
            </Section>
            <Section title="Governing law">
              <p>
                These terms are intended to be governed by the laws of Uganda, subject to mandatory consumer protections
                and any jurisdictional rules that apply to you.
              </p>
            </Section>
          </>
        )}

        {page === 'privacy' && (
          <>
            <Section title="Information handled">
              <p>
                Account information includes your email address, a one-way password hash, email-verification state, and
                hashed session tokens with expiry dates. Billing records include plan and subscription status, credit
                balances, provider event identifiers, and payment references needed to provide paid features. We do not
                receive or store your full payment-card number or security code through the app checkout flow.
              </p>
              <p>
                If an invitation is created for you, we store the invited email address, invitation creator, a hashed
                single-use link token, and its expiry, redemption, and revocation timestamps. Invitation links expire
                after seven days. The invitation email is sent through our configured email delivery provider.
              </p>
              <p>
                Research projects are saved in your browser&apos;s local storage. When you request AI analysis, translation,
                or note synthesis, the text and related project details you submit are sent to Google&apos;s Gemini service
                for processing. Do not submit sensitive information unless you are comfortable with that processing.
              </p>
            </Section>
            <Section title="Camera, microphone, and browser storage">
              <p>
                The optional presence feature can request camera access. Frame-based presence checks run in your browser;
                the app does not upload camera frames or create biometric identity templates. The default simulated mode
                is not identity verification. Optional dictation or audio-note features may use browser speech or media
                APIs; browser providers may process speech under their own terms. Audio is not sent to OmniSci&apos;s server
                by the note-synthesis request, which submits note text.
              </p>
              <p>
                The app uses an HTTP-only session cookie for account sign-in and local storage for browser-saved project
                data. You can clear local project data through your browser settings, but that does not delete your server
                account or billing records.
              </p>
            </Section>
            <Section title="Service providers and purposes">
              <p>
                We use Render to host the app and database, Google Gemini to process requested AI features, an email
                delivery provider to send verification messages, and Dodo Payments as Merchant of Record for checkout and
                payment administration. These providers process information needed to deliver their respective services.
              </p>
              <p>
                If Sentry monitoring is enabled on the server, it receives scrubbed error reports for reliability work.
                The integration removes request and user data, breadcrumbs, and original error messages before sending.
              </p>
            </Section>
            <Section title="Retention, security, and requests">
              <p>
                We keep account and billing information while needed to provide the service, manage disputes, and meet
                legal or accounting obligations. Passwords and session tokens are stored as hashes. No internet service
                can guarantee absolute security.
              </p>
              <p>
                To ask about, correct, or request deletion of account information, contact us at the email below. We will
                review the request and may retain records required for legal, payment, fraud-prevention, or accounting
                purposes. Your browser-stored project data must be removed separately in your browser.
              </p>
            </Section>
          </>
        )}

        {page === 'refunds' && (
          <>
            <Section title="Requesting a refund">
              <p>
                For an eligible payment, sign in and open Payment history &amp; refund requests in your account panel.
                The app checks the payment and credit-use records before submitting an adjusted refund request to Dodo
                Payments, our Merchant of Record. Older or unmatched payments can be referred to the support email
                below for review. Approval and timing remain subject to applicable law and Dodo Payments&apos; rules.
              </p>
              <p>
                A successful refund may change the credits associated with the purchase. Refunds are not initiated by
                cancelling a subscription; send a separate refund request. Any mandatory refund rights under applicable
                law remain unaffected.
              </p>
              <p>
                <strong>Credits spent / consumption rule:</strong> Before an eligible partial refund is submitted, the
                app calculates the listed USD value of credits consumed from the relevant purchase, based on that
                product&apos;s configured price and credit allocation. This consumed value is deducted from the requested
                refund amount. If consumed value is equal to or greater than the amount requested, the app will not
                submit that refund request. The app shows the calculation before you confirm submission.
              </p>
              <p>
                When Dodo confirms a refund, the app automatically removes the corresponding proportion of credits
                associated with that payment. Only unspent credits can be removed; credits already used are not converted
                into a negative balance. Older or unmatched transactions, including subscription payments with rollover
                credits whose original payment cannot be identified, may require manual account review.
              </p>
            </Section>
            <Section title="Subscription cancellation">
              <p>
                To stop future subscription renewals, email support. Cancellation is processed through the payment
                provider, and support will confirm the effective date. The app does not currently have an in-app
                cancellation control. Cancelling a subscription does not itself refund a prior payment.
              </p>
            </Section>
          </>
        )}

        <Section title="Contact">
          <p>
            OmniSci · Mukalazi Parish, Bukoto I, Nakawa Division, Kampala, Central Region, Uganda
            <br />
            Email: <a className="text-cyan-300 underline" href="mailto:anthonymb167@gmail.com">anthonymb167@gmail.com</a>
          </p>
        </Section>
      </main>
    </div>
  );
}
