# Vouch - Setup and Configuration Guide

This document provides detailed setup instructions and configuration options for the Vouch P2P lending platform.

## Quick Setup Summary

### 1. Frontend Generation Command

```bash
npm create svelte@latest services/client
```

**Important:** When prompted:

- Choose "Skeleton project" for a minimal setup
- Enable TypeScript, ESLint, and Prettier
- After generation, install TailwindCSS and WalletConnect as shown in the README

### 2. Required Configuration Files for Frontend

Only these files need to be modified after generating the SvelteKit app:

#### `services/client/vite.config.ts`

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

#### `services/client/tailwind.config.js`

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

#### `services/client/src/app.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

#### `services/client/src/routes/+layout.svelte`

```svelte
<script>
  import '../app.css';
</script>

<slot />
```

## Service-Specific Setup

### Core API (Node.js/Fastify)

**Location:** `services/core-api`

**Dependencies:**

- Fastify for HTTP server
- Ethers.js for blockchain interaction
- Supabase client for database
- Zod for validation

**Key Files:**

- `src/index.ts` - Main server
- `src/routes/*.ts` - API endpoints
- `src/services/*.ts` - Business logic

**Running:**

```bash
cd services/core-api
npm install
npm run dev  # Development with hot reload
npm run build && npm start  # Production
```

### ML Credit Score Service (Python/FastAPI)

**Location:** `services/credit-score`

**Dependencies:**

- FastAPI for API server
- XGBoost for ML model
- Web3.py for blockchain data
- Polars for data processing

**Key Files:**

- `main.py` - FastAPI application
- `services/credit_scoring.py` - ML logic
- `services/blockchain_data.py` - Data fetching

**Running:**

```bash
cd services/credit-score
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

### Liquidation Bot (Python)

**Location:** `services/liquidation-bot`

**Dependencies:**

- Web3.py for blockchain interaction
- Schedule for periodic tasks

**Key Files:**

- `main.py` - Bot entry point
- `services/loan_monitor.py` - Health monitoring
- `services/liquidator.py` - Liquidation execution

**Running:**

```bash
cd services/liquidation-bot
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

### Smart Contracts (Solidity/Hardhat)

**Location:** `packages/contracts`

**Key Contracts:**

- `LendingPool.sol` - Main lending logic
- `CreditScoreOracle.sol` - On-chain credit scores

**Commands:**

```bash
cd packages/contracts
npm install
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.ts --network sepolia
```

## Docker Setup

### Development with Docker

```bash
# Build and start all services
npm run docker:up

# View logs
npm run docker:logs

# Rebuild after changes
npm run docker:rebuild

# Stop all services
npm run docker:down
```

### Docker Services

1. **nginx** - Reverse proxy (port 80)
2. **core-api** - Node.js backend (port 3001)
3. **credit-score-api** - Python ML service (port 8000)
4. **liquidation-bot** - Background worker

### Docker Compose Override

For local development, create `docker-compose.override.yml`:

```yaml
version: '3.8'

services:
  core-api:
    volumes:
      - ./services/core-api/src:/app/services/core-api/src
    environment:
      - NODE_ENV=development

  credit-score-api:
    volumes:
      - ./services/credit-score:/app
```

## Environment Configuration

### Required Environment Variables

```bash
# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Blockchain RPC
RPC_URL_MAINNET=https://eth-mainnet.g.alchemy.com/v2/YOUR-API-KEY
RPC_URL_SEPOLIA=https://eth-sepolia.g.alchemy.com/v2/YOUR-API-KEY

# Smart Contracts
LENDING_POOL_ADDRESS=0x...
CREDIT_SCORE_ORACLE_ADDRESS=0x...

# Bot Private Key (KEEP SECURE!)
PRIVATE_KEY=your-private-key

# API Keys
ETHERSCAN_API_KEY=your-etherscan-api-key
```

### Obtaining API Keys

1. **Alchemy (RPC):** Sign up at https://www.alchemy.com
2. **Etherscan:** Get API key at https://etherscan.io/apis
3. **Supabase:** Create project at https://supabase.com

## Nginx Configuration

The Nginx reverse proxy routes requests:

- `/` → SvelteKit frontend (port 5173)
- `/api/v1/*` → Core API (port 3001)
- `/api/ml/*` → ML Service (port 8000)

**Rate Limiting:**

- API endpoints: 10 requests/second
- ML endpoints: 5 requests/second

## Database Schema (Supabase)

### Tables to Create

```sql
-- Loans table
CREATE TABLE loans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  borrower_address TEXT NOT NULL,
  lender_address TEXT,
  collateral_token TEXT NOT NULL,
  loan_token TEXT NOT NULL,
  collateral_amount NUMERIC NOT NULL,
  loan_amount NUMERIC NOT NULL,
  interest_rate INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Lender offers table
CREATE TABLE lender_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lender_address TEXT NOT NULL,
  max_amount NUMERIC NOT NULL,
  min_interest_rate INTEGER NOT NULL,
  min_credit_score INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Credit scores cache table
CREATE TABLE credit_scores (
  wallet_address TEXT PRIMARY KEY,
  score INTEGER NOT NULL,
  score_breakdown JSONB,
  risk_level TEXT NOT NULL,
  confidence NUMERIC NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Testing

### Unit Tests

```bash
# Test Core API
cd services/core-api
npm test

# Test Smart Contracts
cd packages/contracts
npx hardhat test
```

### Integration Tests

```bash
# Start all services
npm run docker:up

# Run integration tests (to be implemented)
npm run test:e2e
```

### Manual Testing

1. Start all services
2. Generate a test wallet
3. Create a loan request via API
4. Check credit score calculation
5. Fund the loan
6. Monitor liquidation bot logs

## Production Deployment

### Recommended Stack

- **Frontend:** Vercel or Netlify
- **Backend APIs:** Railway, Render, or AWS ECS
- **Database:** Supabase (managed)
- **Blockchain:** Mainnet with production RPC

### Security Checklist

- [ ] Use environment-specific RPC endpoints
- [ ] Secure private keys with secrets management
- [ ] Enable HTTPS/TLS
- [ ] Implement rate limiting
- [ ] Add authentication/authorization
- [ ] Enable CORS properly
- [ ] Audit smart contracts
- [ ] Set up monitoring and alerts

### CI/CD Pipeline

```yaml
# Example GitHub Actions workflow
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run build
      - run: npm run test
      # Add deployment steps
```

## Troubleshooting

### Common Issues

**Docker services won't start:**

```bash
# Check ports are available
lsof -i :80 -i :3001 -i :8000

# Rebuild images
npm run docker:rebuild
```

**Python dependencies fail:**

```bash
# Upgrade pip
pip install --upgrade pip

# Use specific Python version
python3.11 -m venv venv
```

**Smart contract deployment fails:**

```bash
# Check network configuration
npx hardhat console --network sepolia

# Verify account has funds
# Get test ETH from faucet
```

**Frontend can't connect to wallet:**

- Ensure MetaMask is installed
- Check network matches deployed contracts
- Verify WalletConnect project ID

## Monitoring and Logging

### Application Logs

```bash
# Core API logs
docker logs vouch-core-api -f

# ML Service logs
docker logs vouch-credit-score -f

# Liquidation Bot logs
docker logs vouch-liquidation-bot -f
```

### Recommended Monitoring

- **Uptime:** UptimeRobot or Pingdom
- **Logs:** Datadog, LogRocket, or Sentry
- **Blockchain:** Etherscan alerts
- **Performance:** New Relic or Grafana

## Next Development Steps

1. **Frontend UI:**
   - Wallet connection component
   - Loan request form
   - Dashboard for borrowers/lenders
   - Loan marketplace

2. **Backend Enhancements:**
   - Authentication with JWT
   - Webhook notifications
   - Advanced matching algorithm
   - Risk assessment

3. **ML Model:**
   - Data collection pipeline
   - Feature engineering
   - Model training
   - A/B testing

4. **Smart Contracts:**
   - Flash loan protection
   - Multi-collateral support
   - Governance token
   - Insurance fund

## Support and Resources

- **Documentation:** This README and SETUP.md
- **Issues:** GitHub Issues
- **Community:** Discord (to be set up)
- **Updates:** Follow development blog

---

**Last Updated:** February 15, 2026
