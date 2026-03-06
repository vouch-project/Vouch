# Vouch - Quick Start Guide

Get Vouch up and running in 5 minutes!

## Prerequisites Check

Make sure you have these installed:

```bash
node --version    # Should be 18+
npm --version     # Should be 9+
python --version  # Should be 3.11+
docker --version  # Any recent version
```

## Step-by-Step Setup

### Step 1: Environment Setup (1 minute)

```bash
# Navigate to the project
cd vouch

# Copy and configure environment variables
cp .env.example .env

# Open .env and add your keys:
# - Get RPC URL from https://www.alchemy.com (free tier)
# - Get Supabase keys from https://supabase.com (free tier)
nano .env
```

**Minimum required for development:**

```env
RPC_URL_MAINNET=https://eth-mainnet.g.alchemy.com/v2/YOUR-KEY
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
JWT_SECRET=any-random-string-for-development
```

### Step 2: Install Dependencies (2 minutes)

```bash
# Install root and service dependencies
npm install
```

### Step 3: Generate Frontend (1 minute)

```bash
# Generate SvelteKit app
npm create svelte@latest services/client

# Select these options:
# ✓ Skeleton project
# ✓ TypeScript
# ✓ ESLint + Prettier

# Install frontend dependencies
cd services/client
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm install @web3modal/ethereum @web3modal/html ethers
cd ../..
```

### Step 4: Configure Frontend (30 seconds)

Create/update `services/client/vite.config.ts`:

```typescript
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api/v1': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/ml': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
});
```

### Step 5: Start Development (30 seconds)

#### Option A: Using Docker (Recommended)

```bash
# Start backend services
npm run docker:up

# In a new terminal, start frontend
cd services/client
npm run dev
```

#### Option B: Manual Start

```bash
# Terminal 1: Core API
cd services/core-api && npm run dev

# Terminal 2: ML Service
cd services/credit-score
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt && python main.py

# Terminal 3: Frontend
cd services/client && npm run dev
```

### Step 6: Verify It's Working

Open your browser and check:

- ✅ Frontend: http://localhost:5173
- ✅ Core API: http://localhost:3001/api/v1/health
- ✅ ML Service: http://localhost:8000/api/ml/health
- ✅ Nginx (if using Docker): http://localhost

You should see JSON responses from the health endpoints!

## Next Steps

### Deploy Smart Contracts

```bash
cd packages/contracts
npm install
npx hardhat compile

# Start local node
npx hardhat node

# In another terminal, deploy
npm run deploy

# Copy the contract addresses to your .env file
```

### Create Database Tables

Go to your Supabase dashboard and run this SQL:

```sql
CREATE TABLE loans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  borrower_address TEXT NOT NULL,
  lender_address TEXT,
  collateral_amount NUMERIC NOT NULL,
  loan_amount NUMERIC NOT NULL,
  interest_rate INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE lender_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lender_address TEXT NOT NULL,
  max_amount NUMERIC NOT NULL,
  min_credit_score INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Test the API

```bash
# Health check
curl http://localhost:3001/api/v1/health

# Get credit score (will use mock data initially)
curl -X POST http://localhost:8000/api/ml/credit-score \
  -H "Content-Type: application/json" \
  -d '{"wallet_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"}'
```

## Troubleshooting

### Port Already in Use

```bash
# Kill process on port 3001
lsof -ti:3001 | xargs kill -9

# Or use different ports in .env
CORE_API_PORT=3002
```

### Docker Issues

```bash
# Reset Docker completely
npm run docker:down
docker system prune -a
npm run docker:up
```

### Python Dependencies Failed

```bash
# Update pip first
pip install --upgrade pip setuptools wheel

# Then retry
pip install -r requirements.txt
```

### "Module not found" Errors

```bash
# Reinstall all dependencies
npm run clean
npm install
npm install --workspaces
```

## Development Workflow

### Making Changes

1. **Backend (Core API):**
   - Edit files in `services/core-api/src/`
   - Hot reload is automatic
2. **Frontend:**
   - Edit files in `services/client/src/`
   - Hot reload is automatic

3. **ML Service:**
   - Edit files in `services/credit-score/`
   - Restart with `Ctrl+C` and `python main.py`

4. **Smart Contracts:**
   - Edit files in `packages/contracts/contracts/`
   - Recompile: `npx hardhat compile`
   - Redeploy: `npm run deploy`

### Testing Changes

```bash
# Test API endpoint
curl http://localhost:3001/api/v1/loans

# Test ML endpoint
curl -X POST http://localhost:8000/api/ml/credit-score \
  -H "Content-Type: application/json" \
  -d '{"wallet_address": "0x..."}'

# Test contracts
cd packages/contracts
npx hardhat test
```

### Committing Changes

```bash
# Format code
npm run format

# Lint code
npm run lint

# Run tests
npm run test

# Commit
git add .
git commit -m "feat: your feature description"
git push
```

## Getting Help

- **Documentation:** Check README.md, SETUP.md, and CLI-COMMANDS.md
- **Logs:** `npm run docker:logs` or `docker logs vouch-core-api`
- **Issues:** Open a GitHub issue
- **Architecture:** See README.md for system architecture

## Common Tasks

### Add a New API Endpoint

1. Create route file: `services/core-api/src/routes/myRoute.ts`
2. Register in `services/core-api/src/index.ts`
3. Test with curl or Postman

### Add a New ML Feature

1. Edit `services/credit-score/services/credit_scoring.py`
2. Update feature extraction logic
3. Restart ML service

### Add a New Smart Contract

1. Create contract: `packages/contracts/contracts/MyContract.sol`
2. Add tests: `packages/contracts/test/MyContract.test.ts`
3. Update deploy script: `packages/contracts/scripts/deploy.ts`

### Update Dependencies

```bash
# Check for updates
npm outdated

# Update all
npm update --workspaces

# Or update specific package
npm update package-name --workspace services/core-api
```

## Performance Tips

- **Use Docker** for consistent environment
- **Enable caching** in TurboRepo (automatic)
- **Run tests in parallel** with `--parallel` flag
- **Use `--filter` flag** to build specific packages

## What's Next?

Now that you have Vouch running:

1. ✅ Explore the API endpoints
2. ✅ Create a simple loan request
3. ✅ Test credit score calculation
4. ✅ Build frontend UI components
5. ✅ Deploy contracts to testnet
6. ✅ Train ML model with real data

**Ready to build!** 🚀

For detailed information, see the full documentation:

- [README.md](README.md) - Complete overview
- [SETUP.md](SETUP.md) - Detailed setup guide
- [CLI-COMMANDS.md](CLI-COMMANDS.md) - All available commands
