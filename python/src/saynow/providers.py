"""Speech providers: the offline system voice plus cloud backends."""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .catalog import cached_voices, default_voice as catalog_default_voice, voices_for, catalog

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
    "openrouter": {
        "label": "OpenRouter (15+ dedicated speech models)",
        "speaks_directly": False,
        "env_var": "OPENROUTER_API_KEY",
        "config_key": "openrouterApiKey",
    },
}

OPENROUTER_DEFAULT_MODEL = "google/gemini-3.1-flash-tts-preview"

# Speech models that return a bare stream emit 24 kHz mono 16-bit PCM.
PCM_SAMPLE_RATE = 24000
PCM_CHANNELS = 1
PCM_BIT_DEPTH = 16


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


def synthesize_system(
    text: str, voice: Optional[str] = None, rate: Optional[float] = None
) -> Optional[Tuple[bytes, str]]:
    """Render the system voice to a WAV the caller can play itself.

    Not slower than speaking: `say -o` synthesises without playing in real
    time. It exists so the bubble can drive the transcript from the audio's
    own clock rather than a words-per-minute guess.
    """
    import tempfile

    path = Path(tempfile.gettempdir()) / f"saynow-sys-{os.getpid()}.wav"
    try:
        if sys.platform == "darwin":
            cmd = ["say"]
            if voice:
                cmd += ["-v", voice]
            if rate:
                cmd += ["-r", str(int(rate))]
            cmd += ["-o", str(path), "--data-format=LEI16@22050", "--", text]
        elif sys.platform.startswith("linux"):
            binary = "espeak-ng" if shutil.which("espeak-ng") else "espeak"
            cmd = [binary]
            if voice:
                cmd += ["-v", voice]
            if rate:
                cmd += ["-s", str(int(rate))]
            cmd += ["-w", str(path), "--", text]
        else:
            return None

        result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode != 0:
            return None
        data = path.read_bytes()
        return (data, "wav") if len(data) > 44 else None
    except (OSError, ValueError):
        return None
    finally:
        path.unlink(missing_ok=True)


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
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "model": model or "gpt-4o-mini-tts",
        "voice": voice or "alloy",
        "input": text,
        "response_format": "mp3",
    }
    # Only the tts-1 family accepts `speed`; sending it otherwise is a 400.
    if speed and speed != 1:
        body["speed"] = speed

    audio = _post(
        "https://api.openai.com/v1/audio/speech",
        {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        body,
        "OpenAI",
    )
    return {
        "audio": audio,
        "ext": "mp3",
        "model": body["model"],
        "voice": body["voice"],
        "generation_id": None,
    }


def synthesize_elevenlabs(
    text: str,
    api_key: str,
    voice: Optional[str] = None,
    model: Optional[str] = None,
    speed: Optional[float] = None,
) -> Dict[str, Any]:
    voice_id = voice or ELEVENLABS_DEFAULT_VOICE
    body: Dict[str, Any] = {"text": text, "model_id": model or "eleven_turbo_v2_5"}
    if speed and speed != 1:
        body["voice_settings"] = {"speed": speed}

    audio = _post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        {"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        body,
        "ElevenLabs",
    )
    return {
        "audio": audio,
        "ext": "mp3",
        "model": body["model_id"],
        "voice": voice_id,
        "generation_id": None,
    }


def _wav_header(
    data_length: int, rate: int = PCM_SAMPLE_RATE, channels: int = PCM_CHANNELS
) -> bytes:
    byte_rate = rate * channels * PCM_BIT_DEPTH // 8
    return (
        b"RIFF"
        + struct.pack("<I", 36 + data_length)
        + b"WAVEfmt "
        + struct.pack(
            "<IHHIIHH",
            16,  # PCM chunk size
            1,  # format 1 = PCM
            channels,
            rate,
            byte_rate,
            channels * PCM_BIT_DEPTH // 8,
            PCM_BIT_DEPTH,
        )
        + b"data"
        + struct.pack("<I", data_length)
    )


OPENROUTER_SPEECH_ENDPOINT = "https://openrouter.ai/api/v1/audio/speech"

# Speech models are NOT returned by the plain /models listing — that endpoint
# omits the whole speech category. They only appear under this filter.
OPENROUTER_SPEECH_MODELS_URL = (
    "https://openrouter.ai/api/v1/models?output_modalities=speech"
)

# Vendors that reject the provider default and insist on mp3. Taken from their
# own 400 messages; anything not listed is retried when the error names
# response_format.
OPENROUTER_NEEDS_MP3 = {"minimax/speech-2.8-turbo", "minimax/speech-2.8-hd"}

# Shorter than any real utterance; a WAV header alone is 44 bytes.
MIN_AUDIO_BYTES = 512


def openrouter_default_voice(model: str) -> Optional[str]:
    return catalog_default_voice(model)


def _identify(buffer: bytes, content_type: str = "") -> Tuple[bytes, str]:
    """Work out what came back, wrapping bare PCM so it can play.

    The Content-Type is authoritative and carries the sample rate — guessing
    24 kHz for a stream that is not 24 kHz plays it at the wrong pitch.
    """
    kind = (content_type or "").lower()

    if "mpeg" in kind or "mp3" in kind:
        return buffer, "mp3"
    if "wav" in kind:
        return buffer, "wav"
    if "pcm" in kind:
        rate = int(re.search(r"rate=(\d+)", kind).group(1)) if re.search(r"rate=(\d+)", kind) else PCM_SAMPLE_RATE
        channels = int(re.search(r"channels=(\d+)", kind).group(1)) if re.search(r"channels=(\d+)", kind) else PCM_CHANNELS
        return _wav_header(len(buffer), rate, channels) + buffer, "wav"

    if buffer[:4] == b"RIFF":
        return buffer, "wav"
    if buffer[:3] == b"ID3" or (len(buffer) > 1 and buffer[0] == 0xFF and buffer[1] & 0xE0 == 0xE0):
        return buffer, "mp3"
    return _wav_header(len(buffer)) + buffer, "wav"


def _openrouter_request(
    api_key: str, model: str, text: str, voice: str, response_format: Optional[str]
):
    body: Dict[str, Any] = {"model": model, "input": text, "voice": voice}
    if response_format:
        body["response_format"] = response_format
    return urllib.request.Request(
        OPENROUTER_SPEECH_ENDPOINT,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/dhruvyad/saynow",
            "X-Title": "saynow",
        },
        method="POST",
    )


def synthesize_openrouter(
    text: str,
    api_key: str,
    voice: Optional[str] = None,
    model: Optional[str] = None,
    speed: Optional[float] = None,
) -> Dict[str, Any]:
    chosen_model = model or OPENROUTER_DEFAULT_MODEL
    chosen_voice = voice or openrouter_default_voice(chosen_model)

    if not chosen_voice:
        raise SystemExit(
            f'saynow: model "{chosen_model}" needs a voice and OpenRouter '
            "publishes none for it.\nSee what it accepts with: "
            f"saynow voices -p openrouter -m {chosen_model}\n"
            f'Then: saynow -p openrouter -m {chosen_model} -v <voice> "text"'
        )

    # Format support varies sharply: Gemini rejects every value, Deepgram
    # returns WAV unasked, MiniMax and Mistral refuse anything but mp3. Send
    # nothing unless the model is known to demand mp3, and retry once if the
    # rejection names response_format.
    fmt = "mp3" if chosen_model in OPENROUTER_NEEDS_MP3 else None

    for attempt in (fmt, "mp3"):
        try:
            with urllib.request.urlopen(
                _openrouter_request(api_key, chosen_model, text, chosen_voice, attempt)
            ) as response:
                raw = response.read()
                content_type = response.headers.get("content-type", "")
                generation_id = response.headers.get("x-generation-id")
            # A 200 carrying no audio is a failure wearing a success: it
            # would archive 44 bytes of nothing and "play" silence.
            if len(raw) < MIN_AUDIO_BYTES:
                raise SystemExit(
                    f"saynow: {chosen_model} returned no audio ({len(raw)} bytes) "
                    f'for voice "{chosen_voice}".\nThis is usually transient — try '
                    f"again, or a different voice from: saynow voices -p openrouter "
                    f"-m {chosen_model}"
                )

            audio, ext = _identify(raw, content_type)
            return {
                "audio": audio,
                "ext": ext,
                "model": chosen_model,
                "voice": chosen_voice,
                # Lets the caller look up what this cost, without delaying speech.
                "generation_id": generation_id,
            }
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", "replace")[:300]
            if err.code == 400 and "response_format" in detail and attempt != "mp3":
                continue
            if err.code == 401:
                raise SystemExit(
                    "saynow: OpenRouter rejected the API key (401). "
                    "Check it with: saynow config list"
                )
            if err.code == 402:
                raise SystemExit(f"saynow: OpenRouter is out of credit (402). {detail}")
            if err.code == 400:
                raise SystemExit(
                    f"saynow: OpenRouter rejected {chosen_model} with voice "
                    f'"{chosen_voice}" (400). Voice names are vendor-specific — run: '
                    f"saynow voices -p openrouter -m {chosen_model}\n{detail}"
                )
            raise SystemExit(f"saynow: OpenRouter request failed ({err.code}). {detail}")
        except urllib.error.URLError as err:
            raise SystemExit(f"saynow: could not reach OpenRouter: {err.reason}")

    raise SystemExit("saynow: OpenRouter rejected every response format tried.")


def openrouter_lookup_cost(generation_id: str, api_key: str) -> Optional[float]:
    """What one synthesis actually cost, in USD. None if undeterminable."""
    if not generation_id or not api_key:
        return None
    request = urllib.request.Request(
        f"https://openrouter.ai/api/v1/generation?id={urllib.parse.quote(generation_id)}",
        headers={"Authorization": f"Bearer {api_key}"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            data = json.loads(response.read()).get("data") or {}
    except (urllib.error.URLError, json.JSONDecodeError, OSError):
        return None
    cost = data.get("total_cost")
    return float(cost) if isinstance(cost, (int, float)) else None


def openrouter_audio_models() -> List[Dict[str, Any]]:
    """Every OpenRouter model that can synthesise speech, with what it costs."""
    return [
        {
            "id": m["id"],
            "price": m["price"],
            "voices": len(m["voices"]) or len(cached_voices(m["id"])),
            "is_default": m["id"] == OPENROUTER_DEFAULT_MODEL,
        }
        for m in catalog(refresh=True)
    ]


SYNTHESIZERS = {
    "openai": synthesize_openai,
    "elevenlabs": synthesize_elevenlabs,
    "openrouter": synthesize_openrouter,
}



def voices(provider_id: str, api_key: Optional[str] = None, model: Optional[str] = None) -> List[Tuple[str, str, str]]:
    if provider_id == "system":
        return system_voices()
    if provider_id == "openai":
        return [(name, "multi", "") for name in OPENAI_VOICES]
    if provider_id == "openrouter":
        chosen = model or OPENROUTER_DEFAULT_MODEL
        known = voices_for(chosen)
        if not known:
            return [
                (
                    "(none published)",
                    "",
                    f"OpenRouter lists no voices for {chosen} — pass --voice to try one",
                )
            ]
        return [
            (name, chosen.split("/")[0], "default" if i == 0 else "")
            for i, name in enumerate(known)
        ]
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
