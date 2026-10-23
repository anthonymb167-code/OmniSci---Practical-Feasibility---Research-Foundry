# OmniSci - Practical Feasibility & Research Foundry

OmniSci is a React and Express application for exploring scientific project feasibility, translating historical research notes, and organizing project plans.

## Run locally

Prerequisite: Node.js compatible with Vite 8.

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY` to enable Gemini-backed analysis. Keep the key in this server-side environment file; do not add it to client code or commit it. The app can also run without a key, using its built-in demo responses.

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
