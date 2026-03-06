# Vouch - Decentralized P2P Lending Platform

A DeFi P2P lending platform that uses on-chain history and Machine Learning to assign credit scores to wallet addresses.

## 📁 Project Structure

```
vouch/
├── apps/
│   ├── client/                      # SvelteKit Frontend (to be generated)
│   │   ├── src/
│   │   ├── static/
│   │   ├── package.json
│   │   ├── svelte.config.js
│   │   └── vite.config.ts
│   │
│   └── core-api/                    # Node.js Core Backend API
│       ├── src/
│       │   ├── routes/              # API route handlers
│       │   │   ├── health.ts
│       │   │   ├── loans.ts
│       │   │   ├── borrowers.ts
│       │   │   ├── lenders.ts
│       │   │   └── matching.ts
│       │   ├── services/            # Business logic services
│       │   │   ├── loanService.ts
│       │   │   ├── creditScoreService.ts
│       │   │   └── matchingEngine.ts
│       │   └── index.ts             # Main server entry
│       ├── package.json
│       ├── tsconfig.json
│       └── Dockerfile
│
├── services/
│   ├── credit-score/                # Python ML Credit Score Service
│   │   ├── services/
│   │   │   ├── credit_scoring.py   # ML scoring logic
│   │   │   └── blockchain_data.py  # On-chain data fetcher
│   │   ├── models/                  # Trained ML models
│   │   ├── main.py                  # FastAPI application
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   │
│   └── liquidation-bot/             # Python Liquidation Bot
│       ├── services/
│       │   ├── loan_monitor.py     # Health factor monitoring
│       │   └── liquidator.py       # Liquidation execution
│       ├── main.py                  # Bot entry point
│       ├── requirements.txt
│       └── Dockerfile
│
├── packages/
│   └── contracts/                   # Hardhat Smart Contracts
│       ├── contracts/
│       │   ├── LendingPool.sol     # Main lending contract
│       │   └── CreditScoreOracle.sol
│       ├── scripts/
│       │   └── deploy.ts           # Deployment script
│       ├── test/
│       │   └── LendingPool.test.ts
│       ├── hardhat.config.ts
│       ├── package.json
│       └── tsconfig.json
│
├── nginx/
│   └── nginx.conf                   # Nginx reverse proxy config
│
├── docker-compose.yml               # Docker orchestration
├── turbo.json                       # TurboRepo configuration
├── package.json                     # Root package.json
├── .env.example                     # Environment variables template
├── .gitignore
├── .prettierrc
├── .eslintrc.js
└── README.md
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and npm 9+
- Python 3.11+
- Docker and Docker Compose
- Git

### 1. Clone and Setup

```bash
# Clone the repository
cd vouch

# Copy environment variables
cp .env.example .env

# Edit .env with your actual values
nano .env
```

### 2. Generate Frontend (SvelteKit)

The frontend boilerplate is **not** included in the repository. Generate it using the CLI:

```bash
# Generate SvelteKit app
npm create svelte@latest services/client

# When prompted, select:
# - Skeleton project (or SvelteKit demo app)
# - TypeScript syntax: Yes
# - ESLint: Yes
# - Prettier: Yes
# - Playwright: Yes (optional)
# - Vitest: Yes (optional)

# Navigate to the client app
cd services/client

# Install dependencies
npm install

# Install additional dependencies
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# Install WalletConnect AppKit
npm install @web3modal/ethereum @web3modal/html ethers
```

### 3. Configure SvelteKit for Monorepo

After generating the SvelteKit app, update these files:

**`services/client/vite.config.ts`:**

```typescript
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api/v1': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/ml': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
```

**`services/client/package.json` - Add these scripts:**

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest",
    "lint": "eslint ."
  }
}
```

**`services/client/tailwind.config.js`:**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

### 4. Install Dependencies

```bash
# From the root directory
npm install

# Install dependencies for all workspaces
npm install --workspaces
```

### 5. Start Development Environment

#### Option A: Using Docker (Recommended)

```bash
# Start all services with Docker Compose
npm run docker:up

# View logs
npm run docker:logs

# Stop services
npm run docker:down
```

This will start:

- Nginx (port 80)
- Core API (port 3001)
- ML Credit Score API (port 8000)
- Liquidation Bot (background)

Then, start the frontend separately:

```bash
# In a new terminal
cd services/client
npm run dev
```

Access the application at: `http://localhost`

#### Option B: Local Development (Without Docker)

```bash
# Terminal 1: Core API
cd services/core-api
npm run dev

# Terminal 2: ML Service
cd services/credit-score
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py

# Terminal 3: Frontend
cd services/client
npm run dev

# Terminal 4 (Optional): Liquidation Bot
cd services/liquidation-bot
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

### 6. Deploy Smart Contracts

```bash
# Navigate to contracts package
cd packages/contracts

# Install dependencies
npm install

# Compile contracts
npm run compile

# Deploy to local Hardhat network
npx hardhat node  # In a separate terminal
npm run deploy

# Deploy to Sepolia testnet
npm run deploy:sepolia

# Update .env with deployed contract addresses
```

## 🏗️ Architecture Overview

### Services

1. **Frontend (SvelteKit):** User interface with wallet connection
2. **Core API (Node.js/Fastify):** Business logic, matching engine, API gateway
3. **ML Service (Python/FastAPI):** Credit score calculation using on-chain data
4. **Liquidation Bot (Python):** Background worker monitoring loan health factors
5. **Smart Contracts (Solidity):** On-chain loan settlement and collateral management

### Request Flow

```
User → Nginx → Frontend (Port 5173)
             ↓
         Core API (Port 3001) → ML Service (Port 8000)
             ↓                       ↓
         Supabase              Blockchain
             ↓
     Smart Contracts ← Liquidation Bot
```

## 📦 Technology Stack

- **Frontend:** SvelteKit, TailwindCSS, WalletConnect AppKit
- **Backend:** Node.js, Fastify, TypeScript
- **ML Service:** Python, FastAPI, XGBoost, Scikit-Learn, Polars
- **Blockchain:** Solidity, Hardhat, Ethers.js, Web3.py
- **Database:** Supabase (PostgreSQL)
- **Infrastructure:** Docker, Nginx
- **Monorepo:** TurboRepo

## 🔧 Available Scripts

```bash
# Development
npm run dev                # Start all services in dev mode
npm run build              # Build all packages
npm run test               # Run all tests
npm run lint               # Lint all packages

# Docker
npm run docker:up          # Start Docker services
npm run docker:down        # Stop Docker services
npm run docker:logs        # View Docker logs
npm run docker:rebuild     # Rebuild and restart services

# Smart Contracts
cd packages/contracts
npm run compile            # Compile contracts
npm run test               # Run contract tests
npm run deploy             # Deploy contracts
```

## 🌐 API Endpoints

### Core API (`/api/v1`)

- `GET /api/v1/health` - Health check
- `GET /api/v1/loans/:loanId` - Get loan details
- `POST /api/v1/loans` - Create loan request
- `GET /api/v1/borrowers/:address` - Get borrower profile
- `GET /api/v1/lenders/:address` - Get lender profile
- `POST /api/v1/matching/find-lenders` - Find matching lenders

### ML API (`/api/ml`)

- `GET /api/ml/health` - Health check
- `POST /api/ml/credit-score` - Calculate credit score
- `POST /api/ml/credit-score/batch` - Batch credit scores

## 🔐 Environment Variables

See [.env.example](.env.example) for all required environment variables.

Critical variables:

- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `RPC_URL_MAINNET` - Ethereum RPC endpoint
- `PRIVATE_KEY` - Private key for liquidation bot
- `LENDING_POOL_ADDRESS` - Deployed lending pool contract address

## 🧪 Testing

```bash
# Test all packages
npm run test

# Test specific package
cd services/core-api && npm run test
cd packages/contracts && npm run test
```

## 📝 Next Steps

1. **Implement Frontend UI:** Create loan creation, browsing, and management interfaces
2. **Train ML Model:** Collect historical data and train the credit scoring model
3. **Add Authentication:** Implement wallet-based authentication with JWT
4. **Oracle Integration:** Connect credit scores to on-chain oracle (Chainlink)
5. **Production Deployment:** Set up CI/CD, monitoring, and production infrastructure

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License.

## 📧 Support

For questions and support, please open an issue in the GitHub repository.
