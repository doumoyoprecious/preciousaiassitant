"""Local, free embeddings.

Primary: all-MiniLM-L6-v2 via fastembed (ONNX, runs on CPU, ~90MB one-time download,
no API key, no cost). Fallback: deterministic hashed bag-of-words vector so RAG
keeps working even if the model cannot be downloaded.
"""
import hashlib
import logging
import re
import threading

import numpy as np

log = logging.getLogger("precious.embed")

from .. import config

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
DIM = 384


class Embedder:
    def __init__(self):
        self._model = None
        self._failed = None
        self._lock = threading.Lock()
        self.dim = DIM

    def _init(self):
        if self._model is not None or self._failed is not None:
            return
        with self._lock:
            if self._model is not None or self._failed is not None:
                return
            try:
                # Model cache must live on a writable path. On Vercel that is
                # /tmp/precious-ai/models (config.MODELS_DIR); the model is
                # re-downloaded on each cold instance (a few seconds).
                config.ensure_dirs()
                from fastembed import TextEmbedding
                self._model = TextEmbedding(MODEL_NAME, cache_dir=str(config.MODELS_DIR))
            except Exception as e:  # noqa: BLE001
                self._failed = f"{e.__class__.__name__}: {e}"

    def state(self) -> str:
        self._init()
        if self._model is not None:
            return "ready"
        if self._failed:
            return "fallback"
        return "not-loaded"

    def backend(self) -> str:
        self._init()
        if self._model is not None:
            return f"{MODEL_NAME} (local ONNX, free)"
        if self._failed:
            return "lexical fallback (embedding model unavailable)"
        return "not loaded yet (loads on first use)"

    def fail_reason(self) -> str:
        return self._failed or ""

    def embed(self, texts) -> np.ndarray:
        texts = list(texts)
        self._init()
        if self._model is not None:
            try:
                vecs = np.asarray(list(self._model.embed(texts)), dtype=np.float32)
                if vecs.size:
                    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
                    norms[norms == 0] = 1.0
                    return vecs / norms
            except Exception as e:  # noqa: BLE001
                log.exception("Model embedding failed, using fallback: %s", e)
        return self._fallback(texts)

    def _fallback(self, texts) -> np.ndarray:
        arr = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, t in enumerate(texts):
            for w in re.findall(r"[a-z0-9]{2,}", (t or "").lower()):
                h = int(hashlib.md5(w.encode()).hexdigest(), 16)
                arr[i, h % self.dim] += 1.0
        norms = np.linalg.norm(arr, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return arr / norms

    @staticmethod
    def encode(vecs) -> bytes:
        return np.asarray(vecs, dtype=np.float32).tobytes()

    @staticmethod
    def decode(blob) -> np.ndarray:
        return np.frombuffer(blob, dtype=np.float32)


embedder = Embedder()
