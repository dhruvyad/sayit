"""Speech providers: the offline system voice plus cloud backends."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

OPENAI_VOICES = [
    "alloy", "ash", "ballad", "coral", "echo",
    "fable", "nova", "onyx", "sage", "shimmer",
]

ELEVENLABS_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"  # "Rachel", the default public voice

PROVIDERS: Dict[str, Dict[str, Any]] = {
    "system": {
        "label": "built-in OS speech synthesis (offline, no API key)",
        "speaks_directly": True,
        "env_var": None,
        "config_key": None,
    },
    "openai": {
        "label": "OpenAI /v1/audio/speech",
        "speaks_directly": False,
        "env_var": "OPENAI_API_KEY",
        "config_key": "openaiApiKey",
    },
    "elevenlabs": {
        "label": "ElevenLabs text-to-speech",
        "speaks_directly": False,
        "env_var": "ELEVENLABS_API_KEY",
        "config_key": "elevenlabsApiKey",
    },
}


def get(provider_id: str) -> Dict[str, Any]:
    if provider_id not in PROVIDERS:
        raise SystemExit(
            f"saynow: unknown provider \"{provider_id}\". "
            f"Available: {', '.join(PROVIDERS)}"
        )
    return PROVIDERS[provider_id]


# --- system -----------------------------------------------------------------

def _system_command(text: str, voice: Optional[str], rate: Optional[float]) -> List[str]:
    if sys.platform == "darwin":
        cmd = ["say"]
        if voice:
            cmd += ["-v", voice]
        if rate:
            cmd += ["-r", str(int(rate))]
        return cmd + ["--", text]

    if sys.platform.startswith("linux"):
        binary = "espeak-ng" if shutil.which("espeak-ng") else "espeak"
        cmd = [binary]
        if voice:
            cmd += ["-v", voice]
        if rate:
            cmd += ["-s", str(int(rate))]
        return cmd + ["--", text]

    if sys.platform == "win32":
        escaped = text.replace("'", "''")
        script = (
            "Add-Type -AssemblyName System.Speech;"
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;"
        )
        if voice:
            script += f"$s.SelectVoice('{voice}');"
        if rate:
            script += f"$s.Rate = {max(-10, min(10, int(rate)))};"
        script += f"$s.Speak('{escaped}')"
        return ["powershell", "-NoProfile", "-Command", script]

    raise SystemExit(f"saynow: no system speech backend known for platform \"{sys.platform}\"")


def speak_system(text: str, voice: Optional[str] = None, rate: Optional[float] = None) -> None:
    cmd = _system_command(text, voice, rate)
    try:
        result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except FileNotFoundError:
        raise SystemExit(
            f"saynow: \"{cmd[0]}\" not found. On Linux install espeak-ng "
            "(apt install espeak-ng), or configure a cloud provider with: saynow init"
        )
    if result.returncode != 0:
        raise SystemExit(f"saynow: {cmd[0]} exited with code {result.returncode}")


def system_voices() -> List[Tuple[str, str, str]]:
    if sys.platform == "darwin":
        out = subprocess.run(["say", "-v", "?"], capture_output=True, text=True)
        if out.returncode != 0:
            return []
        voices = []
        for line in out.stdout.splitlines():
            parts = line.split("#", 1)
            head = parts[0].rstrip()
            note = parts[1].strip() if len(parts) > 1 else ""
            bits = head.rsplit(None, 1)
            if len(bits) == 2:
                voices.append((bits[0].strip(), bits[1], note))
        return voices

    if sys.platform.startswith("linux"):
        binary = "espeak-ng" if shutil.which("espeak-ng") else "espeak"
        out = subprocess.run([binary, "--voices"], capture_output=True, text=True)
        if out.returncode != 0:
            return []
        voices = []
        for line in out.stdout.splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 4:
                voices.append((parts[3], parts[1], ""))
        return voices

    return []


# --- cloud ------------------------------------------------------------------

def _post(url: str, headers: Dict[str, str], body: Dict[str, Any], provider: str) -> bytes:
    request = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(request) as response:
            return response.read()
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:300]
        if err.code == 401:
            raise SystemExit(
                f"saynow: {provider} rejected the API key (401). Check it with: saynow config list"
            )
        if err.code == 429:
            raise SystemExit(f"saynow: {provider} rate limited or out of quota (429). {detail}")
        raise SystemExit(f"saynow: {provider} request failed ({err.code}). {detail}")
    except urllib.error.URLError as err:
        raise SystemExit(f"saynow: could not reach {provider}: {err.reason}")


def synthesize_openai(
    text: str,
    api_key: str,
    voice: Optional[str] = None,
    model: Optional[str] = None,
    speed: Optional[float] = None,
) -> bytes:
    body: Dict[str, Any] = {
        "model": model or "gpt-4o-mini-tts",
        "voice": voice or "alloy",
        "input": text,
        "response_format": "mp3",
    }
    # Only the tts-1 family accepts `speed`; sending it otherwise is a 400.
    if speed and speed != 1:
        body["speed"] = speed

    return _post(
        "https://api.openai.com/v1/audio/speech",
        {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        body,
        "OpenAI",
    )


def synthesize_elevenlabs(
    text: str,
    api_key: str,
    voice: Optional[str] = None,
    model: Optional[str] = None,
    speed: Optional[float] = None,
) -> bytes:
    body: Dict[str, Any] = {"text": text, "model_id": model or "eleven_turbo_v2_5"}
    if speed and speed != 1:
        body["voice_settings"] = {"speed": speed}

    return _post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice or ELEVENLABS_DEFAULT_VOICE}",
        {"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        body,
        "ElevenLabs",
    )


SYNTHESIZERS = {
    "openai": synthesize_openai,
    "elevenlabs": synthesize_elevenlabs,
}


def voices(provider_id: str, api_key: Optional[str] = None) -> List[Tuple[str, str, str]]:
    if provider_id == "system":
        return system_voices()
    if provider_id == "openai":
        return [(name, "multi", "") for name in OPENAI_VOICES]
    if provider_id == "elevenlabs":
        if not api_key:
            return []
        request = urllib.request.Request(
            "https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": api_key}
        )
        try:
            with urllib.request.urlopen(request) as response:
                payload = json.loads(response.read())
        except (urllib.error.URLError, json.JSONDecodeError):
            return []
        return [
            (
                f"{v['name']}  ({v['voice_id']})",
                (v.get("labels") or {}).get("accent", "multi"),
                (v.get("labels") or {}).get("description", ""),
            )
            for v in payload.get("voices", [])
        ]
    return []
