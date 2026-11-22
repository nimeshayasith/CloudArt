# syntax=docker/dockerfile:1
# CloudArt API image. Build from the backend/ folder:   docker build -t cloudart-api backend
# Works on x86 and on arm64 (Graviton, e.g. t4g servers): build with `docker buildx build --platform linux/arm64`.

# ── build: install production dependencies and generate the Prisma client
FROM node:22-bookworm-slim AS build
WORKDIR /app
# openssl must be present BEFORE `npm ci`: Prisma downloads the engine that matches the installed openssl, and the run stage
# (which also has openssl) then finds it. Without this the tool tried to download one at run time and failed (error E13).
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
COPY prisma.config.mjs ./
# `prisma generate` reads the config, which wants a DATABASE_URL; any value works because it does not connect.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate

# ── run: only what the API needs, as an unprivileged user
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# Prisma's migration tool looks for the system openssl library and warns (and may misbehave) without it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY package.json prisma.config.mjs ./
COPY prisma ./prisma
COPY src ./src
USER node
EXPOSE 4000
# Liveness only (the process answers). The database check is /api/v1/health/db.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations and the one-time seed run from this same image:
#   docker run --rm --env-file .env.prod IMAGE ./node_modules/.bin/prisma migrate deploy
#   docker run --rm --env-file .env.prod IMAGE node prisma/seed.js
CMD ["node", "src/server.js"]
