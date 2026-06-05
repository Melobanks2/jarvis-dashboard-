#!/usr/bin/env python3.11
"""
listen_server.py — Whisper STT server on port 3003
Loads Whisper base model once on startup.
POST /transcribe  multipart: audio=<file>
GET  /health
"""
import os, warnings
warnings.filterwarnings("ignore")

from flask import Flask, request, jsonify
import whisper
import tempfile

app = Flask(__name__)

print("[Listen] Loading Whisper base model...", flush=True)
model = whisper.load_model("base")
print("[Listen] Whisper ready", flush=True)


@app.post("/transcribe")
def transcribe():
    if "audio" not in request.files:
        return jsonify({"error": "audio file required"}), 400

    audio_file = request.files["audio"]
    suffix = os.path.splitext(audio_file.filename or ".wav")[1] or ".wav"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name

    try:
        result = model.transcribe(tmp_path)
        return jsonify({"text": result["text"].strip()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp_path)


@app.get("/health")
def health():
    return jsonify({"status": "ok", "model": "whisper-base"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3003, threaded=False)
