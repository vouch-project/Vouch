"""Vouch Credit Scoring ML Engine."""

from fastapi import FastAPI

app = FastAPI(
    title="Vouch ML Engine",
    description="Credit scoring and risk assessment service for the Vouch lending protocol.",
    version="0.1.0",
)


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok", "service": "ml-engine"}


@app.get("/api/v1/score/{address}")
async def get_credit_score(address: str) -> dict[str, object]:
    """Return a credit score for the given wallet address (stub)."""
    return {
        "address": address,
        "score": 0.0,
        "confidence": 0.0,
        "factors": [],
        "message": "Scoring model not yet trained — returning defaults.",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
