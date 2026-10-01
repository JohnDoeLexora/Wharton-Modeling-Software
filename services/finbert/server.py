#!/usr/bin/env python3
"""Local scoring service for ProsusAI/finbert.

Citation
    Araci, D. (2019). FinBERT: Financial Sentiment Analysis with Pre-trained
    Language Models. https://arxiv.org/abs/1908.10063
Weights
    https://huggingface.co/ProsusAI/finbert

This process scores text. It does not trade, and it does not read the
portfolio model. If the weights are not cached, it refuses to download them.
Run scripts/setup_finbert.py first.
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = int(os.environ.get("FINBERT_PORT", "8765"))
MODEL_ID = "ProsusAI/finbert"
MAX_TEXTS = 30
MAX_CHARS = 2000

_tokenizer = None
_model = None


def hub_dir() -> Path:
    if os.environ.get("HUGGINGFACE_HUB_CACHE"):
        return Path(os.environ["HUGGINGFACE_HUB_CACHE"])
    if os.environ.get("HF_HOME"):
        return Path(os.environ["HF_HOME"]) / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def weights_cached() -> bool:
    root = hub_dir()
    if not root.exists():
        return False
    return any(root.glob("models--ProsusAI--finbert/**/config.json"))


def transformers_installed() -> bool:
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except Exception:
        return False
    return True


def health() -> dict:
    installed = transformers_installed()
    cached = weights_cached()
    ready = installed and cached
    if ready:
        detail = "Weights are cached and the Python packages import. The model loads on the first score request."
    elif not installed:
        detail = "transformers and torch are not installed. Run python scripts/setup_finbert.py."
    else:
        detail = "Packages import, but ProsusAI/finbert is not in the Hugging Face cache. Run python scripts/setup_finbert.py. This server will not download it for you."
    return {
        "service": "finbert",
        "model": MODEL_ID,
        "transformers_installed": installed,
        "weights_cached": cached,
        "ready": ready,
        "detail": detail,
    }


def load_model():
    global _tokenizer, _model
    if _model is not None:
        return
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    _tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, local_files_only=True)
    _model = AutoModelForSequenceClassification.from_pretrained(MODEL_ID, local_files_only=True)
    _model.eval()


def score_texts(texts: list[str]) -> list[dict]:
    import torch

    load_model()
    assert _tokenizer is not None and _model is not None
    clipped = [text[:MAX_CHARS] for text in texts]
    inputs = _tokenizer(clipped, padding=True, truncation=True, max_length=512, return_tensors="pt")
    with torch.no_grad():
        logits = _model(**inputs).logits
        probs = torch.softmax(logits, dim=-1)
    id2label = {int(key): str(value).lower() for key, value in _model.config.id2label.items()}
    rows = []
    for index, text in enumerate(clipped):
        scores = {id2label[label_index]: float(probs[index, label_index]) for label_index in range(probs.shape[1])}
        # The published labels are positive / negative / neutral. Keep any unexpected key rather than dropping it.
        positive = scores.get("positive", 0.0)
        negative = scores.get("negative", 0.0)
        neutral = scores.get("neutral", 0.0)
        label = max(
            (("positive", positive), ("negative", negative), ("neutral", neutral)),
            key=lambda item: item[1],
        )[0]
        rows.append(
            {
                "text": text,
                "label": label,
                "scores": {"positive": positive, "negative": negative, "neutral": neutral},
            }
        )
    return rows


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print("[finbert]", fmt % args)

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] in ("/health", "/"):
            self._send(200, health())
            return
        self._send(404, {"error": "Use GET /health or POST /score."})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/score":
            self._send(404, {"error": "Use POST /score."})
            return
        status = health()
        if not status["ready"]:
            self._send(503, {"available": False, "error": status["detail"], "model": MODEL_ID})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length > 256_000:
            self._send(413, {"available": False, "error": "Request is too large."})
            return
        try:
            raw = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            texts = raw.get("texts", [])
            if isinstance(texts, str):
                texts = [texts]
            if not isinstance(texts, list) or not texts:
                raise ValueError("Send JSON {\"texts\": [\"headline\"]}.")
            cleaned = [str(item).strip() for item in texts if str(item).strip()]
            if not cleaned:
                raise ValueError("No text to score.")
            if len(cleaned) > MAX_TEXTS:
                raise ValueError(f"Send at most {MAX_TEXTS} texts.")
        except (json.JSONDecodeError, ValueError) as exc:
            self._send(400, {"available": False, "error": str(exc)})
            return
        try:
            results = score_texts(cleaned)
        except Exception as exc:  # noqa: BLE001 — surface a useful setup error, not a stack, to the UI
            self._send(500, {"available": False, "error": f"FinBERT failed to score: {exc}", "model": MODEL_ID})
            return
        self._send(200, {"available": True, "model": MODEL_ID, "results": results})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"FinBERT helper listening on http://{HOST}:{PORT}")
    print(health()["detail"])
    server.serve_forever()


if __name__ == "__main__":
    main()
