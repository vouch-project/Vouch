# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vouch is a decentralized P2P crypto lending protocol built with a Turborepo monorepo. The system enables under-collateralized loans backed by social reputation and on-chain credit scoring.

## Monorepo Structure

```
vouch/
├── apps/
│   ├── web/            # SvelteKit frontend (TypeScript)
│   ├── api/            # NestJS backend API (TypeScript)
│   ├── ml-engine/      # Credit scoring ML engine (Python/FastAPI)
│   └── keeper/         # Liquidation bot (Python)
├── packages/
│   ├── contracts/      # Solidity smart contracts (Hardhat)
│   └── config/         # Shared ESLint/Prettier/TypeScript configs
└── supabase/           # Database migrations and config
```

## Development Commands

### Start Development Environment
```bash
pnpm dev                # Runs ./run-dev.sh - starts Redis, Supabase, web + API
```

The `run-dev.sh` script:
- Starts Redis in Docker (vouch-redis container)
- Starts Supabase local stack
- Runs `turbo run dev` for web + API
- Cleans up Redis and Supabase on exit

### Individual Workspace Commands
```bash
# In root
pnpm build              # Build all workspaces
pnpm lint               # Lint all workspaces
pnpm test               # Run all tests

# In apps/web
pnpm dev                # Start SvelteKit dev server (port 5173)
pnpm build              # Build for production
pnpm check              # Type-check with svelte-check

# In apps/api
pnpm dev                # Start NestJS with nodemon (port 3000)
pnpm test               # Run Jest unit tests
pnpm test:watch         # Run tests in watch mode
pnpm test:e2e           # Run e2e tests

# In packages/contracts
pnpm dev                # Start Hardhat node + run dev-setup.sh
pnpm build              # Compile contracts
pnpm test               # Run Hardhat tests
npx hardhat node        # Start local blockchain (port 8545)
npx hardhat compile     # Compile without dev setup
```

### Database Commands
```bash
npx supabase start      # Start local Supabase (required before pnpm dev)
npx supabase stop       # Stop Supabase
npx supabase db reset   # Reset database (apply all migrations)

# Migrations
npx supabase migration new <name>    # Create new migration
npx supabase db diff                 # Diff local schema changes
pnpm db:generate                     # Create timestamped migration
pnpm db:generate:types               # Generate TypeScript types to apps/api/src/supabase/database-generated.types.ts
```

### Python Services (Optional)
```bash
# ML Engine (apps/ml-engine)
python -m venv .venv && source .venv/bin/activate
pip install -e .
uvicorn main:app --port 8001 --reload

# Keeper Bot (apps/keeper)
python -m venv .venv && source .venv/bin/activate
pip install -e .
python main.py
```

## Architecture & Conventions

### API (NestJS)
- **Modules**: `auth`, `loan`, `blockchain-listener`, `chain`, `tokens`, `supabase`
- **Guards**: Auth guards located in `src/guards/`
- **Supabase client**: Service wrapper in `src/supabase/` provides database access
- **Database types**: Auto-generated in `src/supabase/database-generated.types.ts` via `pnpm db:generate:types`
- Uses JWT authentication with Supabase
- Redis for caching (automatically started by run-dev.sh)

### Web (SvelteKit)
- **Routes**: File-based routing in `src/routes/` - `borrow`, `dashboard`, `lend`, `marketplace`
- **API client**: Axios wrappers in `src/api/`
- **UI components**: Reusable components in `src/lib/`
- **Wallet integration**: Reown (Web3Modal) for wallet connection
- Svelte 5 with runes (modern reactivity)
- Environment variables prefixed with `PUBLIC_` are exposed to browser

#### Frontend Design & Styling
- **Component library**: `shadcn-svelte` - import from `$lib/components/ui/`
  - Common components: `Button`, `Badge`, `Card`, `Table`, `Tabs`, etc.
  - Namespace imports for multi-part components: `* as Table from '$lib/components/ui/table'`
  - Install new components: `npx shadcn-svelte@latest add <component-name>` (see https://www.shadcn-svelte.com/docs/components)
- **Theme system**: CSS custom properties defined in `app.css` using OKLCH color space
  - **IMPORTANT**: Always use theme colors (`bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `border-border`, etc.) instead of hardcoded Tailwind colors for accurate theming
  - Both light and dark modes supported via `.dark` class
  - Theme tokens: `background`, `foreground`, `card`, `muted`, `accent`, `primary`, `secondary`, `destructive`, `border`, `ring`
- **Icons**: `lucide-svelte` icons
- **Utilities**: 
  - `cn()` from `$lib/utils` for conditional classnames
  - Tailwind for spacing, layout, and utilities (but use theme colors for actual colors)
- **Common patterns**:
  - Backdrop blur effects: `backdrop-blur-sm`, `backdrop-blur-md` for glassmorphism
  - Responsive breakpoints: `sm:`, `md:`, `lg:` prefixes
  - State-based styling with data attributes (e.g., `data-open`, `data-active`)
  - Skeleton loaders: `bg-muted animate-pulse`
  - Hover effects: `hover:bg-muted/10 transition-colors`

### Smart Contracts (Hardhat)
- **Main contract**: `VouchVault.sol` - handles lending/borrowing
- **Test helpers**: `MockERC20.sol` for testing
- Uses OpenZeppelin contracts (upgradeable)
- Run `pnpm dev` in contracts package to start local chain with deployment scripts

### Turborepo Pipeline
- `dev` tasks are persistent and run in parallel
- API and web `dev` tasks depend on `supabase#setup`
- `build` tasks have dependency chains via `^build`
- `test` tasks depend on `build` completing first

## Environment Variables

Copy `.env.example` to `.env`. Key variables:

| Variable                       | Used By    | Description                        |
| ------------------------------ | ---------- | ---------------------------------- |
| `SUPABASE_URL`                 | API        | Supabase API endpoint              |
| `SUPABASE_SECRET_KEY`          | API        | Server-side key (bypasses RLS)     |
| `JWT_SECRET`                   | API        | JWT signing secret                 |
| `PUBLIC_SUPABASE_URL`          | Web        | Client-side Supabase URL           |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Web     | Client-side publishable key        |
| `PUBLIC_REOWN_PROJECT_ID`      | Web        | Reown/Web3Modal project ID         |
| `DATABASE_URL`                 | API        | Direct Postgres connection string  |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | API | Redis connection            |

Get Supabase keys by running `npx supabase start` - they're printed in the output.

## Local Service URLs

After `pnpm dev`:
- Web: http://localhost:5173
- API: http://localhost:3000
- Supabase Studio: http://localhost:54323
- Supabase API: http://localhost:54321
- Postgres: postgresql://postgres:postgres@localhost:54322/postgres
- Hardhat (if running): http://localhost:8545

## Important Notes

- Always run `npx supabase start` before `pnpm dev` (unless using `./run-dev.sh`)
- Redis is automatically managed by `run-dev.sh` via Docker
- Package manager is pnpm (enforced via packageManager field)
- Node.js >= 20 required
- Type generation from database schema must be run manually after schema changes
