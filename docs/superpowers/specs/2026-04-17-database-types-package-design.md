# Shared Database Types Package Design

**Date:** 2026-04-17  
**Status:** Approved  
**Context:** Fix type safety issues and eliminate duplication between frontend and backend database types

## Problem Statement

The current codebase has database type definitions split between frontend and backend:

- Backend: `apps/api/src/supabase/database-generated.types.ts` (auto-generated) with manual overrides in `database.types.ts`
- Frontend: Recently created `apps/web/src/lib/types/` with manually maintained types

**Issues:**
1. Type duplication and drift risk between frontend/backend
2. uint256 (PostgreSQL numeric) fields incorrectly typed as `number` by Supabase generator, but PostgREST returns them as `string` to prevent precision loss
3. Manual synchronization required when schema changes
4. Frontend types created during PR #43 review don't match backend's corrected types

## Solution: Dedicated `packages/database-types` Package

Create a shared package that both apps consume, following production patterns from Supabase community (supasample, webapp-template repos).

### Rationale

**Why dedicated package vs. exporting from API:**
- Both developers work full-stack across entire codebase
- Neutral location - no ownership hierarchy
- Clean separation - types are a first-class concern
- Can export utilities alongside raw types

## Architecture

### Package Structure

```
packages/database-types/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts             # Main exports
│   ├── generated.ts         # Raw Supabase generated types (git-committed)
│   ├── database.ts          # Corrected Database type (MergeDeep overrides)
│   ├── address.ts           # Address branded type (moved from API)
│   └── helpers.ts           # Optional type utilities (e.g., LoanWithTokens)
└── dist/                    # Build output (git-ignored)
```

### Type Correction Strategy

**Problem:** Supabase generator types uint256 (Postgres `numeric`) columns as `number`, but they're returned as `string` by PostgREST.

**Solution:** Manual MergeDeep overrides in `src/database.ts`
- Override uint256 fields from `number` to `string` 
- Override custom branded types (UUID, Address)
- **CRITICAL:** When adding new uint256 columns to the database schema, developers MUST manually add them to the MergeDeep overrides in `database.ts`. This is intentional - it's explicit, type-safe, and prevents incorrect automated transformations.

### Key Design Decisions

1. **Build step required**: Package compiles to `dist/` for proper module boundaries and performance
2. **Commit generated types**: `src/generated.ts` is committed to git for CI/CD and developer onboarding
3. **Re-use Supabase helpers**: Export generated `Tables<T>`, `TablesInsert<T>`, `TablesUpdate<T>`, `Enums<T>` types
4. **Manual uint256 overrides**: Developers must explicitly add new uint256 fields to MergeDeep overrides - this is intentional for type safety

## Implementation Details

### Package Configuration

**`packages/database-types/package.json`:**
```json
{
  "name": "@vouch/database-types",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./helpers": {
      "types": "./dist/helpers.d.ts",
      "default": "./dist/helpers.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "type-fest": "^5.5.0",
    "ethers": "^6.16.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

**`packages/database-types/tsconfig.json`:**
```json
{
  "extends": "@vouch/config/typescript",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "composite": true
  },
  "include": ["src/**/*"]
}
```

### Type Overrides Implementation

**`packages/database-types/src/database.ts`:**
```typescript
import type { UUID } from 'crypto';
import { MergeDeep } from 'type-fest';
import { Address } from './address';
import { Database as DatabaseGenerated } from './generated';

export type Database = MergeDeep<
  DatabaseGenerated,
  {
    public: {
      Tables: {
        chains: {
          Row: { id: UUID; contractAddress: Address };
          Insert: { id?: UUID; contractAddress: Address };
          Update: { id?: UUID; contractAddress?: Address };
        };
        tokens: {
          Row: { id: UUID; chainId: UUID; address: Address };
          Insert: { id?: UUID; chainId: UUID; address: Address };
          Update: { id?: UUID; chainId?: UUID; address?: Address };
        };
        loans: {
          Row: {
            id: UUID;
            chainId: UUID;
            borrowerAddress: Address;
            lenderAddress: Address | null;
            // uint256 fields - PostgREST returns as string
            onChainLoanId: string | null;
            collateralAmount: string | null;
            principalAmount: string | null;
            interestRate: string | null;
          };
          Insert: {
            id?: UUID;
            chainId: UUID;
            borrowerAddress: Address;
            lenderAddress?: Address | null;
            onChainLoanId?: string | null;
            collateralAmount?: string | null;
            principalAmount?: string | null;
            interestRate?: string | null;
          };
          Update: {
            id?: UUID;
            chainId?: UUID;
            borrowerAddress?: Address;
            lenderAddress?: Address | null;
            onChainLoanId?: string | null;
            collateralAmount?: string | null;
            principalAmount?: string | null;
            interestRate?: string | null;
          };
        };
        transactions: {
          Row: {
            id: UUID;
            chainId: UUID;
            loanId: UUID;
            tokenId: UUID;
            fromAddress: Address;
            toAddress: Address;
            // uint256 fields - PostgREST returns as string
            amount: string | null;
            blockNumber: string | null;
            logIndex: string;
          };
          Insert: {
            id?: UUID;
            chainId: UUID;
            loanId: UUID;
            tokenId: UUID;
            txTimestamp: Date;
            fromAddress: Address;
            toAddress: Address;
            amount?: string | null;
            blockNumber?: string | null;
            logIndex: string;
          };
          Update: {
            id?: UUID;
            chainId?: UUID;
            loanId?: UUID;
            tokenId?: UUID;
            txTimestamp?: Date;
            fromAddress?: Address;
            toAddress?: Address;
            amount?: string | null;
            blockNumber?: string | null;
            logIndex?: string;
          };
        };
      };
      Functions: {
        create_loan_with_transaction: {
          Args: {
            p_borrower_address: Address;
            p_collateral_amount: string;
            p_collateral_block_number: string;
            p_collateral_token_address: Address;
            p_contract_address: Address;
            p_log_index: number;
            p_on_chain_loan_id: string;
          };
          Returns: string;
        };
      };
    };
  }
>;
```

**IMPORTANT:** When adding new tables or uint256 columns, developers must update this file to add the appropriate overrides.

### Exports

**`packages/database-types/src/index.ts`:**
```typescript
// Main corrected type
export type { Database } from './database';

// Address branded type and utilities
export type { Address } from './address';
export { validAddress, isAddress, asAddress } from './address';

// Re-export Supabase's helper types
export type { Tables, TablesInsert, TablesUpdate, Enums } from './generated';
```

**`packages/database-types/src/helpers.ts`:**
```typescript
import type { Tables } from './generated';

// Extended types for frontend queries with joins
export type LoanWithTokens = Tables<'loans'> & {
  collateralToken?: Tables<'tokens'> | null;
  principalToken?: Tables<'tokens'> | null;
};
```

### Migration Plan

#### Files to Move

**From `apps/api/src/supabase/`:**
- `address.ts` → `packages/database-types/src/address.ts` (no changes)
- `database-generated.types.ts` → `packages/database-types/src/generated.ts` (initial copy, then regenerated)
- `database.types.ts` → `packages/database-types/src/database.ts` (update imports)

#### Backend Files to Update (5 files)

**Import changes:**

1. `apps/api/src/supabase/supabase.service.ts`
   - Change: `from './database.types'` → `from '@vouch/database-types'`
   
2. `apps/api/src/tokens/tokens.service.ts`
   - Change: `from '../supabase/address'` → `from '@vouch/database-types'`
   - Change: `from '../supabase/database.types'` → `from '@vouch/database-types'`
   - Update: `Database['public']['Tables']['tokens']['Row']` → `Tables<'tokens'>`
   
3. `apps/api/src/loans/loans.service.ts`
   - Change: `from '../supabase/address'` → `from '@vouch/database-types'`
   
4. `apps/api/src/blockchain-listener/blockchain-listener.service.ts`
   - Change: `from '../supabase/database.types'` → `from '@vouch/database-types'`

5. `apps/api/package.json`
   - Add: `"@vouch/database-types": "workspace:*"` to dependencies

#### Backend Files to Delete (3 files)

- `apps/api/src/supabase/address.ts`
- `apps/api/src/supabase/database.types.ts`
- `apps/api/src/supabase/database-generated.types.ts`

#### Frontend Files to Update/Delete

**Delete (created in PR #43, now superseded):**
- `apps/web/src/lib/types/loan.ts`
- `apps/web/src/lib/types/token.ts`

**Update:**

1. `apps/web/src/lib/types/index.ts`
   ```typescript
   // Re-export database types
   export type { Database, Tables, Enums } from '@vouch/database-types';
   export type { LoanWithTokens } from '@vouch/database-types/helpers';
   
   // Keep web-specific types
   export type UUID = `${string}-${string}-${string}-${string}-${string}`;
   ```

2. `apps/web/src/lib/supabase.ts`
   ```typescript
   import type { Database } from '@vouch/database-types';
   
   export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
     // ... config
   });
   ```

3. `apps/web/src/routes/marketplace/+page.svelte`
   - Change: `import type { LoanWithTokens } from '$lib/types';`
   - Type already correct (uses `LoanWithTokens` from types/index.ts)

4. `apps/web/package.json`
   - Add: `"@vouch/database-types": "workspace:*"` to dependencies

#### Root Configuration Updates

**Update `package.json` script:**
```json
{
  "scripts": {
    "db:generate:types": "supabase gen types typescript --local > packages/database-types/src/generated.ts && cd packages/database-types && pnpm build"
  }
}
```

**Update `turbo.json`:**
```json
{
  "tasks": {
    "@vouch/database-types#build": {
      "outputs": ["dist/**"]
    },
    "@vouch/api#build": {
      "dependsOn": ["@vouch/database-types#build"],
      "outputs": ["dist/**"]
    },
    "@vouch/web#build": {
      "dependsOn": ["@vouch/database-types#build"],
      "outputs": [".svelte-kit/**"]
    }
  }
}
```

**Rationale:** Both `apps/api` and `apps/web` depend on the database-types package, so they must build after it. This ensures type definitions are compiled before consuming applications try to import them.

## Workflow

### Type Generation Workflow

```bash
# After database migration
pnpm db:generate:types
```

This command:
1. Runs Supabase type generator
2. Writes raw types to `packages/database-types/src/generated.ts`
3. Builds the package (compiles to `dist/`)

**Note:** Both apps will pick up new types on next build/dev.

### Developer Workflow

**When schema changes:**
1. Apply migration: `pnpm db:reset` or specific migration
2. Regenerate types: `pnpm db:generate:types`
3. **CRITICAL:** If you added new uint256 columns, manually update `packages/database-types/src/database.ts` to override them from `number` to `string`
4. Commit changes: 
   ```bash
   git add packages/database-types/src/generated.ts
   git add packages/database-types/src/database.ts  # if modified
   ```
5. Apps automatically get new types

**No Supabase running:**
- Committed types in git allow CI/CD to work
- Developers can build without Supabase (uses committed types)

## Error Handling & Edge Cases

### Potential Issues

1. **Supabase not running during generation:**
   - Script fails with clear error
   - Developer must run `npx supabase start` first

2. **Type generation in CI/CD:**
   - Committed types ensure CI works without Supabase
   - If types are stale, CI uses committed version (still valid)

3. **Breaking schema changes:**
   - TypeScript catches issues at compile time in both apps
   - Desired behavior - forces addressing breaking changes

4. **Forgetting to override new uint256 fields:**
   - TypeScript will compile successfully but runtime values will be strings
   - Can cause bugs if code expects numbers
   - **Mitigation:** Code review checklist, runtime assertions with ethers.js

5. **Package dependency resolution:**
   - pnpm workspace protocol handles automatically
   - `"workspace:*"` resolves to local package

### Verification Steps

After migration:
```bash
# 1. Type generation works
pnpm db:generate:types

# 2. Package builds successfully
cd packages/database-types && pnpm build

# 3. API builds and types resolve correctly
cd ../../apps/api && pnpm build

# 4. Web builds and types resolve correctly
cd ../web && pnpm build

# 5. Dev mode works for both
cd ../.. && pnpm dev
```

## Benefits

1. **Single source of truth** - database types defined once
2. **Type safety** - uint256 fields correctly typed as `string`
3. **Automatic updates** - both apps get schema changes immediately
4. **No duplication** - eliminates manual type maintenance
5. **Standard pattern** - follows production Supabase + Turborepo examples
6. **Proper isolation** - clean package boundaries

## Future Considerations

- Add more helper types in `helpers.ts` as patterns emerge (e.g., `ChainRow`, `TransactionRow`)
- Consider adding runtime validation utilities using ethers.js to catch uint256 type mismatches
- Add code review checklist item: "If migration adds uint256 columns, update database.ts overrides"
