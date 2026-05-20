"""Credit scoring logic — loads model artifact and runs inference."""
from dataclasses import dataclass

from src.schemas import RiskLevel


@dataclass
class ScoringResult:
    score: int
    confidence: float
    risk_level: RiskLevel
    factors: list[str]
    model_version: str
    explanation: str | None = None


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
