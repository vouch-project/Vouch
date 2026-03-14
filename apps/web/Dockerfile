# ── Build Stage ──────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json ./

# Copy the web app + shared configs
COPY apps/web/ apps/web/
COPY packages/config/ packages/config/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter=@vouch/web exec svelte-kit sync
RUN pnpm turbo run build --filter=@vouch/web

# Use pnpm deploy to create a standalone bundle (resolves symlinks)
RUN pnpm --filter=@vouch/web deploy --prod /app/deployed

# ── Production Stage ─────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/deployed/node_modules ./node_modules
COPY --from=builder /app/apps/web/build ./build
COPY --from=builder /app/deployed/package.json ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "build"]
