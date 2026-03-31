Modelserver — quick start

Requirements:

- Python 3.9+
- Optional GPU drivers + PyTorch for GPU acceleration

Install (recommended into venv):

```bash
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
```

Run (development):

```bash
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

Endpoints:

- `POST /download` — download & cache a HF model: {"model": "sentence-transformers/all-MiniLM-L6-v2"}
- `POST /embed` — compute embeddings: {"model": "all-MiniLM-L6-v2", "texts": ["a","b"]}
- `GET /models` — list loaded models
- `GET /health` — liveness check

Notes:

- Use `HUGGINGFACE_TOKEN` env var to authenticate private model downloads.
- This is a minimal server meant for local / private network hosting.
