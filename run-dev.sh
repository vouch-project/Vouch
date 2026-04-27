#!/bin/sh
# Load .env if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Stop and remove any existing vouch-redis container
echo "▶ Stopping any existing vouch-redis container…"
docker rm -f vouch-redis 2>/dev/null || true

# Start Redis with password if REDIS_PASSWORD is set, else without
echo "▶ Starting Redis on :6379…"
if [ -n "$REDIS_PASSWORD" ]; then
  docker run --rm -d --name vouch-redis -p 6379:6379 redis:7 --requirepass "$REDIS_PASSWORD" > /dev/null
else
  docker run --rm -d --name vouch-redis -p 6379:6379 redis:7 > /dev/null
fi

cleanup() {
  echo "▶ Stopping Redis…"
  docker stop vouch-redis >/dev/null 2>/dev/null || true

  echo "▶ Stopping Supabase…"
  npx supabase stop >/dev/null 2>/dev/null || true
}
trap cleanup EXIT INT

echo "▶ Starting Supabase…"
npx supabase start
echo "▶ Starting dev servers (turbo)…"
turbo run dev "$@"
