"""
loader.py
Loads the ASL dataset from /dataset using Keras's image_dataset_from_directory.

Dataset structure (from archive.zip extraction):
  dataset/
  └── asl_alphabet_train/
      └── asl_alphabet_train/
          ├── A/   (3000 images)
          ├── B/   (3000 images)
          ...
          ├── Z/
          ├── del/
          ├── nothing/
          └── space/         ← 29 classes total
"""

import tensorflow as tf
import os

IMG_SIZE = (64, 64)
BATCH_SIZE = 32

# The zip extracts with a nested folder: dataset/asl_alphabet_train/asl_alphabet_train/
DATASET_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "dataset",
    "asl_alphabet_train", "asl_alphabet_train"
)


def load_dataset(validation_split: float = 0.2):
    """
    Loads training and validation datasets from disk.
    Returns:
        train_ds: tf.data.Dataset
        val_ds:   tf.data.Dataset
        class_names: list of string labels (e.g. ['A', 'B', ..., 'Z'])
    """
    train_ds = tf.keras.utils.image_dataset_from_directory(
        DATASET_PATH,
        validation_split=validation_split,
        subset="training",
        seed=42,
        image_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
    )
    val_ds = tf.keras.utils.image_dataset_from_directory(
        DATASET_PATH,
        validation_split=validation_split,
        subset="validation",
        seed=42,
        image_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
    )

    class_names = train_ds.class_names

    # Normalize pixel values [0, 1], cache in memory, and prefetch for performance
    normalization_layer = tf.keras.layers.Rescaling(1.0 / 255)
    train_ds = train_ds.map(lambda x, y: (normalization_layer(x), y)).cache().prefetch(tf.data.AUTOTUNE)
    val_ds = val_ds.map(lambda x, y: (normalization_layer(x), y)).cache().prefetch(tf.data.AUTOTUNE)

    return train_ds, val_ds, class_names
