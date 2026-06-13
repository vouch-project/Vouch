# apps/ml-engine/src/schemas.py
from pydantic import BaseModel


class CreditScoreResponse(BaseModel):
    address: str
    score: int
    confidence: float
    strengths: list[str]
    risk_factors: list[str]
    improvements: list[str]
    model_version: str
    explanation: str | None = None
