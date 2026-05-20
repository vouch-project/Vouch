"""Pydantic schemas for the ml-engine API."""
from pydantic import BaseModel


class CreditScoreResponse(BaseModel):
    address: str
    score: int
    confidence: float
    factors: list[str]
    model_version: str
    explanation: str | None = None
