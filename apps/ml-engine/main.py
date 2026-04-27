"""Vouch Credit Scoring ML Engine."""

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(
    title="Vouch ML Engine",
    description="Credit scoring and risk assessment service for the Vouch lending protocol.",
    version="0.1.0",
)


class CreditScoreResponse(BaseModel):
    address: str
    score: int
    confidence: float
    factors: list[str]
    message: str


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok", "service": "ml-engine"}


@app.get("/api/v1/score/{address}", response_model=CreditScoreResponse)
async def get_credit_score(address: str) -> CreditScoreResponse:
    """Return a deterministic mock credit score for the given wallet address.

    Score is derived from the character sum of the address, producing a stable
    value in the 650–850 range. This mirrors the previous frontend stub and will
    be replaced with a real ML model in a future iteration.
    """
    char_sum = sum(ord(c) for c in address)
    score = 650 + (char_sum % 200)

    return CreditScoreResponse(
        address=address,
        score=score,
        confidence=0.5,
        factors=[],
        message="Scoring model not yet trained — returning deterministic mock.",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
