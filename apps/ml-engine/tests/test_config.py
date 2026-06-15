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
