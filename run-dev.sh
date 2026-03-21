#!/bin/sh
# Load .env if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi
# Stop and remove any existing vouch-redis container
docker rm -f vouch-redis 2>/dev/null || true


# Start Redis with password if REDIS_PASSWORD is set, else without
if [ -n "$REDIS_PASSWORD" ]; then
  docker run --rm -d --name vouch-redis -p 6379:6379 redis:7 --requirepass "$REDIS_PASSWORD" > /dev/null
else
  docker run --rm -d --name vouch-redis -p 6379:6379 redis:7 > /dev/null
fi

cleanup() {
  docker stop vouch-redis
  npx supabase stop
}
trap cleanup EXIT INT

npx supabase start
turbo run dev "$@"
