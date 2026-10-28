# OmniSci - Practical Feasibility & Research Foundry

OmniSci is a React and Express application for exploring scientific project feasibility, translating historical research notes, and organizing project plans.

## Run locally

Prerequisite: Node.js compatible with Vite 8.

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY` to enable Gemini-backed analysis. Keep the key in this server-side environment file; do not add it to client code or commit it. Without the key, health checks and the frontend still load, but protected AI requests return an explicit unavailable response.

3. Start the development server:

   ```sh
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Checks and production

```sh
npm run lint
npm run build
```

To serve the production build with the Express API:

```sh
NODE_ENV=production npm start
```

`npm start` builds the frontend before launching the server. In production, the server also builds the frontend if `dist/index.html` is missing, preventing startup with a broken SPA route when a deployment omits the build step.

## Billing setup

The app's billing routes require a Render PostgreSQL database and Dodo Payments credentials. Copy the related placeholders from `.env.example` into the Render web service's environment settings; never expose Dodo or Gemini secrets in frontend code.

1. Create a Render PostgreSQL database and set `DATABASE_URL` on the web service. On startup, the server creates/updates the billing tables from `db/billing-schema.sql`.
2. Configure SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`) and set `APP_URL` to the app's public HTTPS URL. New accounts must verify their email before signing in. Registration is limited to three attempts per network address per 24 hours.
3. In Dodo test mode, create these products and copy each product ID into Render:
   - Monthly subscription: $10 USD, 10,000 credits per billing cycle.
   - Yearly subscription: $96 USD, 13,500 credits per annual cycle.
   - Starter booster: $5 USD, 500 non-expiring credits.
   - Power User booster: $20 USD, 2,500 non-expiring credits.
4. Create a Dodo webhook pointing to `https://YOUR_APP/api/webhooks/dodo`. Subscribe to `payment.succeeded`, `refund.succeeded`, `subscription.active`, `subscription.renewed`, `subscription.past_due`, `subscription.cancelled`, `subscription.on_hold`, and `subscription.expired`; store its signing secret in `DODO_PAYMENTS_WEBHOOK_KEY`.
5. Test checkout and webhook delivery using a test API key and `DODO_ENVIRONMENT=test_mode`. Change to a live API key, live product IDs, and `DODO_ENVIRONMENT=live_mode` only after successful test payments.

Signed Dodo webhooks are the sole source of credit grants. The backend verifies webhook signatures, ignores duplicate event IDs, and stores credits as separate subscription, rollover, booster, and free grants. Usage costs 1 credit for note synthesis, 2 for feasibility analysis or historical translation. Unused monthly subscription credits can roll into a 3,000-credit bucket for 30 days; a successful monthly renewal replaces the previous rollover pool. Booster credits do not expire. A free account receives 50 credits per UTC calendar month for one-credit requests only; free credits do not roll over. Complex and historical generation is blocked for free-only balances.

Email verification, Dodo checkout, payment fulfillment, and paid AI usage cannot be fully exercised until the Render database, SMTP, Dodo products, and webhook secrets are configured.
