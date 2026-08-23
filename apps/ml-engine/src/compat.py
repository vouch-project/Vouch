# apps/ml-engine/src/compat.py
"""Pickle compatibility shim for CalibratedPipeline from ml-training.

joblib.load() uses pickle, which requires the class to be importable from
the exact dotted path it was serialized under. The model was trained in
services/ml-training where the class lives at
vouch_ml_training.pipelines.train_xgboost.CalibratedPipeline.

We register a minimal stub at that path so deserialization works without
importing ml-training as a package.
"""
from __future__ import annotations

import sys
import types

import numpy as np
from sklearn.pipeline import Pipeline


class CalibratedPipeline:
    def __init__(self, pipeline: Pipeline, calibrator: object) -> None:
        self._pipeline = pipeline
        self._calibrator = calibrator

    def predict_proba(self, x: np.ndarray) -> np.ndarray:
        raw = self._pipeline.predict_proba(x)[:, 1]
        if hasattr(self._calibrator, "predict_proba"):
            # LogisticRegression (Platt scaling) — needs 2D input, returns proba
            cal = self._calibrator.predict_proba(raw.reshape(-1, 1))[:, 1]  # type: ignore[union-attr]
        else:
            # IsotonicRegression (legacy) — accepts 1D, returns calibrated values
            cal = self._calibrator.predict(raw)  # type: ignore[union-attr]
        return np.column_stack([1 - cal, cal])

    def predict(self, x: np.ndarray) -> np.ndarray:
        return (self.predict_proba(x)[:, 1] >= 0.5).astype(int)


def register() -> None:
    """Call once at startup before any joblib.load() of an ml-training artifact."""
    pkg = types.ModuleType("vouch_ml_training")
    sub = types.ModuleType("vouch_ml_training.pipelines")
    mod = types.ModuleType("vouch_ml_training.pipelines.train_xgboost")
    mod.CalibratedPipeline = CalibratedPipeline  # type: ignore[attr-defined]
    sys.modules.setdefault("vouch_ml_training", pkg)
    sys.modules.setdefault("vouch_ml_training.pipelines", sub)
    sys.modules.setdefault("vouch_ml_training.pipelines.train_xgboost", mod)
