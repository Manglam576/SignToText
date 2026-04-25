"""
server.py
A minimal Flask bridge between the website's webcam feed and the ML prediction engine.

This is the ONLY file that bridges website ↔ core.
All ML logic lives in predict.py — this file only handles HTTP routing.

Usage:
    python3 core/server.py

Endpoints:
    POST /predict         — accepts base64 image, returns predicted letter
    GET  /health          — confirms the server is running
    POST /train           — accepts letter + list of base64 images, starts fine-tune
    GET  /training-status — returns current fine-tune progress (poll this)
"""

import sys
import os
import threading

# Ensure relative imports work from project root
sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask, request, jsonify
from flask_cors import CORS
from predict import predict_from_base64

app = Flask(__name__)
CORS(app)  # Allow requests from the local website file


# ── Prediction endpoints ───────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "running"}), 200


@app.route("/predict", methods=["POST"])
def predict():
    data = request.get_json()

    if not data or "image" not in data:
        return jsonify({"success": False, "error": "No image field in request body"}), 400

    try:
        result = predict_from_base64(data["image"])
        return jsonify(result), 200
    except FileNotFoundError as e:
        return jsonify({"success": False, "error": str(e)}), 503
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ── Personal training endpoints ────────────────────────────────────────────────

_train_lock = threading.Lock()   # prevent two simultaneous training runs


@app.route("/train", methods=["POST"])
def train():
    """
    Body: { "letter": "A", "images": ["<b64>", ...], "username": "Hemant" }

    Launches fine-tuning in a background thread and returns immediately.
    Poll /training-status for progress.
    """
    if not _train_lock.acquire(blocking=False):
        return jsonify({"success": False, "error": "Training already in progress"}), 409

    data = request.get_json()
    if not data:
        _train_lock.release()
        return jsonify({"success": False, "error": "Empty request body"}), 400

    letter   = (data.get("letter")   or "").strip()
    username = (data.get("username") or "anonymous").strip()
    images   = data.get("images", [])

    if not letter:
        _train_lock.release()
        return jsonify({"success": False, "error": "Missing 'letter' field"}), 400

    if not images or len(images) < 5:
        _train_lock.release()
        return jsonify({"success": False, "error": "Need at least 5 images"}), 400

    def _run():
        try:
            from finetune import finetune
            finetune(username, letter, images)
        finally:
            _train_lock.release()

    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"success": True, "message": f"Fine-tuning started for '{letter}'"}), 202


@app.route("/training-status", methods=["GET"])
def training_status():
    """Returns current progress of a running (or last completed) fine-tune."""
    try:
        from finetune import get_status
        return jsonify(get_status()), 200
    except Exception as e:
        return jsonify({"running": False, "progress": 0, "message": str(e), "result": None}), 500


# ── Main ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("[INFO] Starting SignToText inference server on http://127.0.0.1:5000")
    print("[INFO] Press Ctrl+C to stop\n")
    app.run(host="127.0.0.1", port=5000, debug=False)
