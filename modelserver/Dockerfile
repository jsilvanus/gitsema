# gitsema model server — Docker image
#
# Builds a self-contained FastAPI embedding server that avoids the Rust
# toolchain requirement that blocks native wheel installation on Windows.
#
# Usage:
#   docker build -t gitsema-modelserver .
#   docker run -p 8000:8000 gitsema-modelserver
#
# With GPU support (requires nvidia-container-toolkit):
#   docker run --gpus all -p 8000:8000 gitsema-modelserver
#
# With a HuggingFace auth token for private or gated models:
#   docker run -e HUGGINGFACE_TOKEN=hf_... -p 8000:8000 gitsema-modelserver
#
# To persist downloaded models across container restarts:
#   docker run -v $(pwd)/models:/app/models -p 8000:8000 gitsema-modelserver

FROM python:3.11-slim

WORKDIR /app

# Install system deps needed for some model wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

EXPOSE 8000

# Respect USE_CUDA env var — passed through to the server at runtime
ENV USE_CUDA=""
ENV HUGGINGFACE_TOKEN=""

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
