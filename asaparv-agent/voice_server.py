#!/usr/bin/env python3.11
"""
voice_server.py — Chatterbox TTS server on port 3002
Loads model ONCE on startup, keeps it in memory for fast inference.
POST /speak  { "text": "...", "output_file": "/tmp/xxx.wav" }
GET  /health
"""
import os, sys, warnings
warnings.filterwarnings("ignore")

from flask import Flask, request, jsonify, send_file
import torchaudio

app = Flask(__name__)

VOICE_SAMPLE = "/Users/chrislovera/asaparv-agent/david-voice.mp3"
AUDIO_DIR    = "/tmp/chatterbox"
os.makedirs(AUDIO_DIR, exist_ok=True)

print("[Voice] Loading Chatterbox model...", flush=True)
from chatterbox.tts import ChatterboxTTS
model = ChatterboxTTS.from_pretrained(device="cpu")
print(f"[Voice] Model ready — sample rate: {model.sr}", flush=True)


@app.post("/speak")
def speak():
    data        = request.get_json(force=True)
    text        = (data.get("text") or "").strip()
    output_file = data.get("output_file") or f"{AUDIO_DIR}/{abs(hash(text))}.wav"

    if not text:
        return jsonify({"error": "text is required"}), 400

    try:
        wav = model.generate(
            text,
            audio_prompt_path=VOICE_SAMPLE,
            exaggeration=0.3,
        )
        # Resample to 16kHz and save as 16-bit PCM (Telnyx compatible)
        import torch
        resampler = torchaudio.transforms.Resample(model.sr, 16000)
        wav_16k   = resampler(wav)
        wav_int16 = (wav_16k * 32767).clamp(-32768, 32767).to(torch.int16)
        torchaudio.save(output_file, wav_int16, 16000, encoding="PCM_S", bits_per_sample=16)
        return jsonify({"file": output_file, "sample_rate": 16000})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/health")
def health():
    return jsonify({"status": "ok", "model": "chatterbox", "voice": "david"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3002, threaded=False)
