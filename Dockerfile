# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/providers/package.json packages/providers/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV APP_URL=http://localhost:3000
ENV BETTER_AUTH_SECRET=docker-build-placeholder-secret-32-characters
RUN pnpm --filter @relay/web build

FROM base AS migrator
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/packages/database/node_modules ./packages/database/node_modules
COPY packages/database/package.json packages/database/package.json
COPY packages/database/scripts packages/database/scripts
COPY packages/database/drizzle packages/database/drizzle
CMD ["node", "packages/database/scripts/migrate.mjs"]

FROM dependencies AS worker
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY packages ./packages
COPY apps/worker ./apps/worker
CMD ["./apps/worker/node_modules/.bin/tsx", "apps/worker/src/run.ts"]

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
