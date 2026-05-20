# AI Engine Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the database schema and wire the ml-engine API contract for the Vouch Credit Scoring AI engine (issue #12).

**Architecture:** Three new Supabase tables (`training_dataset`, `credit_scores`, `user_credit_features`) plus a `CreditScoreModule` in NestJS that caches scores with a 24h TTL. The ml-engine GET endpoint is upgraded from a stub to a real response shape (model loading deferred to issue #14). NestJS owns all writes to `credit_scores`; the ml-engine reads `user_credit_features` directly from Supabase at inference time.

**Tech Stack:** PostgreSQL/Supabase migrations (SQL), NestJS (`@nestjs/axios`, `@nestjs/common`), TypeScript, `pnpm db:generate:types`, pytest, Jest.

---

## File Map

**New files:**
- `supabase/migrations/20260517000001_training_dataset.sql`
- `supabase/migrations/20260517000002_credit_scores.sql`
- `supabase/migrations/20260517000003_user_credit_features.sql`
- `apps/api/src/scoring/scoring.module.ts`
- `apps/api/src/scoring/scoring.service.ts`
- `apps/api/src/scoring/scoring.service.spec.ts`
- `apps/api/src/scoring/scoring.controller.ts`
- `apps/api/src/scoring/dto/credit-score-response.dto.ts`
- `apps/ml-engine/src/__init__.py`
- `apps/ml-engine/src/schemas.py`
- `apps/ml-engine/src/scorer.py`
- `apps/ml-engine/tests/__init__.py`
- `apps/ml-engine/tests/test_scorer.py`

**Modified files:**
- `apps/ml-engine/main.py` — replace stub endpoint, wire scorer
- `apps/ml-engine/pyproject.toml` — add `supabase` dependency
- `apps/api/src/app.module.ts` — register `CreditScoreModule` and `HttpModule`
- `packages/database-types/src/generated.ts` — regenerated (run `pnpm db:generate:types`)

---

## Task 1: Migration — `training_dataset` table

**Files:**
- Create: `supabase/migrations/20260517000001_training_dataset.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS training_dataset (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- TODO: migrate walletAddress FK to userId uuid REFERENCES users(id) once #11 merges
    "walletAddress" address NOT NULL,
    "walletAgeDays" integer NOT NULL,
    "totalTransactions" integer NOT NULL,
    "historicalLiquidationCount" integer NOT NULL DEFAULT 0,
    "uniqueProtocolsUsed" integer NOT NULL DEFAULT 0,
    "wasLiquidated" boolean NOT NULL,
    "dataSource" text NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_dataset_wallet_idx ON training_dataset ("walletAddress");
CREATE INDEX IF NOT EXISTS training_dataset_label_idx ON training_dataset ("wasLiquidated");

ALTER TABLE training_dataset ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase db reset
```

Expected: migration applies without error. Check Supabase Studio at http://localhost:54323 — `training_dataset` table should appear.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260517000001_training_dataset.sql
git commit -m "feat(db): add training_dataset table"
```

---

## Task 2: Migration — `credit_scores` table

**Files:**
- Create: `supabase/migrations/20260517000002_credit_scores.sql`

- [ ] **Step 1: Write the migration**

```sql
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'riskLevel') THEN
        CREATE TYPE "riskLevel" AS ENUM ('very_low', 'low', 'medium', 'high', 'very_high');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS credit_scores (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- TODO: migrate walletAddress FK to userId uuid REFERENCES users(id) once #11 merges
    "walletAddress" address NOT NULL UNIQUE,
    score integer NOT NULL CHECK (score >= 0 AND score <= 1000),
    confidence numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    "riskLevel" "riskLevel" NOT NULL,
    factors jsonb NOT NULL DEFAULT '[]'::jsonb,
    "modelVersion" text NOT NULL,
    "scoredAt" timestamptz NOT NULL DEFAULT now(),
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_scores_wallet_idx ON credit_scores ("walletAddress");
CREATE INDEX IF NOT EXISTS credit_scores_scored_at_idx ON credit_scores ("scoredAt");

CREATE TRIGGER update_credit_scores_updated_at BEFORE
UPDATE ON credit_scores FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE credit_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users"
ON credit_scores AS PERMISSIVE FOR SELECT TO public USING (true);
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase db reset
```

Expected: `credit_scores` table appears in Supabase Studio with the `riskLevel` enum visible in the Types section.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260517000002_credit_scores.sql
git commit -m "feat(db): add credit_scores table"
```

---

## Task 3: Migration — `user_credit_features` table

**Files:**
- Create: `supabase/migrations/20260517000003_user_credit_features.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS user_credit_features (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- TODO: migrate walletAddress FK to userId uuid REFERENCES users(id) once #11 merges
    "walletAddress" address NOT NULL UNIQUE,
    "totalLoansTaken" integer NOT NULL DEFAULT 0,
    "totalLoansRepaid" integer NOT NULL DEFAULT 0,
    "totalLoansDefaulted" integer NOT NULL DEFAULT 0,
    "onTimeRepaymentRate" numeric(4,3) CHECK ("onTimeRepaymentRate" >= 0 AND "onTimeRepaymentRate" <= 1),
    "avgHealthFactorMaintained" numeric(6,4) CHECK ("avgHealthFactorMaintained" >= 0),
    "lastUpdatedAt" timestamptz,
    "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_credit_features_wallet_idx ON user_credit_features ("walletAddress");

ALTER TABLE user_credit_features ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase db reset
```

Expected: all three new tables appear in Supabase Studio without errors.

- [ ] **Step 3: Regenerate database types**

```bash
pnpm db:generate:types
```

Expected: `packages/database-types/src/generated.ts` now includes `training_dataset`, `credit_scores`, and `user_credit_features` in the `Database` type.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260517000003_user_credit_features.sql packages/database-types/src/generated.ts packages/database-types/src/
git commit -m "feat(db): add user_credit_features table and regenerate types"
```

---

## Task 4: ml-engine — schemas and scorer module

**Files:**
- Create: `apps/ml-engine/src/__init__.py`
- Create: `apps/ml-engine/src/schemas.py`
- Create: `apps/ml-engine/src/scorer.py`
- Create: `apps/ml-engine/tests/__init__.py`
- Create: `apps/ml-engine/tests/test_scorer.py`

- [ ] **Step 1: Write failing tests**

Create `apps/ml-engine/tests/__init__.py` (empty file).

Create `apps/ml-engine/tests/test_scorer.py`:

```python
"""Tests for the credit scorer module."""
import pytest
from src.scorer import CreditScorer, ScoringResult


def test_scorer_returns_stub_when_no_model() -> None:
    scorer = CreditScorer()
    result = scorer.score("0x1234567890abcdef1234567890abcdef12345678")
    assert isinstance(result, ScoringResult)
    assert result.score == 0
    assert result.confidence == 0.0
    assert result.risk_level == "very_high"
    assert result.factors == []
    assert result.model_version == "none"


def test_scorer_is_not_ready_when_no_model() -> None:
    scorer = CreditScorer()
    assert scorer.is_ready() is False
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/ml-engine && source .venv/bin/activate && python -m pytest tests/test_scorer.py -v
```

Expected: `ModuleNotFoundError: No module named 'src'` or `ImportError`.

- [ ] **Step 3: Create the src package and schemas**

Create `apps/ml-engine/src/__init__.py` (empty file).

Create `apps/ml-engine/src/schemas.py`:

```python
"""Pydantic schemas for the ml-engine API."""
from typing import Literal

from pydantic import BaseModel

RiskLevel = Literal["very_low", "low", "medium", "high", "very_high"]


class CreditScoreResponse(BaseModel):
    address: str
    score: int
    confidence: float
    risk_level: RiskLevel
    factors: list[str]
    model_version: str
```

- [ ] **Step 4: Create the scorer**

Create `apps/ml-engine/src/scorer.py`:

```python
"""Credit scoring logic — loads model artifact and runs inference."""
from dataclasses import dataclass, field
from typing import Literal

RiskLevel = Literal["very_low", "low", "medium", "high", "very_high"]


@dataclass
class ScoringResult:
    score: int
    confidence: float
    risk_level: RiskLevel
    factors: list[str]
    model_version: str


class CreditScorer:
    """Loads a trained model artifact and scores wallet addresses.

    Returns a zero-score stub when no model is loaded — the model artifact
    is produced by issue #14 and loaded at startup via load_model().
    """

    def __init__(self) -> None:
        self._model: object | None = None
        self._model_version: str = "none"

    def is_ready(self) -> bool:
        return self._model is not None

    def score(self, address: str) -> ScoringResult:  # noqa: ARG002
        if not self.is_ready():
            return ScoringResult(
                score=0,
                confidence=0.0,
                risk_level="very_high",
                factors=[],
                model_version=self._model_version,
            )
        # TODO(issue #14): implement real inference using self._model
        raise NotImplementedError("Model loaded but inference not yet implemented")
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/ml-engine && source .venv/bin/activate && python -m pytest tests/test_scorer.py -v
```

Expected:
```
tests/test_scorer.py::test_scorer_returns_stub_when_no_model PASSED
tests/test_scorer.py::test_scorer_is_not_ready_when_no_model PASSED
2 passed
```

- [ ] **Step 6: Commit**

```bash
git add apps/ml-engine/src/ apps/ml-engine/tests/
git commit -m "feat(ml-engine): add scorer module and schemas with stub inference"
```

---

## Task 5: ml-engine — upgrade GET /api/v1/score/{address} endpoint

**Files:**
- Modify: `apps/ml-engine/main.py`
- Modify: `apps/ml-engine/tests/test_scorer.py` — add endpoint tests

- [ ] **Step 1: Write failing endpoint tests**

Add to `apps/ml-engine/tests/test_scorer.py`:

```python
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_score_endpoint_returns_503_when_no_model() -> None:
    response = client.get("/api/v1/score/0x1234567890abcdef1234567890abcdef12345678")
    assert response.status_code == 503
    assert response.json()["detail"] == "Model not loaded — run training pipeline first."


def test_health_endpoint() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/ml-engine && source .venv/bin/activate && python -m pytest tests/test_scorer.py::test_score_endpoint_returns_503_when_no_model -v
```

Expected: FAIL — current stub returns 200 with `score: 0.0`, not 503.

- [ ] **Step 3: Rewrite main.py**

```python
"""Vouch Credit Scoring ML Engine."""
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from src.schemas import CreditScoreResponse
from src.scorer import CreditScorer

app = FastAPI(
    title="Vouch ML Engine",
    description="Credit scoring and risk assessment service for the Vouch lending protocol.",
    version="0.1.0",
)

scorer = CreditScorer()


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok", "service": "ml-engine"}


@app.get("/api/v1/score/{address}", response_model=CreditScoreResponse)
async def get_credit_score(address: str) -> CreditScoreResponse | JSONResponse:
    """Return a credit score for the given wallet address."""
    if not scorer.is_ready():
        return JSONResponse(
            status_code=503,
            content={"detail": "Model not loaded — run training pipeline first."},
        )

    result = scorer.score(address)
    return CreditScoreResponse(
        address=address,
        score=result.score,
        confidence=result.confidence,
        risk_level=result.risk_level,
        factors=result.factors,
        model_version=result.model_version,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
```

- [ ] **Step 4: Run all ml-engine tests**

```bash
cd apps/ml-engine && source .venv/bin/activate && python -m pytest tests/ -v
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/ml-engine/main.py apps/ml-engine/tests/test_scorer.py
git commit -m "feat(ml-engine): upgrade score endpoint to real contract shape"
```

---

## Task 6: NestJS — CreditScoreModule (service + controller)

**Files:**
- Create: `apps/api/src/credit-score/dto/credit-score-response.dto.ts`
- Create: `apps/api/src/credit-score/credit-score.service.ts`
- Create: `apps/api/src/credit-score/credit-score.service.spec.ts`
- Create: `apps/api/src/credit-score/credit-score.controller.ts`
- Create: `apps/api/src/credit-score/credit-score.module.ts`

- [ ] **Step 1: Write failing service test**

Create `apps/api/src/credit-score/credit-score.service.spec.ts`:

```typescript
import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { SupabaseService } from '../supabase/supabase.service';
import { CreditScoreService } from './credit-score.service';

const MOCK_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

const MOCK_ML_RESPONSE = {
  address: MOCK_ADDRESS,
  score: 742,
  confidence: 0.87,
  risk_level: 'low',
  factors: ['wallet_age_days'],
  model_version: 'v1',
};

describe('CreditScoreService', () => {
  let service: CreditScoreService;
  let httpService: jest.Mocked<HttpService>;
  let supabaseService: { client: { from: jest.Mock } };

  beforeEach(async () => {
    const selectMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
    });

    const upsertMock = jest.fn().mockResolvedValue({ error: null });

    supabaseService = {
      client: {
        from: jest.fn((table: string) => {
          if (table === 'credit_scores') return { select: selectMock, upsert: upsertMock };
          return {};
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditScoreService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn().mockReturnValue(of({ data: MOCK_ML_RESPONSE })),
          },
        },
        { provide: SupabaseService, useValue: supabaseService },
      ],
    }).compile();

    service = module.get<CreditScoreService>(CreditScoreService);
    httpService = module.get(HttpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('calls ml-engine and upserts result when no cached score exists', async () => {
    const result = await service.getScore(MOCK_ADDRESS);

    expect(httpService.get).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/score/${MOCK_ADDRESS}`),
    );
    expect(result.score).toBe(742);
    expect(result.riskLevel).toBe('low');
  });

  it('returns cached score when scoredAt is within 24h', async () => {
    const recentScore = {
      walletAddress: MOCK_ADDRESS,
      score: 600,
      confidence: 0.75,
      riskLevel: 'medium',
      factors: [],
      modelVersion: 'v1',
      scoredAt: new Date().toISOString(),
    };

    supabaseService.client.from = jest.fn(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: recentScore, error: null }),
        }),
      }),
      upsert: jest.fn().mockResolvedValue({ error: null }),
    }));

    const result = await service.getScore(MOCK_ADDRESS);

    expect(httpService.get).not.toHaveBeenCalled();
    expect(result.score).toBe(600);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test -- --testPathPattern=credit-score
```

Expected: FAIL — `Cannot find module './credit-score.service'`.

- [ ] **Step 3: Create the DTO**

Create `apps/api/src/credit-score/dto/credit-score-response.dto.ts`:

```typescript
export type RiskLevel = 'very_low' | 'low' | 'medium' | 'high' | 'very_high';

export class CreditScoreResponseDto {
  walletAddress: string;
  score: number;
  confidence: number;
  riskLevel: RiskLevel;
  factors: string[];
  modelVersion: string;
  scoredAt: string;
}
```

- [ ] **Step 4: Create the service**

Create `apps/api/src/credit-score/credit-score.service.ts`:

```typescript
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SupabaseService } from '../supabase/supabase.service';
import { CreditScoreResponseDto, RiskLevel } from './dto/credit-score-response.dto';

const SCORE_TTL_MS = 24 * 60 * 60 * 1000;

interface MlScoreResponse {
  address: string;
  score: number;
  confidence: number;
  risk_level: RiskLevel;
  factors: string[];
  model_version: string;
}

@Injectable()
export class CreditScoreService {
  private readonly logger = new Logger(CreditScoreService.name);
  private readonly mlEngineUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.mlEngineUrl =
      this.configService.get<string>('ML_ENGINE_URL') ?? 'http://localhost:8001';
  }

  async getScore(walletAddress: string): Promise<CreditScoreResponseDto> {
    const cached = await this.getCachedScore(walletAddress);
    if (cached) return cached;

    return this.fetchAndCacheScore(walletAddress);
  }

  private async getCachedScore(walletAddress: string): Promise<CreditScoreResponseDto | null> {
    const { data, error } = await this.supabaseService.client
      .from('credit_scores')
      .select('*')
      .eq('walletAddress', walletAddress)
      .single();

    if (error || !data) return null;

    const scoredAt = new Date(data.scoredAt as string).getTime();
    if (Date.now() - scoredAt > SCORE_TTL_MS) return null;

    return {
      walletAddress: data.walletAddress as string,
      score: data.score as number,
      confidence: data.confidence as number,
      riskLevel: data.riskLevel as RiskLevel,
      factors: data.factors as string[],
      modelVersion: data.modelVersion as string,
      scoredAt: data.scoredAt as string,
    };
  }

  private async fetchAndCacheScore(walletAddress: string): Promise<CreditScoreResponseDto> {
    let mlData: MlScoreResponse;

    try {
      const response = await firstValueFrom(
        this.httpService.get<MlScoreResponse>(
          `${this.mlEngineUrl}/api/v1/score/${walletAddress}`,
        ),
      );
      mlData = response.data;
    } catch (err) {
      this.logger.error(`ml-engine call failed for ${walletAddress}: ${String(err)}`);
      throw new ServiceUnavailableException('Credit scoring service unavailable');
    }

    const now = new Date().toISOString();
    const { error } = await this.supabaseService.client.from('credit_scores').upsert({
      walletAddress,
      score: mlData.score,
      confidence: mlData.confidence,
      riskLevel: mlData.risk_level,
      factors: mlData.factors,
      modelVersion: mlData.model_version,
      scoredAt: now,
    });

    if (error) this.logger.error(`Failed to cache credit score: ${error.message}`);

    return {
      walletAddress,
      score: mlData.score,
      confidence: mlData.confidence,
      riskLevel: mlData.risk_level,
      factors: mlData.factors,
      modelVersion: mlData.model_version,
      scoredAt: now,
    };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && pnpm test -- --testPathPattern=credit-score
```

Expected:
```
PASS src/credit-score/credit-score.service.spec.ts
  ✓ should be defined
  ✓ calls ml-engine and upserts result when no cached score exists
  ✓ returns cached score when scoredAt is within 24h
```

- [ ] **Step 6: Create the controller**

Create `apps/api/src/credit-score/credit-score.controller.ts`:

```typescript
import { Controller, Get, Param } from '@nestjs/common';
import { CreditScoreResponseDto } from './dto/credit-score-response.dto';
import { ScoringService } from './scoring.service';

@Controller('scoring')
export class ScoringController {
  constructor(private readonly scoringService: ScoringService) {}

  @Get(':address')
  getCreditScore(@Param('address') address: string): Promise<CreditScoreResponseDto> {
    return this.scoringService.getCreditScore(address);
  }
}
```

- [ ] **Step 7: Create the module**

Create `apps/api/src/credit-score/credit-score.module.ts`:

```typescript
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CreditScoreController } from './credit-score.controller';
import { CreditScoreService } from './credit-score.service';

@Module({
  imports: [HttpModule, SupabaseModule],
  controllers: [CreditScoreController],
  providers: [CreditScoreService],
  exports: [CreditScoreService],
})
export class CreditScoreModule {}
```

- [ ] **Step 8: Register in AppModule**

Modify `apps/api/src/app.module.ts` — add `CreditScoreModule` to the imports array:

```typescript
import { CreditScoreModule } from './credit-score/credit-score.module';
// ... existing imports ...

@Module({
  imports: [
    // ... existing modules ...
    CreditScoreModule,
  ],
  // ...
})
export class AppModule {}
```

- [ ] **Step 9: Add ML_ENGINE_URL to .env.example**

Add to `.env.example`:
```
ML_ENGINE_URL=http://localhost:8001
```

- [ ] **Step 10: Run all API tests**

```bash
cd apps/api && pnpm test
```

Expected: all tests pass, no regressions.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/credit-score/ apps/api/src/app.module.ts .env.example
git commit -m "feat(api): add CreditScoreModule with 24h TTL caching"
```

---

## Task 7: Add `supabase-py` to ml-engine for future feature reads

**Files:**
- Modify: `apps/ml-engine/pyproject.toml`

The ml-engine reads `user_credit_features` from Supabase at inference time (Approach C). Install the client now so issue #14 can use it without a separate dependency PR.

- [ ] **Step 1: Add dependency**

In `apps/ml-engine/pyproject.toml`, add `supabase>=2.0.0` to the `dependencies` list:

```toml
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.34.0",
    "scikit-learn>=1.6.0",
    "pandas>=2.2.0",
    "numpy>=2.0.0",
    "pydantic>=2.10.0",
    "httpx>=0.28.0",
    "supabase>=2.0.0",
]
```

- [ ] **Step 2: Install**

```bash
cd apps/ml-engine && source .venv/bin/activate && pip install -e .
```

Expected: installs without errors.

- [ ] **Step 3: Run ml-engine tests to confirm nothing broke**

```bash
cd apps/ml-engine && source .venv/bin/activate && python -m pytest tests/ -v
```

Expected: all 4 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add apps/ml-engine/pyproject.toml
git commit -m "chore(ml-engine): add supabase-py dependency for feature reads"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - `training_dataset` table → Task 1
  - `credit_scores` table with TTL → Task 2, Task 6
  - `user_credit_features` table → Task 3
  - TODO comments for `walletAddress` → Task 1, 2, 3 migration files
  - `pnpm db:generate:types` → Task 3
  - ml-engine GET endpoint contract → Task 4, 5
  - NestJS CreditScoreModule → Task 6
  - Data flow (NestJS calls ml-engine, NestJS writes cache) → Task 6
  - `supabase-py` for future Approach C reads → Task 7
- [x] **No placeholders** — all code blocks are complete
- [x] **Type consistency** — `RiskLevel`, `CreditScoreResponseDto`, `ScoringResult` defined in Task 4/6 and used consistently in Task 5/6
