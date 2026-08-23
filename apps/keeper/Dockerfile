FROM python:3.11-slim

WORKDIR /app

# Install system deps
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY apps/keeper/pyproject.toml ./
RUN pip install --no-cache-dir .

# Copy application code
COPY apps/keeper/ ./

# Copy the generated contract ABIs (single source of truth, see extract-abi.mjs).
# chain.py loads these from ./abi at runtime (Path(__file__).parent / "abi").
COPY packages/abi/VouchVault.json packages/abi/VouchVaultLens.json ./abi/

CMD ["python", "main.py"]
