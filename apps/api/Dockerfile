# ── Build Stage ──────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json ./

# Copy the API package + shared configs
COPY apps/api/ apps/api/
COPY packages/config/ packages/config/
COPY packages/abi/ packages/abi/
COPY packages/database-types/ packages/database-types/
COPY packages/contracts/ packages/contracts/

RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@vouch/api

# Use pnpm deploy to create a standalone bundle (resolves symlinks)
RUN pnpm --filter=@vouch/api deploy --prod /app/deployed

# ── Production Stage ─────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/deployed/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/deployed/package.json ./

ENV NODE_ENV=production
# EC key files for ES256 JWT signing are mounted at runtime — never baked into the image.
# Mount them via Docker secrets or a volume and set SUPABASE_EC_PRIVATE_KEY_PATH /
# SUPABASE_EC_PUBLIC_KEY_PATH env vars to their paths inside the container.
# Example: docker run -v /host/keys:/run/secrets/keys \
#   -e SUPABASE_EC_PRIVATE_KEY_PATH=/run/secrets/keys/ec_private.pem \
#   -e SUPABASE_EC_PUBLIC_KEY_PATH=/run/secrets/keys/ec_public.pem ...
EXPOSE 3000

CMD ["node", "dist/main.js"]
