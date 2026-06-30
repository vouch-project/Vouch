FROM python:3.11-slim

WORKDIR /app

# Install system deps
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY apps/ml-engine/pyproject.toml ./
RUN pip install --no-cache-dir .

# Copy application code
COPY apps/ml-engine/ ./

# Bundle trained model artifacts (auto-selected by the scorer at runtime)
COPY services/ml-training/src/vouch_ml_training/models/artifacts/ ./artifacts/

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
