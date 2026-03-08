# ── Build Stage ──────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json ./

# Copy the API package + shared configs
COPY apps/api/ apps/api/
COPY packages/config/ packages/config/

RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=api

# ── Production Stage ─────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/main.js"]
