"""
predict.py
Loads the trained model and predicts a letter from an image.

Data Flow:
    Image → Preprocess → Load Model → Predict → Output letter + confidence

Usage (CLI):
    python3 core/predict.py path/to/image.jpg
"""

import os
import sys
import numpy as np
import tensorflow as tf
from utils.preprocessing import load_and_preprocess, preprocess_from_base64

# ── Paths ─────────────────────────────────────────────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(__file__), "model", "saved_model.keras")
CLASS_NAMES_PATH = os.path.join(os.path.dirname(__file__), "model", "class_names.txt")

# ── Singleton Model Load ──────────────────────────────────────────────────────
# Model is loaded once into memory to avoid repeated disk reads during real-time use
_model = None
_class_names = None


def _get_model():
    global _model, _class_names
    if _model is None:
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                f"[ERROR] No trained model found at: {MODEL_PATH}\n"
                "Please run: python3 core/train_model.py"
            )
        _model = tf.keras.models.load_model(MODEL_PATH)

        with open(CLASS_NAMES_PATH, "r") as f:
            _class_names = [line.strip() for line in f.readlines()]

    return _model, _class_names


def predict_from_file(image_path: str) -> dict:
    """
    Predict letter from a local image file.
    Returns: { 'prediction': 'A', 'confidence': 98.2 }
    """
    model, class_names = _get_model()
    img = load_and_preprocess(image_path)
    img = np.expand_dims(img, axis=0)  # shape: (1, 64, 64, 3)

    predictions = model.predict(img, verbose=0)
    class_idx = np.argmax(predictions[0])
    confidence = float(np.max(predictions[0])) * 100

    return {
        "prediction": class_names[class_idx],
        "confidence": round(confidence, 2),
        "success": True,
    }


def predict_from_base64(base64_string: str) -> dict:
    """
    Predict letter from a base64-encoded image (used by the Flask server
    to process webcam frames from the browser).
    Returns: { 'prediction': 'A', 'confidence': 98.2 }
    """
    model, class_names = _get_model()
    img = preprocess_from_base64(base64_string)  # shape: (1, 64, 64, 3)

    predictions = model.predict(img, verbose=0)
    class_idx = np.argmax(predictions[0])
    confidence = float(np.max(predictions[0])) * 100

    return {
        "prediction": class_names[class_idx],
        "confidence": round(confidence, 2),
        "success": True,
    }


# ── CLI Usage ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 core/predict.py <image_path>")
        sys.exit(1)

    image_path = sys.argv[1]
    result = predict_from_file(image_path)
    print(f"\nPrediction : {result['prediction']}")
    print(f"Confidence : {result['confidence']}%")
