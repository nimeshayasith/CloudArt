# CloudArt

**Where Cloud Engineering Becomes Art.** — the CloudArt business platform: an architecture-led cloud / AWS / DevOps studio site and business plan.

Live: https://main.d3ag7vu427q7y9.amplifyapp.com/

## Stack
React 19 · Vite · Tailwind CSS 3 · deployed with AWS Amplify Hosting (auto-deploys from `main`).

## Develop
```bash
npm install
npm run dev      # local dev server
npm run lint     # oxlint
npm run build    # production build → dist/
```

## Structure
- `src/content/site.js` — **all copy** (hero, services, business model, roadmap). Edit the business plan here.
- `src/components/` — `Hero`, `Services`, `ArchitectureReveal`, `BusinessModel`, `Roadmap`, `Contact`, `Navigation`.
- `amplify.yml` — Amplify build spec.
