"""
preprocessing.py
Handles all image transformations before model input.
Works for both training images (from file) and live prediction (from base64).
"""

import base64
import io
import numpy as np
from PIL import Image

IMG_SIZE = (64, 64)


def load_and_preprocess(image_path: str) -> np.ndarray:
    """
    Load an image from disk, resize and normalize it.
    Returns a float32 numpy array of shape (64, 64, 3).
    """
    img = Image.open(image_path).convert("RGB")
    img = img.resize(IMG_SIZE)
    arr = np.array(img, dtype=np.float32) / 255.0
    return arr


def preprocess_from_base64(base64_string: str) -> np.ndarray:
    """
    Accept a base64-encoded image string (from browser webcam),
    decode it, resize and normalize it.
    Returns a float32 numpy array of shape (1, 64, 64, 3) ready for model.predict().
    """
    # Strip data URI prefix if present (e.g. "data:image/jpeg;base64,...")
    if "," in base64_string:
        base64_string = base64_string.split(",")[1]

    image_bytes = base64.b64decode(base64_string)
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img = img.resize(IMG_SIZE)
    arr = np.array(img, dtype=np.float32) / 255.0
    return np.expand_dims(arr, axis=0)  # shape: (1, 64, 64, 3)
