# CloudArt

**Where Cloud Engineering Becomes Art.** — a free cloud-learning platform (AWS first, then Azure & DevOps) with hands-on labs and cloud deployment services.

## Monorepo

| Path | What |
| --- | --- |
| `frontend/` | React 19 + Vite + Tailwind (public site; app screens come next) |
| `backend/` | Node.js + Express API (modular monolith) + Prisma + PostgreSQL |
| `docs/` | `architecture.md`, `database-design.md`, `deployment-options.md`, `aws-resources.md` |
| `deploy/` | Production server files (Docker Compose and settings example) |
| `docker-compose.yml` | Local PostgreSQL |
| `amplify.yml` | Amplify build spec (builds `frontend/`); not used by the chosen deployment (S3 + CloudFront) |

## Run locally

```bash
docker compose up -d                          # PostgreSQL on :5433

cd backend
cp .env.example .env
npm install
npx prisma migrate dev && npm run db:seed
npm run dev                                   # API on :4000
npm test

cd ../frontend
npm install && npm run dev                    # site on :5173
```

See [docs/architecture.md](docs/architecture.md) and [docs/database-design.md](docs/database-design.md).
