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
    explanation: str | None = None
