# Vouch — Decentralized P2P Crypto Lending

Vouch is a peer-to-peer crypto lending protocol that enables under-collateralized loans backed by social reputation and on-chain credit scoring.

## Architecture

```
vouch/
├── apps/
│   ├── web/            # SvelteKit frontend
│   ├── api/            # NestJS backend API
│   ├── ml-engine/      # Credit scoring ML engine (Python / FastAPI)
│   └── keeper/         # Liquidation bot (Python)
├── packages/
│   ├── contracts/      # Solidity smart contracts (Hardhat)
│   └── config/         # Shared ESLint, Prettier & TypeScript configs
├── supabase/           # Supabase config & migrations
├── docker-compose.yml  # Production container orchestration
├── nginx.conf          # Nginx reverse proxy config
└── turbo.json          # Turborepo pipeline config
```

## Tech Stack

| Layer           | Technology                         |
| --------------- | ---------------------------------- |
| Frontend        | SvelteKit, TypeScript              |
| Backend API     | NestJS, TypeScript                 |
| Database        | Supabase (Postgres, Auth, Storage) |
| Smart Contracts | Solidity, Hardhat                  |
| ML Engine       | Python, FastAPI, scikit-learn      |
| Keeper Bot      | Python, web3.py                    |
| Monorepo        | Turborepo, pnpm workspaces         |
| Deployment      | Docker Compose, Nginx              |

## Prerequisites

| Tool                    | Version                                      |
| ----------------------- | -------------------------------------------- |
| Node.js                 | ≥ 20                                         |
| pnpm                    | ≥ 9                                          |
| Docker & Docker Compose | Latest                                       |
| Python                  | ≥ 3.11 _(optional — for ML Engine & Keeper)_ |

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Start Supabase (Postgres, Auth, Storage, Studio)
npx supabase start

# 3. Set up environment variables (first time only)
cp .env.example .env
# Fill in the keys printed by `supabase start`

# 4. Start web + API in dev mode
pnpm dev
```

| Service         | URL                    |
| --------------- | ---------------------- |
| Web (SvelteKit) | http://localhost:5173  |
| API (NestJS)    | http://localhost:3000  |
| Supabase Studio | http://localhost:54323 |

For detailed instructions on running all services, see [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).

## Scripts

```bash
pnpm dev        # Start all JS/TS apps in dev mode
pnpm build      # Build all workspaces
pnpm lint       # Lint all workspaces
pnpm test       # Run all tests
```

## Smart Contracts

```bash
cd packages/contracts
npx hardhat compile     # Compile contracts
npx hardhat test        # Run tests
npx hardhat node        # Start local chain
```

## Deployment

Production runs via Docker Compose behind Nginx on a Linux VM:

```bash
docker compose up -d --build
```

See [docker-compose.yml](docker-compose.yml) and [nginx.conf](nginx.conf) for the full setup.

## License

MIT
