"""
train_model.py
Entry point for training the CNN model on the ASL Alphabet dataset.

Usage:
    python3 core/train_model.py

Saves the trained model to: core/model/saved_model.keras
"""

import os
import tensorflow as tf
from utils.loader import load_dataset

# ── Config ────────────────────────────────────────────────────────────────────
EPOCHS = 15
MODEL_SAVE_PATH = os.path.join(os.path.dirname(__file__), "model", "saved_model.keras")

# ── Load Data ─────────────────────────────────────────────────────────────────
print("[INFO] Loading dataset...")
train_ds, val_ds, class_names = load_dataset()
num_classes = len(class_names)
print(f"[INFO] Classes detected: {class_names}")
print(f"[INFO] Total classes: {num_classes}")

# ── Build CNN Model ───────────────────────────────────────────────────────────
model = tf.keras.Sequential([
    tf.keras.layers.Input(shape=(64, 64, 3)),

    # Block 1
    tf.keras.layers.Conv2D(32, (3, 3), activation="relu", padding="same"),
    tf.keras.layers.BatchNormalization(),
    tf.keras.layers.MaxPooling2D(),

    # Block 2
    tf.keras.layers.Conv2D(64, (3, 3), activation="relu", padding="same"),
    tf.keras.layers.BatchNormalization(),
    tf.keras.layers.MaxPooling2D(),

    # Block 3
    tf.keras.layers.Conv2D(128, (3, 3), activation="relu", padding="same"),
    tf.keras.layers.BatchNormalization(),
    tf.keras.layers.MaxPooling2D(),

    # Classifier Head
    tf.keras.layers.GlobalAveragePooling2D(),
    tf.keras.layers.Dense(256, activation="relu"),
    tf.keras.layers.Dropout(0.4),
    tf.keras.layers.Dense(num_classes, activation="softmax"),
])

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
    loss="sparse_categorical_crossentropy",
    metrics=["accuracy"],
)

model.summary()

# ── Train ─────────────────────────────────────────────────────────────────────
print("\n[INFO] Starting training...")
callbacks = [
    tf.keras.callbacks.EarlyStopping(patience=3, restore_best_weights=True),
    tf.keras.callbacks.ReduceLROnPlateau(factor=0.5, patience=2, verbose=1),
]

history = model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=EPOCHS,
    callbacks=callbacks,
)

# ── Evaluate ──────────────────────────────────────────────────────────────────
val_loss, val_acc = model.evaluate(val_ds)
print(f"\n[RESULT] Validation Accuracy: {val_acc * 100:.2f}%")
print(f"[RESULT] Validation Loss:     {val_loss:.4f}")

# ── Save Model ────────────────────────────────────────────────────────────────
os.makedirs(os.path.dirname(MODEL_SAVE_PATH), exist_ok=True)
model.save(MODEL_SAVE_PATH)

# Save class names alongside model for prediction
class_names_path = os.path.join(os.path.dirname(MODEL_SAVE_PATH), "class_names.txt")
with open(class_names_path, "w") as f:
    f.write("\n".join(class_names))

print(f"\n[INFO] Model saved to: {MODEL_SAVE_PATH}")
print(f"[INFO] Class names saved to: {class_names_path}")
