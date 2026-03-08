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

CMD ["python", "main.py"]
