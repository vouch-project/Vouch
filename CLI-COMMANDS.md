# CLI Commands Reference

This document contains all CLI commands needed to set up and run the Vouch platform.

## Initial Setup

### 1. Project Initialization

```bash
# Navigate to project directory
cd /Users/nirarad/Computer\ Science/vouch

# Copy environment template
cp .env.example .env

# Edit environment variables (use your preferred editor)
nano .env
# or
code .env
```

### 2. Generate SvelteKit Frontend

```bash
# Generate SvelteKit app (MUST be run from project root)
npm create svelte@latest services/client
```

**Interactive Prompts:**

```
┌  Welcome to SvelteKit!
│
◇  Which Svelte app template?
│  Skeleton project
│
◇  Add type checking with TypeScript?
│  Yes, using TypeScript syntax
│
◇  Select additional options
│  Add ESLint for code linting
│  Add Prettier for code formatting
│
└  Your project is ready!
```

### 3. Install Frontend Dependencies

```bash
# Navigate to frontend
cd services/client

# Install base dependencies
npm install

# Install TailwindCSS
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# Install WalletConnect and Ethers
npm install @web3modal/ethereum @web3modal/html ethers

# Return to root
cd ../..
```

### 4. Install All Project Dependencies

```bash
# From project root - install root dependencies
npm install

# Install dependencies for all workspaces
npm install --workspaces
```

## Development Commands

### Start All Services (TurboRepo)

```bash
# Start all services in development mode
npm run dev

# Build all services
npm run build

# Run tests across all services
npm run test

# Lint all code
npm run lint

# Format all code
npm run format

# Clean all build artifacts
npm run clean
```

### Docker Commands

```bash
# Start all services with Docker
npm run docker:up

# Start in background
docker-compose up -d

# View logs (all services)
npm run docker:logs

# View logs (specific service)
docker-compose logs -f core-api
docker-compose logs -f credit-score-api
docker-compose logs -f liquidation-bot

# Stop all services
npm run docker:down

# Rebuild and restart
npm run docker:rebuild

# Remove all containers and volumes
docker-compose down -v
```

### Individual Service Commands

#### Core API (Node.js)

```bash
cd services/core-api

# Development (with hot reload)
npm run dev

# Build TypeScript
npm run build

# Production start
npm run start

# Run tests
npm run test

# Lint
npm run lint

# Clean build files
npm run clean
```

#### Frontend (SvelteKit)

```bash
cd services/client

# Development server
npm run dev

# Development with specific host/port
npm run dev -- --host 0.0.0.0 --port 5173

# Build for production
npm run build

# Preview production build
npm run preview

# Run tests
npm run test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint

# Format
npm run format
```

#### ML Credit Score Service (Python)

```bash
cd services/credit-score

# Create virtual environment
python -m venv venv

# Activate virtual environment (macOS/Linux)
source venv/bin/activate

# Activate virtual environment (Windows)
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run FastAPI server (development with reload)
uvicorn main:app --reload

# Run on specific host/port
uvicorn main:app --host 0.0.0.0 --port 8000

# Run in production mode
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4

# Deactivate virtual environment
deactivate
```

#### Liquidation Bot (Python)

```bash
cd services/liquidation-bot

# Create virtual environment
python -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run bot
python main.py

# Run with specific check interval
CHECK_INTERVAL_SECONDS=30 python main.py
```

#### Smart Contracts (Hardhat)

```bash
cd packages/contracts

# Install dependencies
npm install

# Compile contracts
npm run compile
# or
npx hardhat compile

# Run tests
npm run test
# or
npx hardhat test

# Run specific test file
npx hardhat test test/LendingPool.test.ts

# Test with gas reporting
REPORT_GAS=true npx hardhat test

# Start local Hardhat node
npx hardhat node

# Deploy to local network (in another terminal)
npm run deploy
# or
npx hardhat run scripts/deploy.ts --network localhost

# Deploy to Sepolia testnet
npm run deploy:sepolia
# or
npx hardhat run scripts/deploy.ts --network sepolia

# Verify contract on Etherscan
npm run verify -- --network sepolia DEPLOYED_CONTRACT_ADDRESS
# or
npx hardhat verify --network sepolia DEPLOYED_CONTRACT_ADDRESS

# Open Hardhat console
npx hardhat console --network localhost

# Clean artifacts and cache
npm run clean
# or
npx hardhat clean
```

## Testing Commands

### Unit Tests

```bash
# Test Core API
cd services/core-api
npm test

# Test with coverage
npm test -- --coverage

# Test in watch mode
npm test -- --watch

# Test Smart Contracts
cd packages/contracts
npx hardhat test

# Test with gas report
REPORT_GAS=true npx hardhat test
```

### Integration Tests

```bash
# Start all services
npm run docker:up

# Wait for services to be ready
sleep 10

# Run integration tests (when implemented)
npm run test:integration

# Stop services
npm run docker:down
```

## Database Commands (Supabase CLI)

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Initialize Supabase in project
supabase init

# Start local Supabase
supabase start

# Stop local Supabase
supabase stop

# Run migrations
supabase db push

# Generate TypeScript types
supabase gen types typescript --project-id YOUR_PROJECT_ID > types/supabase.ts
```

## Blockchain Interaction Commands

### Using Hardhat

```bash
cd packages/contracts

# Get account balance
npx hardhat run --network sepolia scripts/getBalance.ts

# Call contract function
npx hardhat run --network sepolia scripts/interact.ts

# Deploy and verify
npx hardhat run scripts/deploy.ts --network sepolia
npx hardhat verify --network sepolia DEPLOYED_ADDRESS
```

### Using Cast (Foundry)

```bash
# Install Foundry (if needed)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Get block number
cast block-number --rpc-url $RPC_URL_MAINNET

# Get contract code
cast code CONTRACT_ADDRESS --rpc-url $RPC_URL_MAINNET

# Call view function
cast call CONTRACT_ADDRESS "getActiveLoanIds()" --rpc-url $RPC_URL_MAINNET

# Send transaction
cast send CONTRACT_ADDRESS "createLoanRequest(...)" --rpc-url $RPC_URL_SEPOLIA --private-key $PRIVATE_KEY
```

## Production Deployment Commands

### Build for Production

```bash
# Build all services
npm run build

# Build Core API
cd services/core-api
npm run build

# Build Frontend
cd services/client
npm run build

# Build Smart Contracts
cd packages/contracts
npm run compile
```

### Docker Production Build

```bash
# Build production images
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build

# Push to registry
docker tag vouch-core-api:latest your-registry/vouch-core-api:latest
docker push your-registry/vouch-core-api:latest

# Deploy to production
docker-compose -f docker-compose.prod.yml up -d
```

## Maintenance Commands

### Update Dependencies

```bash
# Check for outdated packages (root)
npm outdated

# Update all dependencies
npm update

# Update specific package
npm update package-name

# Update all workspaces
npm update --workspaces

# Python dependencies
cd services/credit-score
pip list --outdated
pip install --upgrade package-name
```

### Clean and Reset

```bash
# Clean all build artifacts
npm run clean

# Remove all node_modules
find . -name "node_modules" -type d -prune -exec rm -rf '{}' +

# Remove Python virtual environments
find . -name "venv" -type d -prune -exec rm -rf '{}' +

# Remove Docker volumes
docker-compose down -v

# Full reset
npm run clean
rm -rf node_modules
npm install
```

### Git Commands

```bash
# Clone repository
git clone https://github.com/yourusername/vouch.git
cd vouch

# Create feature branch
git checkout -b feature/your-feature-name

# Stage changes
git add .

# Commit changes
git commit -m "feat: your feature description"

# Push to remote
git push origin feature/your-feature-name

# Create pull request (use GitHub CLI)
gh pr create
```

## Monitoring Commands

### View Logs

```bash
# Core API logs (Docker)
docker logs vouch-core-api -f --tail 100

# ML Service logs
docker logs vouch-credit-score -f --tail 100

# Liquidation Bot logs
docker logs vouch-liquidation-bot -f --tail 100

# All services
docker-compose logs -f

# Nginx logs
docker exec vouch-nginx tail -f /var/log/nginx/access.log
docker exec vouch-nginx tail -f /var/log/nginx/error.log
```

### Health Checks

```bash
# Check Core API health
curl http://localhost:3001/api/v1/health

# Check ML Service health
curl http://localhost:8000/api/ml/health

# Check Nginx
curl http://localhost/health

# Check all services
curl http://localhost:3001/api/v1/health && \
curl http://localhost:8000/api/ml/health && \
echo "All services healthy"
```

### Performance Monitoring

```bash
# Docker container stats
docker stats

# Check specific container
docker stats vouch-core-api

# Check disk usage
docker system df

# Check network
docker network ls
docker network inspect vouch_vouch-network
```

## Utility Commands

### Generate TypeScript Types from Contracts

```bash
cd packages/contracts
npx hardhat compile
npx hardhat typechain
```

### Format Code

```bash
# Format all JavaScript/TypeScript
npm run format

# Format specific directory
npx prettier --write "services/core-api/src/**/*.ts"

# Format Python code (if black is installed)
cd services/credit-score
black .
```

### Database Seed Data

```bash
# Run seed script (when implemented)
cd services/core-api
npm run seed

# Or use Supabase CLI
supabase db seed
```

## Quick Reference

### Most Common Commands

```bash
# Start everything
npm install
cp .env.example .env
npm create svelte@latest services/client
cd services/client && npm install && cd ../..
npm run docker:up

# Daily development
npm run dev                    # All services
cd services/client && npm run dev  # Just frontend

# Deploy contracts
cd packages/contracts
npm run deploy:sepolia

# View logs
npm run docker:logs

# Stop everything
npm run docker:down
```

---

**Pro Tip:** Create aliases in your shell profile for frequently used commands:

```bash
# Add to ~/.zshrc or ~/.bashrc
alias vouch-dev="cd ~/Computer\ Science/vouch && npm run dev"
alias vouch-docker="cd ~/Computer\ Science/vouch && npm run docker:up"
alias vouch-logs="cd ~/Computer\ Science/vouch && npm run docker:logs"
```
