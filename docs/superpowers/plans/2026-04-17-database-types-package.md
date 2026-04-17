# Database Types Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create shared `@vouch/database-types` package to eliminate type duplication between frontend and backend

**Architecture:** New Turborepo package exports Supabase-generated types with MergeDeep overrides for uint256 fields (string) and custom branded types (UUID, Address). Both apps consume from this single source of truth.

**Tech Stack:** TypeScript, type-fest, ethers (for Address validation), Turborepo

---

## Task 1: Create Package Structure and Configuration

**Files:**
- Create: `packages/database-types/package.json`
- Create: `packages/database-types/tsconfig.json`
- Create: `packages/database-types/src/index.ts`
- Create: `packages/database-types/src/helpers.ts`
- Create: `packages/database-types/.gitignore`

- [ ] **Step 1: Create package directory**

```bash
mkdir -p packages/database-types/src
```

- [ ] **Step 2: Create package.json**

Create `packages/database-types/package.json`:

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

- [ ] **Step 3: Create tsconfig.json**

Create `packages/database-types/tsconfig.json`:

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

- [ ] **Step 4: Create .gitignore**

Create `packages/database-types/.gitignore`:

```
dist/
node_modules/
*.tsbuildinfo
```

- [ ] **Step 5: Create placeholder index.ts**

Create `packages/database-types/src/index.ts`:

```typescript
// Placeholder - will be populated after moving source files
export type { Database } from './database';
export type { Address } from './address';
export { validAddress, isAddress, asAddress } from './address';
export type { Tables, TablesInsert, TablesUpdate, Enums } from './generated';
```

- [ ] **Step 6: Create helpers.ts**

Create `packages/database-types/src/helpers.ts`:

```typescript
import type { Tables } from './generated';

/**
 * Extended Loan type with joined token data
 * Used in frontend queries that join loans with tokens
 */
export type LoanWithTokens = Tables<'loans'> & {
  collateralToken?: Tables<'tokens'> | null;
  principalToken?: Tables<'tokens'> | null;
};
```

- [ ] **Step 7: Install dependencies**

```bash
cd packages/database-types
pnpm install
cd ../..
```

Expected: Dependencies installed successfully

- [ ] **Step 8: Commit package structure**

```bash
git add packages/database-types/
git commit -m "feat(database-types): create package structure and configuration

Add new @vouch/database-types package with TypeScript build setup.
Placeholder exports will be populated when source files are moved.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Move Source Files from Backend

**Files:**
- Create: `packages/database-types/src/address.ts` (from `apps/api/src/supabase/address.ts`)
- Create: `packages/database-types/src/generated.ts` (from `apps/api/src/supabase/database-generated.types.ts`)
- Create: `packages/database-types/src/database.ts` (from `apps/api/src/supabase/database.types.ts`)

- [ ] **Step 1: Copy address.ts**

```bash
cp apps/api/src/supabase/address.ts packages/database-types/src/address.ts
```

- [ ] **Step 2: Copy database-generated.types.ts as generated.ts**

```bash
cp apps/api/src/supabase/database-generated.types.ts packages/database-types/src/generated.ts
```

- [ ] **Step 3: Copy database.types.ts as database.ts**

```bash
cp apps/api/src/supabase/database.types.ts packages/database-types/src/database.ts
```

- [ ] **Step 4: Update imports in database.ts**

Modify `packages/database-types/src/database.ts`:

Find:
```typescript
import type { UUID } from 'crypto';
import { MergeDeep } from 'type-fest';
import { Address } from './address';
import { Database as DatabaseGenerated } from './database-generated.types';
```

Replace with:
```typescript
import type { UUID } from 'crypto';
import { MergeDeep } from 'type-fest';
import { Address } from './address';
import { Database as DatabaseGenerated } from './generated';
```

- [ ] **Step 5: Verify index.ts exports are correct**

Read `packages/database-types/src/index.ts` - should already have correct exports from Task 1.

- [ ] **Step 6: Commit source files**

```bash
git add packages/database-types/src/
git commit -m "feat(database-types): move source files from API

Move address.ts, database types, and generated types from apps/api
to shared package. Update imports to use new file names.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Build Package and Verify

**Files:**
- Build: `packages/database-types/dist/*` (generated)

- [ ] **Step 1: Build the package**

```bash
cd packages/database-types
pnpm build
```

Expected: TypeScript compiles successfully, creates `dist/` directory

- [ ] **Step 2: Verify build output exists**

```bash
ls -la dist/
```

Expected: Should see `index.js`, `index.d.ts`, `database.js`, `database.d.ts`, `address.js`, `address.d.ts`, `generated.js`, `generated.d.ts`, `helpers.js`, `helpers.d.ts`

- [ ] **Step 3: Verify type exports**

```bash
cat dist/index.d.ts
```

Expected: Should contain type exports for Database, Address, Tables, etc.

- [ ] **Step 4: Return to root**

```bash
cd ../..
```

- [ ] **Step 5: Commit (if any generated files need tracking)**

No commit needed - dist/ is gitignored

---

## Task 4: Update Backend Dependencies and Imports

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/supabase/supabase.service.ts`
- Modify: `apps/api/src/tokens/tokens.service.ts`
- Modify: `apps/api/src/loans/loans.service.ts`
- Modify: `apps/api/src/blockchain-listener/blockchain-listener.service.ts`

- [ ] **Step 1: Add package dependency to API**

Modify `apps/api/package.json`, in the `dependencies` section add:

```json
"@vouch/database-types": "workspace:*",
```

(Add it alphabetically after `@nestjs-modules/ioredis`)

- [ ] **Step 2: Install dependencies**

```bash
cd apps/api
pnpm install
cd ../..
```

Expected: Workspace link created successfully

- [ ] **Step 3: Update supabase.service.ts imports**

Modify `apps/api/src/supabase/supabase.service.ts`:

Find:
```typescript
import { Database } from './database.types';
```

Replace with:
```typescript
import { Database } from '@vouch/database-types';
```

- [ ] **Step 4: Update tokens.service.ts imports**

Modify `apps/api/src/tokens/tokens.service.ts`:

Find:
```typescript
import { validAddress } from '../supabase/address';
import { Database } from '../supabase/database.types';
```

Replace with:
```typescript
import { validAddress, Tables } from '@vouch/database-types';
```

Then find:
```typescript
export type Token = Database['public']['Tables']['tokens']['Row'];
```

Replace with:
```typescript
export type Token = Tables<'tokens'>;
```

- [ ] **Step 5: Update loans.service.ts imports**

Modify `apps/api/src/loans/loans.service.ts`:

Find:
```typescript
import { asAddress } from '../supabase/address';
```

Replace with:
```typescript
import { asAddress } from '@vouch/database-types';
```

- [ ] **Step 6: Update blockchain-listener.service.ts imports**

Modify `apps/api/src/blockchain-listener/blockchain-listener.service.ts`:

Find:
```typescript
import { Database } from '../supabase/database.types';
```

Replace with:
```typescript
import { Database } from '@vouch/database-types';
```

- [ ] **Step 7: Verify backend compiles**

```bash
cd apps/api
pnpm build
```

Expected: Build succeeds with no type errors

- [ ] **Step 8: Return to root and commit**

```bash
cd ../..
git add apps/api/package.json apps/api/src/
git commit -m "refactor(api): use shared database-types package

Replace local type definitions with imports from @vouch/database-types.
Update tokens.service.ts to use Tables<'tokens'> helper.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Update Frontend Dependencies and Imports

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/lib/types/index.ts`
- Delete: `apps/web/src/lib/types/loan.ts`
- Delete: `apps/web/src/lib/types/token.ts`
- Modify: `apps/web/src/lib/supabase.ts`

- [ ] **Step 1: Add package dependency to web**

Modify `apps/web/package.json`, in the `dependencies` section add:

```json
"@vouch/database-types": "workspace:*",
```

(Add it alphabetically before `@reown/appkit`)

- [ ] **Step 2: Install dependencies**

```bash
cd apps/web
pnpm install
cd ../..
```

Expected: Workspace link created successfully

- [ ] **Step 3: Delete frontend-specific type files**

```bash
rm apps/web/src/lib/types/loan.ts
rm apps/web/src/lib/types/token.ts
```

- [ ] **Step 4: Update types/index.ts**

Replace contents of `apps/web/src/lib/types/index.ts`:

```typescript
// Re-export database types from shared package
export type { Database, Tables, Enums } from '@vouch/database-types';
export type { LoanWithTokens } from '@vouch/database-types/helpers';

// Web-specific types
export type UUID = `${string}-${string}-${string}-${string}-${string}`;
```

- [ ] **Step 5: Update lib/supabase.ts to use Database type**

Modify `apps/web/src/lib/supabase.ts`:

Find:
```typescript
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '$lib/env';
import { createClient } from '@supabase/supabase-js';
import { JWT_STORAGE_KEY } from '../constants';
```

Replace with:
```typescript
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '$lib/env';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@vouch/database-types';
import { JWT_STORAGE_KEY } from '../constants';
```

Then find:
```typescript
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
```

Replace with:
```typescript
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
```

- [ ] **Step 6: Verify marketplace page still imports correctly**

Read `apps/web/src/routes/marketplace/+page.svelte` and verify it has:
```typescript
import type { LoanWithTokens } from '$lib/types';
```

This should now resolve through the updated `types/index.ts`.

- [ ] **Step 7: Verify web builds**

```bash
cd apps/web
pnpm build
```

Expected: Build succeeds with no type errors

- [ ] **Step 8: Return to root and commit**

```bash
cd ../..
git add apps/web/package.json apps/web/src/
git commit -m "refactor(web): use shared database-types package

Replace local type definitions with imports from @vouch/database-types.
Delete duplicate loan.ts and token.ts files.
Add Database generic to Supabase client for type safety.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Clean Up Old Backend Files

**Files:**
- Delete: `apps/api/src/supabase/address.ts`
- Delete: `apps/api/src/supabase/database.types.ts`
- Delete: `apps/api/src/supabase/database-generated.types.ts`

- [ ] **Step 1: Delete old type files**

```bash
rm apps/api/src/supabase/address.ts
rm apps/api/src/supabase/database.types.ts
rm apps/api/src/supabase/database-generated.types.ts
```

- [ ] **Step 2: Verify backend still builds**

```bash
cd apps/api
pnpm build
```

Expected: Build succeeds - confirms no lingering imports of deleted files

- [ ] **Step 3: Return to root and commit**

```bash
cd ../..
git add apps/api/src/supabase/
git commit -m "refactor(api): remove old type files moved to shared package

Delete address.ts, database.types.ts, and database-generated.types.ts
from API supabase directory. These now live in @vouch/database-types.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Update Root Configuration

**Files:**
- Modify: `package.json` (root)
- Modify: `turbo.json`

- [ ] **Step 1: Update type generation script**

Modify root `package.json`:

Find:
```json
"db:generate:types": "supabase gen types typescript --local > apps/api/src/supabase/database-generated.types.ts"
```

Replace with:
```json
"db:generate:types": "supabase gen types typescript --local > packages/database-types/src/generated.ts && cd packages/database-types && pnpm build"
```

- [ ] **Step 2: Update turbo.json build dependencies**

Modify `turbo.json`:

Find the `"tasks"` section and add/update these entries:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".svelte-kit/**", "build/**", "artifacts/**"]
    },
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
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "@vouch/api#dev": {
      "dependsOn": ["supabase#setup"],
      "persistent": true,
      "cache": false
    },
    "@vouch/web#dev": {
      "dependsOn": ["supabase#setup"],
      "persistent": true,
      "cache": false
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "setup": {
      "cache": false
    }
  }
}
```

- [ ] **Step 3: Verify turbo caching works**

```bash
pnpm build
```

Expected: Builds database-types first, then API and web in parallel

- [ ] **Step 4: Commit configuration changes**

```bash
git add package.json turbo.json
git commit -m "chore: update root config for database-types package

Update db:generate:types script to output to shared package.
Add Turborepo build dependencies: API and web depend on database-types.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Final Verification and Documentation

**Files:**
- Test: All builds and dev mode
- Verify: Type generation workflow

- [ ] **Step 1: Clean build verification**

```bash
# Clean all builds
rm -rf apps/api/dist apps/web/.svelte-kit packages/database-types/dist

# Rebuild everything
pnpm build
```

Expected: All packages build successfully in correct order

- [ ] **Step 2: Test type generation workflow**

```bash
# Ensure Supabase is running
npx supabase status
```

Expected: Supabase is running (if not, run `npx supabase start`)

```bash
# Regenerate types
pnpm db:generate:types
```

Expected: 
- Types written to `packages/database-types/src/generated.ts`
- Package builds automatically
- No errors

- [ ] **Step 3: Verify git status**

```bash
git status
```

Expected: `packages/database-types/src/generated.ts` shows as modified (if schema changed) or clean working tree

- [ ] **Step 4: Test dev mode**

```bash
# Start dev mode (will start Redis, Supabase, web, and API)
pnpm dev
```

Expected: All services start successfully, no type errors in logs

Stop with Ctrl+C after verification.

- [ ] **Step 5: Verify marketplace page rendering**

While `pnpm dev` is running:
1. Open http://localhost:5173/marketplace
2. Check browser console for errors
3. Verify loans table renders (even if empty)

Expected: No TypeScript errors, page renders correctly

- [ ] **Step 6: Add verification comment to PR**

This step assumes you're working on the `feat/marketplace` branch from the original issue.

No commit needed - just note that verification is complete.

---

## Task 9: Final Commit and Summary

**Files:**
- Summary of changes

- [ ] **Step 1: Review all commits**

```bash
git log --oneline -10
```

Expected: Should see ~7-8 commits from this implementation

- [ ] **Step 2: Verify no uncommitted changes**

```bash
git status
```

Expected: Clean working tree (unless generated.ts changed, which is expected)

- [ ] **Step 3: Document completion**

Create completion message:

```
✅ Database Types Package Migration Complete

Created: packages/database-types/
- Exports: Database, Tables, Address, LoanWithTokens
- Source: Moved from apps/api/src/supabase/
- Build: TypeScript → dist/ with type declarations

Updated: apps/api/
- Uses @vouch/database-types package
- Removed 3 old type files
- Updated 4 service files

Updated: apps/web/
- Uses @vouch/database-types package  
- Deleted duplicate loan.ts, token.ts
- Added Database generic to Supabase client

Configuration:
- Turborepo build dependencies configured
- Type generation script updated
- All builds passing

Verification:
✓ pnpm build - success
✓ pnpm db:generate:types - success  
✓ pnpm dev - success
✓ Marketplace page renders correctly
```

---

## Completion Checklist

Before considering this implementation complete, verify:

- [x] Package builds successfully: `cd packages/database-types && pnpm build`
- [x] API builds successfully: `cd apps/api && pnpm build`
- [x] Web builds successfully: `cd apps/web && pnpm build`
- [x] Type generation works: `pnpm db:generate:types`
- [x] Dev mode starts: `pnpm dev`
- [x] No TypeScript errors in any workspace
- [x] All old type files deleted from API
- [x] All imports updated correctly
- [x] Turbo build dependencies configured
- [x] Git history is clean with descriptive commits

## Notes for Future Maintenance

**When adding new uint256 columns:**
1. Run migration: `pnpm db:reset` or apply specific migration
2. Regenerate types: `pnpm db:generate:types`
3. **CRITICAL:** Update `packages/database-types/src/database.ts` to override new uint256 fields from `number` to `string`
4. Commit both `generated.ts` and `database.ts`

**When schema changes break types:**
- TypeScript will catch issues at compile time in both apps
- Fix imports/usage in affected files
- This is desired behavior - forces addressing breaking changes
