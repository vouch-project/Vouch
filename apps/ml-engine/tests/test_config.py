# apps/ml-engine/tests/test_config.py
from src.config import Settings


def test_settings_loads_from_env(monkeypatch):
    monkeypatch.setenv("THE_GRAPH_API_KEY", "test-key")
    monkeypatch.setenv("AAVE_V3_SUBGRAPH_ID", "test-subgraph-id")
    monkeypatch.setenv("ETHERSCAN_API_KEY", "test-etherscan")
    monkeypatch.setenv("RPC_URL", "https://rpc.example.com")
    s = Settings()
    assert s.the_graph_api_key == "test-key"
    assert s.subgraph_url == "https://gateway.thegraph.com/api/test-key/subgraphs/id/test-subgraph-id"
    assert s.target_chain_id == 1


def test_settings_artifact_path_default(monkeypatch, tmp_path):
    monkeypatch.setenv("THE_GRAPH_API_KEY", "k")
    monkeypatch.setenv("AAVE_V3_SUBGRAPH_ID", "s")
    monkeypatch.setenv("ETHERSCAN_API_KEY", "e")
    monkeypatch.setenv("RPC_URL", "https://rpc.example.com")
    monkeypatch.delenv("ARTIFACT_PATH", raising=False)
    s = Settings()
    assert s.artifact_path is None


def test_compat_register_idempotent():
    import sys

    from src.compat import CalibratedPipeline, register

    register()
    register()  # should not raise
    assert "vouch_ml_training.pipelines.train_xgboost" in sys.modules
    mod = sys.modules["vouch_ml_training.pipelines.train_xgboost"]
    assert mod.CalibratedPipeline is CalibratedPipeline


def test_compat_predict_proba_platt_scaling():
    import numpy as np

    from src.compat import CalibratedPipeline

    class _FakePipeline:
        def predict_proba(self, x):
            n = x.shape[0]
            return np.column_stack([np.full(n, 0.3), np.full(n, 0.7)])

    class _PlattCalibrator:
        def __init__(self):
            self.last_input_shape = None

        def predict_proba(self, x):
            self.last_input_shape = x.shape
            n = x.shape[0]
            return np.column_stack([np.full(n, 0.2), np.full(n, 0.8)])

    cal = _PlattCalibrator()
    cp = CalibratedPipeline(_FakePipeline(), cal)
    x = np.zeros((5, 3))
    out = cp.predict_proba(x)

    assert cal.last_input_shape == (5, 1), "calibrator must receive 2D (n, 1) input"
    assert out.shape == (5, 2)
    np.testing.assert_allclose(out[:, 0], 0.2)
    np.testing.assert_allclose(out[:, 1], 0.8)


def test_compat_predict_proba_isotonic_fallback():
    import numpy as np

    from src.compat import CalibratedPipeline

    class _FakePipeline:
        def predict_proba(self, x):
            n = x.shape[0]
            return np.column_stack([np.full(n, 0.4), np.full(n, 0.6)])

    class _IsotonicCalibrator:
        def predict(self, x):
            assert x.ndim == 1, "legacy calibrator must receive 1D input"
            return x * 0.9

    cp = CalibratedPipeline(_FakePipeline(), _IsotonicCalibrator())
    x = np.zeros((4, 3))
    out = cp.predict_proba(x)

    assert out.shape == (4, 2)
    np.testing.assert_allclose(out[:, 1], 0.6 * 0.9)
    np.testing.assert_allclose(out[:, 0], 1 - 0.6 * 0.9)
