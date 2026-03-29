# Billie Servicing Event Processor Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for caching
COPY requirements.txt .

# Install base requirements (excluding git-based SDKs)
RUN grep -v "git+https" requirements.txt > /tmp/base-requirements.txt && \
    pip install --no-cache-dir -r /tmp/base-requirements.txt

# Install Billie Event SDKs from requirements.txt (requires GITHUB_TOKEN at build time)
# Use: docker build --secret id=GITHUB_TOKEN,env=GITHUB_TOKEN .
COPY scripts/subst-sdk-requirements.py ./scripts/
RUN --mount=type=secret,id=GITHUB_TOKEN \
    if [ -f /run/secrets/GITHUB_TOKEN ]; then \
    python3 scripts/subst-sdk-requirements.py /run/secrets/GITHUB_TOKEN requirements.txt /tmp/sdk-requirements.txt && \
    pip install --no-cache-dir -r /tmp/sdk-requirements.txt && \
    rm -f /tmp/sdk-requirements.txt; \
    else echo "GITHUB_TOKEN not set, skipping SDK install"; fi

# Copy application code
COPY src/ src/

# Set Python path
ENV PYTHONPATH=/app/src

# Run the processor
CMD ["python", "-m", "billie_servicing.main"]
