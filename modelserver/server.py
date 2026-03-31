from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any
import os

app = FastAPI(title="gitsema-modelserver")

# Simple in-memory registry: model_name -> {'type': 'sbert'|'hf', 'obj': model, 'dims': int}
MODELS: Dict[str, Dict[str, Any]] = {}


class DownloadRequest(BaseModel):
    model: str


class EmbedRequest(BaseModel):
    model: str
    texts: List[str]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/models")
def list_models():
    return {k: {"dims": v.get("dims"), "type": v.get("type")} for k, v in MODELS.items()}


def load_sentence_transformer(model_name: str):
    try:
        from sentence_transformers import SentenceTransformer
    except Exception as e:
        raise RuntimeError("sentence-transformers not available") from e
    m = SentenceTransformer(model_name)
    return m, getattr(m, 'get_sentence_embedding_dimension', lambda: None)()


def load_transformers_meanpool(model_name: str, device: str = 'cpu'):
    try:
        from transformers import AutoTokenizer, AutoModel
        import torch
        import numpy as np
    except Exception as e:
        raise RuntimeError("transformers/torch not available") from e

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModel.from_pretrained(model_name).to(device)

    def embed_texts(texts: List[str]) -> List[List[float]]:
        inputs = tokenizer(texts, padding=True, truncation=True, return_tensors='pt')
        inputs = {k: v.to(device) for k, v in inputs.items()}
        with torch.no_grad():
            out = model(**inputs, return_dict=True)
            last = out.last_hidden_state  # (B, T, D)
            attn_mask = inputs.get('attention_mask')
            if attn_mask is None:
                pooled = last.mean(dim=1)
            else:
                mask = attn_mask.unsqueeze(-1)
                summed = (last * mask).sum(1)
                denom = mask.sum(1).clamp(min=1)
                pooled = summed / denom
            arr = pooled.cpu().numpy()
            return arr.tolist()

    # return wrapper object
    return {'embed': embed_texts, 'dims': model.config.hidden_size}


@app.post("/download")
def download_model(req: DownloadRequest):
    model_name = req.model
    # Try sentence-transformers first
    try:
        m, dims = load_sentence_transformer(model_name)
        MODELS[model_name] = {'type': 'sbert', 'obj': m, 'dims': dims}
        return {"model": model_name, "status": "loaded", "type": "sbert", "dims": dims}
    except Exception:
        # fallback to huggingface transformers mean-pool
        try:
            device = 'cuda' if os.environ.get('USE_CUDA') == '1' else 'cpu'
            wrapper = load_transformers_meanpool(model_name, device=device)
            MODELS[model_name] = {'type': 'hf_meanpool', 'obj': wrapper, 'dims': wrapper.get('dims')}
            return {"model": model_name, "status": "loaded", "type": "hf_meanpool", "dims": wrapper.get('dims')}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@app.post("/embed")
def embed(req: EmbedRequest):
    model_name = req.model
    if model_name not in MODELS:
        raise HTTPException(status_code=404, detail=f"model not loaded: {model_name}")
    entry = MODELS[model_name]
    t = entry['type']
    if t == 'sbert':
        m = entry['obj']
        emb = m.encode(req.texts, convert_to_numpy=True)
        # ensure list of lists
        res = emb.tolist() if hasattr(emb, 'tolist') else [list(e) for e in emb]
        return {"model": model_name, "dims": entry.get('dims'), "embeddings": res}
    elif t == 'hf_meanpool':
        wrapper = entry['obj']
        res = wrapper['embed'](req.texts)
        return {"model": model_name, "dims": entry.get('dims'), "embeddings": res}
    else:
        raise HTTPException(status_code=500, detail="unknown model type")
