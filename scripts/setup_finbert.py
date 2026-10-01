#!/usr/bin/env python3
"""Install FinBERT into a project virtualenv and cache ProsusAI/finbert.

Creates `.venv` at the repo root (gitignored). Uses the CPU PyTorch wheel so
the install stays manageable on machines without a CUDA GPU.

The download is large (PyTorch plus the model). It is optional.
The modeling app runs without it. The Research tab then offers a demo lexicon
that is clearly labeled as not FinBERT.

Citation: Araci, D. (2019), arXiv:1908.10063.
Weights: https://huggingface.co/ProsusAI/finbert
"""

from __future__ import annotations

import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENV = ROOT / ".venv"
MODEL_ID = "ProsusAI/finbert"


def venv_python() -> Path:
    if sys.platform == "win32":
        return VENV / "Scripts" / "python.exe"
    return VENV / "bin" / "python"


def main() -> None:
    if sys.version_info < (3, 10):
        raise SystemExit("Python 3.10 or newer is required.")

    if not venv_python().exists():
        print(f"Creating virtualenv at {VENV} ...")
        venv.EnvBuilder(with_pip=True).create(VENV)

    py = str(venv_python())
    print("Upgrading pip in .venv ...")
    subprocess.check_call([py, "-m", "pip", "install", "-U", "pip"])

    print("Installing CPU torch ...")
    subprocess.check_call(
        [
            py,
            "-m",
            "pip",
            "install",
            "torch",
            "--index-url",
            "https://download.pytorch.org/whl/cpu",
        ]
    )
    print("Installing transformers ...")
    subprocess.check_call([py, "-m", "pip", "install", "transformers>=4.40.0"])

    print(f"Downloading {MODEL_ID} into the Hugging Face cache ...")
    subprocess.check_call(
        [
            py,
            "-c",
            (
                "from transformers import AutoModelForSequenceClassification, AutoTokenizer; "
                f"AutoTokenizer.from_pretrained('{MODEL_ID}'); "
                f"AutoModelForSequenceClassification.from_pretrained('{MODEL_ID}'); "
                f"print('Cached {MODEL_ID}.')"
            ),
        ]
    )
    print("Start the scoring service with:")
    print(f"  {py} services/finbert/server.py")
    print("Then open the app and use Score with FinBERT. The service does not trade.")


if __name__ == "__main__":
    main()
