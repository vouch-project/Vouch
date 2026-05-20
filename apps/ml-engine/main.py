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
        factors=result.factors,
        model_version=result.model_version,
        explanation=result.explanation,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
