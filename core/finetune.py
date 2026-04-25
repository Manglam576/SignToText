"""
finetune.py
Fine-tuning the SignToText CNN on user-contributed ASL training data.

Data Layout
-----------
User contributions are stored SEPARATELY from the original ASL dataset:

    core/user_contributions/
        <username>_<timestamp>/
            A/   sample_000.jpg  sample_001.jpg ...
            B/   ...
            metadata.json   { username, timestamp, letter_counts, asl_standard: True }

    dataset/
        asl_alphabet_train/   ← ORIGINAL data, never modified
        asl_alphabet_test/    ← ORIGINAL data, never modified

The fine-tune process:
  1. Freeze all Conv / BatchNorm / MaxPool layers (feature extractor).
  2. Unfreeze GlobalAveragePooling + Dense head only.
  3. Build dataset from user contributions + a balanced sample of original data
     (prevents catastrophic forgetting of letters not contributed).
  4. Train up to MAX_EPOCHS with early stopping.
  5. Overwrite saved_model.keras and signal predict.py to reload.
"""

import os
import io
import json
import base64
import datetime
import numpy as np
import tensorflow as tf
from PIL import Image

# ── Paths ─────────────────────────────────────────────────────────────────────
_CORE_DIR        = os.path.dirname(__file__)
_PROJECT_DIR     = os.path.dirname(_CORE_DIR)
MODEL_PATH       = os.path.join(_CORE_DIR, "model", "saved_model.keras")
CLASS_NAMES_PATH = os.path.join(_CORE_DIR, "model", "class_names.txt")

# User contributions go here — clearly separated from original ASL dataset
CONTRIB_DIR      = os.path.join(_CORE_DIR, "user_contributions")

# Original ASL dataset (read-only, never written to)
ORIG_TRAIN_DIR   = os.path.join(_PROJECT_DIR, "dataset", "asl_alphabet_train")

IMG_SIZE    = 64
BATCH_SIZE  = 8
MAX_EPOCHS  = 12
LR          = 1e-4
PATIENCE    = 3

# How many original-dataset images to mix in per class (prevents forgetting)
ORIG_SAMPLE_PER_CLASS = 30

# ── Augmentation ──────────────────────────────────────────────────────────────
_augment = tf.keras.Sequential([
    tf.keras.layers.RandomFlip("horizontal"),
    tf.keras.layers.RandomRotation(0.12),
    tf.keras.layers.RandomZoom(0.12),
    tf.keras.layers.RandomBrightness(0.20),
    tf.keras.layers.RandomContrast(0.25),
    tf.keras.layers.RandomTranslation(0.08, 0.08),
], name="augment")

# ── Status (thread-safe enough for single-user local server) ──────────────────
_status = {"running": False, "progress": 0, "message": "idle", "result": None}


def get_status() -> dict:
    return dict(_status)


# ── Image helpers ─────────────────────────────────────────────────────────────

def _load_image(path: str) -> np.ndarray:
    img = Image.open(path).convert("RGB").resize((IMG_SIZE, IMG_SIZE))
    return np.array(img, dtype=np.float32) / 255.0


def save_contribution(username: str, letter: str, b64_images: list[str]) -> str:
    """
    Persist a batch of base64 webcam captures to disk under user_contributions/.

    Returns the session directory path.

    Directory structure:
        core/user_contributions/<username>_<YYYYMMDD_HHMMSS>/<letter>/sample_NNN.jpg
        core/user_contributions/<username>_<YYYYMMDD_HHMMSS>/metadata.json
    """
    ts  = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    tag = f"{username}_{ts}"
    session_dir = os.path.join(CONTRIB_DIR, tag)
    letter_dir  = os.path.join(session_dir, letter)
    os.makedirs(letter_dir, exist_ok=True)

    saved = []
    for i, b64 in enumerate(b64_images):
        raw = b64.split(",", 1)[1] if "," in b64 else b64
        img = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB").resize((IMG_SIZE, IMG_SIZE))
        dest = os.path.join(letter_dir, f"sample_{i:03d}.jpg")
        img.save(dest, "JPEG", quality=92)
        saved.append(dest)

    # Write metadata so sessions are clearly identifiable
    meta = {
        "username":    username,
        "timestamp":   ts,
        "letter":      letter,
        "sample_count": len(saved),
        "asl_standard": True,          # user attests they followed ASL guidelines
        "source":      "user_contribution",
        "note":        "Separate from original asl_alphabet_train dataset",
    }
    with open(os.path.join(session_dir, "metadata.json"), "w") as f:
        json.dump(meta, f, indent=2)

    return session_dir


# ── Fine-tune ─────────────────────────────────────────────────────────────────

def finetune(username: str, letter: str, b64_images: list[str]) -> dict:
    """
    Save user images then fine-tune the Dense head of the model.

    Parameters
    ----------
    username   : display name from the sign-in (used for folder naming only)
    letter     : ASL class label being improved (e.g. "A", "space", "del")
    b64_images : list of base64-encoded JPEG strings

    Returns
    -------
    dict  { success, accuracy, epochs_run, samples, message }
    """
    global _status
    _status = {"running": True, "progress": 0, "message": "Saving samples…", "result": None}

    try:
        # 1 ── Save contributions (separate from original dataset) ─────────────
        session_dir = save_contribution(username, letter, b64_images)
        n_saved = len(b64_images)
        _status.update(progress=10, message=f"Saved {n_saved} samples for '{letter}'. Loading model…")

        # 2 ── Load model + class names ────────────────────────────────────────
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                f"No trained model at {MODEL_PATH}. Run python3 core/train_model.py first."
            )
        model = tf.keras.models.load_model(MODEL_PATH)
        with open(CLASS_NAMES_PATH) as f:
            class_names = [l.strip() for l in f]
        if letter not in class_names:
            raise ValueError(f"Letter '{letter}' not found in class_names: {class_names}")
        target_idx  = class_names.index(letter)
        num_classes = len(class_names)

        _status.update(progress=20, message="Freezing conv layers, unfreezing Dense head…")

        # 3 ── Freeze feature extractor ────────────────────────────────────────
        for layer in model.layers:
            layer.trainable = False
        unfreeze = False
        for layer in model.layers:
            if isinstance(layer, tf.keras.layers.GlobalAveragePooling2D):
                unfreeze = True
            if unfreeze:
                layer.trainable = True

        model.compile(
            optimizer=tf.keras.optimizers.Adam(learning_rate=LR),
            loss="sparse_categorical_crossentropy",
            metrics=["accuracy"],
        )

        _status.update(progress=30, message="Building dataset (user + original samples)…")

        # 4 ── Build dataset ───────────────────────────────────────────────────
        # User images for the target letter (from just-saved session)
        letter_dir  = os.path.join(session_dir, letter)
        user_paths  = [os.path.join(letter_dir, f)
                       for f in os.listdir(letter_dir) if f.endswith(".jpg")]
        user_imgs   = np.array([_load_image(p) for p in user_paths], dtype=np.float32)
        user_labels = np.full(len(user_imgs), target_idx, dtype=np.int32)

        # Also pull from previously contributed sessions for this letter
        extra_imgs, extra_labels = [], []
        for session in os.listdir(CONTRIB_DIR):
            s_letter_dir = os.path.join(CONTRIB_DIR, session, letter)
            if s_letter_dir == letter_dir or not os.path.isdir(s_letter_dir):
                continue
            for fn in os.listdir(s_letter_dir):
                if fn.endswith(".jpg"):
                    extra_imgs.append(_load_image(os.path.join(s_letter_dir, fn)))
                    extra_labels.append(target_idx)

        # Balance with samples from the ORIGINAL ASL dataset (read-only)
        orig_imgs, orig_labels = [], []
        for cls in class_names:
            orig_cls_dir = os.path.join(ORIG_TRAIN_DIR, cls)
            if not os.path.isdir(orig_cls_dir):
                continue
            files = [f for f in os.listdir(orig_cls_dir)
                     if f.lower().endswith((".jpg", ".jpeg", ".png"))]
            np.random.shuffle(files)
            for fn in files[:ORIG_SAMPLE_PER_CLASS]:
                try:
                    orig_imgs.append(_load_image(os.path.join(orig_cls_dir, fn)))
                    orig_labels.append(class_names.index(cls))
                except Exception:
                    pass

        # Combine: user + extra contributions + original samples
        all_imgs   = np.concatenate([user_imgs] +
                                     ([np.array(extra_imgs)] if extra_imgs else []) +
                                     ([np.array(orig_imgs)]  if orig_imgs  else []))
        all_labels = np.concatenate([user_labels] +
                                     ([np.array(extra_labels)] if extra_labels else []) +
                                     ([np.array(orig_labels)]  if orig_labels  else []))

        # Shuffle and split 80/20
        perm = np.random.permutation(len(all_imgs))
        all_imgs, all_labels = all_imgs[perm], all_labels[perm]
        split = max(1, int(len(all_imgs) * 0.8))
        x_tr, x_val = all_imgs[:split], all_imgs[split:]
        y_tr, y_val = all_labels[:split], all_labels[split:]

        def make_ds(x, y, augment=False):
            ds = tf.data.Dataset.from_tensor_slices((x, y))
            if augment:
                ds = ds.map(lambda img, lbl: (_augment(img, training=True), lbl),
                            num_parallel_calls=tf.data.AUTOTUNE)
            return ds.shuffle(512).batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)

        train_ds = make_ds(x_tr, y_tr, augment=True)
        val_ds   = make_ds(x_val, y_val, augment=False)

        _status.update(progress=40, message="Training Dense head…")

        # 5 ── Train ───────────────────────────────────────────────────────────
        history = model.fit(
            train_ds,
            validation_data=val_ds,
            epochs=MAX_EPOCHS,
            callbacks=[
                tf.keras.callbacks.EarlyStopping(
                    patience=PATIENCE, restore_best_weights=True, monitor="val_accuracy"
                ),
                _ProgressCallback(),
            ],
            verbose=0,
        )

        epochs_run = len(history.history["loss"])
        val_acc    = float(history.history.get("val_accuracy", [0])[-1])

        _status.update(progress=90, message="Saving model…")

        # 6 ── Save & reload singleton ─────────────────────────────────────────
        model.save(MODEL_PATH)
        _reload_predict_singleton()

        result = {
            "success":    True,
            "accuracy":   round(val_acc * 100, 1),
            "epochs_run": epochs_run,
            "samples":    n_saved,
            "message":    (f"Trained on {n_saved} user samples + "
                           f"{len(orig_imgs)} original ASL samples for '{letter}' · "
                           f"val acc {val_acc*100:.1f}%"),
        }
        _status = {"running": False, "progress": 100, "message": "Done!", "result": result}
        return result

    except Exception as exc:
        err = {"success": False, "message": str(exc)}
        _status = {"running": False, "progress": 0, "message": str(exc), "result": err}
        return err


# ── Helpers ───────────────────────────────────────────────────────────────────

class _ProgressCallback(tf.keras.callbacks.Callback):
    def on_epoch_end(self, epoch, logs=None):
        pct = 40 + int((epoch + 1) / MAX_EPOCHS * 50)
        acc = (logs or {}).get("val_accuracy", 0)
        _status["progress"] = pct
        _status["message"]  = f"Epoch {epoch+1}/{MAX_EPOCHS} — val acc {acc*100:.1f}%"


def _reload_predict_singleton():
    try:
        import predict as _p
        _p._model = None
        _p._class_names = None
    except Exception:
        pass
