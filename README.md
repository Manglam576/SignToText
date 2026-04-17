# SignToText

> Real-time American Sign Language (ASL) gesture to text conversion using computer vision.

---

## Project Structure

```
/SignToText
│
├── /core              ← ML system (all logic lives here)
│   ├── train_model.py       Entry point to train the CNN
│   ├── predict.py           Prediction module (file or base64 input)
│   ├── server.py            Flask bridge server (website ↔ core)
│   │
│   ├── /utils
│   │   ├── loader.py        Dataset loading via Keras
│   │   └── preprocessing.py Image resize + normalize
│   │
│   └── /model               Created after training
│       ├── saved_model.keras
│       └── class_names.txt
│
├── /website           ← Frontend (zero ML logic)
│   ├── index.html
│   ├── style.css
│   └── script.js
│
├── /dataset           ← ASL images (A–Z folders)
│   ├── A/
│   ├── B/
│   └── ...
│
└── README.md
```

---

## Data Flow

**Training:**
```
/dataset (A–Z folders) → loader.py → preprocessing.py → CNN model → saved_model.keras
```

**Live Prediction:**
```
Webcam frame → browser → Flask /predict → preprocessing.py → model → letter → browser
```

---

## Setup

### 1. Install Dependencies
```bash
pip install tensorflow flask flask-cors pillow numpy
```

### 2. Add Your Dataset
Place ASL Alphabet images inside `/dataset`:
```
/dataset/A/img1.jpg
/dataset/B/img1.jpg
...
```
Each subfolder name becomes a class label. Download from [Kaggle ASL Alphabet Dataset](https://www.kaggle.com/datasets/grassknoted/asl-alphabet).

### 3. Train the Model
```bash
cd SignToText
python3 core/train_model.py
```
The trained model is saved to `core/model/saved_model.keras`.

### 4. Start the Prediction Server
```bash
python3 core/server.py
```
Server runs at `http://127.0.0.1:5000`.

### 5. Open the Website
Open `website/index.html` in your browser and click **Start Camera**.

---

## Rules Followed

- **No database** — predictions are made in-memory by the ML model
- **Strict separation** — zero ML code in `/website`; zero HTML/JS in `/core`
- **No fake features** — the live demo requires the real model and server
# SignToText
