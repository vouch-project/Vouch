# Local Development Guide

## Prerequisites

- **Node.js** ≥ 20 (recommend 22+ for latest tooling)
- **pnpm** — enabled via `corepack enable pnpm`
- **Docker** — required for Supabase local stack
- **Python 3.11+** — only needed for ML Engine / Keeper

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Start Supabase (Postgres, Auth, Storage, Studio)
npx supabase start

# 3. Create your .env file (first time only)
cp .env.example .env
# Then fill in the keys printed by `supabase start`

# 4. Start web + API in dev mode
pnpm dev
```

After this you'll have:

| Service         | URL                                                       |
| --------------- | --------------------------------------------------------- |
| SvelteKit (web) | http://localhost:5173                                     |
| NestJS (API)    | http://localhost:3000                                     |
| Supabase Studio | http://localhost:54323                                    |
| Supabase API    | http://localhost:54321                                    |
| Postgres        | `postgresql://postgres:postgres@localhost:54322/postgres` |

## Optional Services

These run independently from `pnpm dev` — start them only when needed.

### Hardhat Node (smart contract dev)

```bash
cd packages/contracts
npx hardhat node          # local chain on http://localhost:8545
npx hardhat compile       # compile contracts
npx hardhat test          # run contract tests
```

### ML Engine (FastAPI)

```bash
cd apps/ml-engine
python -m venv .venv && source .venv/bin/activate
pip install -e .
uvicorn main:app --port 8001 --reload
```

### Keeper Bot

```bash
cd apps/keeper
python -m venv .venv && source .venv/bin/activate
pip install -e .
python main.py
```

## Stopping Services

```bash
# Stop web + API
# Ctrl+C in the terminal running `pnpm dev`

# Stop Supabase
npx supabase stop
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable                        | Used By                | Description                    |
| ------------------------------- | ---------------------- | ------------------------------ |
| `SUPABASE_URL`                  | API                    | Supabase API endpoint          |
| `SUPABASE_SECRET_KEY`           | API                    | Server-side key (bypasses RLS) |
| `VITE_SUPABASE_URL`             | Web                    | Client-side Supabase URL       |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Web                    | Client-side publishable key    |
| `DATABASE_URL`                  | API, ML Engine, Keeper | Direct Postgres connection     |

> **Note:** `VITE_` prefixed vars are exposed to the browser by Vite. Never put secrets in `VITE_` vars.

## Database Migrations

```bash
# Create a new migration
npx supabase migration new <migration_name>

# Apply migrations
npx supabase db reset

# Diff local schema changes
npx supabase db diff
```
