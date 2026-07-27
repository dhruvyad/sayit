"""The OpenRouter speech-model catalogue, cached on disk.

OpenRouter publishes a ``supported_voices`` list on every speech model, so
voice names come from the API rather than a table in this repo. A hardcoded
table was not merely incomplete, it was wrong: Grok's voice is "eve", not
"Eve", and Deepgram has 90 voices rather than the 9 that guessing found.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

CATALOG_URL = "https://openrouter.ai/api/v1/models?output_modalities=speech"
MAX_AGE_SECONDS = 24 * 60 * 60

# Enough to speak without a network round trip on a cold cache.
FALLBACK: Dict[str, List[str]] = {
    "google/gemini-3.1-flash-tts-preview": ["Zephyr", "Puck", "Charon", "Kore"],
    "deepgram/aura-2": ["aura-2-thalia-en"],
    "x-ai/grok-voice-tts-1.0": ["eve", "ara", "rex", "sal", "leo"],
    "hexgrad/kokoro-82m": ["af_heart", "af_bella"],
    # Reported by the API as having no voice list, but this one is accepted.
    "minimax/speech-2.8-turbo": ["alloy"],
    "minimax/speech-2.8-hd": ["alloy"],
}


def cache_dir() -> Path:
    override = os.environ.get("SAYNOW_CACHE_DIR")
    if override:
        return Path(override).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "saynow"
    base = os.environ.get("XDG_CACHE_HOME") or (Path.home() / ".cache")
    return Path(base) / "saynow"


def _cache_path() -> Path:
    return cache_dir() / "speech-models.json"


def _read_cache() -> Optional[Dict[str, Any]]:
    try:
        raw = json.loads(_cache_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return raw if isinstance(raw.get("models"), list) else None


def _write_cache(models: List[Dict[str, Any]]) -> None:
    try:
        cache_dir().mkdir(parents=True, exist_ok=True)
        _cache_path().write_text(
            json.dumps({"at": time.time(), "models": models}), encoding="utf-8"
        )
    except OSError:
        pass  # a warm cache is an optimisation, never a requirement


def _fetch() -> List[Dict[str, Any]]:
    with urllib.request.urlopen(CATALOG_URL) as response:
        payload = json.loads(response.read())
    return [
        {
            "id": m["id"],
            "price": float((m.get("pricing") or {}).get("prompt") or 0),
            "voices": m.get("supported_voices") or [],
        }
        for m in payload.get("data", [])
    ]


def catalog(refresh: bool = False) -> List[Dict[str, Any]]:
    """The catalogue, from cache when fresh. Failures fall back to the cache."""
    cached = _read_cache()
    fresh = cached is not None and time.time() - cached.get("at", 0) < MAX_AGE_SECONDS

    if not refresh and fresh:
        return cached["models"]

    try:
        models = _fetch()
        _write_cache(models)
        return models
    except (urllib.error.URLError, json.JSONDecodeError, OSError, KeyError):
        return cached["models"] if cached else []


def cached_voices(model: str) -> List[str]:
    """Voices for a model without touching the network."""
    cached = _read_cache()
    for entry in (cached or {}).get("models", []):
        if entry["id"] == model and entry["voices"]:
            return entry["voices"]
    return FALLBACK.get(model, [])


def voices_for(model: str) -> List[str]:
    for entry in catalog():
        if entry["id"] == model and entry["voices"]:
            return entry["voices"]
    return FALLBACK.get(model, [])


def default_voice(model: str) -> Optional[str]:
    voices = cached_voices(model)
    return voices[0] if voices else None
