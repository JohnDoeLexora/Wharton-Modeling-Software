#!/usr/bin/env python3
"""Install the FinBERT Python packages and cache ProsusAI/finbert.

The download is large (PyTorch plus the model). It is optional.
The modeling app runs without it. The Research tab then offers a demo lexicon
that is clearly labeled as not FinBERT.

Citation: Araci, D. (2019), arXiv:1908.10063.
Weights: https://huggingface.co/ProsusAI/finbert
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIREMENTS = ROOT / "services" / "finbert" / "requirements.txt"
MODEL_ID = "ProsusAI/finbert"


def main() -> None:
    if sys.version_info < (3, 10):
        raise SystemExit("Python 3.10 or newer is required.")
    print(f"Installing {REQUIREMENTS} ...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(REQUIREMENTS)])
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    print(f"Downloading {MODEL_ID} into the Hugging Face cache ...")
    AutoTokenizer.from_pretrained(MODEL_ID)
    AutoModelForSequenceClassification.from_pretrained(MODEL_ID)
    print("Cached ProsusAI/finbert.")
    print("Start the scoring service with:")
    print("  python services/finbert/server.py")
    print("Then open the app and use Score with FinBERT. The service does not trade.")


if __name__ == "__main__":
    main()
