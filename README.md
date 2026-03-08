# Vouch — Decentralized P2P Crypto Lending

Vouch is a peer-to-peer crypto lending protocol that enables under-collateralized loans backed by social reputation and on-chain credit scoring.

## Architecture

```
vouch/
├── apps/
│   ├── web/            # SvelteKit frontend
│   ├── api/            # NestJS core backend service
│   ├── ml-engine/      # Credit Scoring ML Engine (Python / FastAPI)
│   └── keeper/         # Protocol Keeper / Liquidation Bot (Python)
├── packages/
│   ├── contracts/      # Solidity smart contracts (Hardhat)
│   └── config/         # Shared ESLint, Prettier & TypeScript configs
├── docker-compose.yml  # Local dev environment
└── turbo.json          # Turborepo pipeline config
```

## Prerequisites

| Tool                    | Version |
| ----------------------- | ------- |
| Node.js                 | ≥ 18    |
| pnpm                    | ≥ 9     |
| Python                  | ≥ 3.11  |
| Docker & Docker Compose | Latest  |

## Getting Started

### 1. Install Dependencies

```bash
# Install Node.js / TypeScript dependencies across all workspaces
pnpm install

# Install Python dependencies for ML Engine
cd apps/ml-engine && python -m venv .venv && source .venv/bin/activate && pip install -e . && cd ../..

# Install Python dependencies for Keeper
cd apps/keeper && python -m venv .venv && source .venv/bin/activate && pip install -e . && cd ../..
```

### 2. Start Local Environment with Docker

```bash
# Start all services (PostgreSQL, Hardhat node, API, Web, ML Engine, Keeper)
docker-compose up

# Or start only infrastructure (database + chain)
docker-compose up postgres hardhat-node
```

### 3. Run in Development Mode

```bash
# Run all JS/TS apps in dev mode via Turborepo
pnpm turbo run dev

# Run a specific app
pnpm turbo run dev --filter=web
pnpm turbo run dev --filter=api
```

### 4. Build & Test

```bash
# Build all workspaces
pnpm turbo run build

# Run all tests
pnpm turbo run test

# Lint all workspaces
pnpm turbo run lint
```

### 5. Smart Contracts

```bash
cd packages/contracts

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Start a local Hardhat node
npx hardhat node
```

## License

MIT
