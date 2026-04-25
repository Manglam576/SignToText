/**
 * script.js — SignToText Website
 *
 * Fixes applied vs original:
 *  #1  Focus trap in auth modal (Tab / Shift+Tab cycle, Escape closes)
 *  #2  Camera denial → inline error, no alert()
 *  #3  isFetching guard prevents overlapping fetch calls
 *  #4  pred-badge display managed consistently via CSS + JS (no inline style race)
 *  #5  Elements already in viewport on load are marked no-anim immediately
 *  #6  Copy button shows checkmark with smooth transition, restores after 2s
 *  #7  Password min-length validation in auth modal
 *  #8  Handled in CSS (.btn-sm min-height: 44px)
 *  #9  Handled in CSS (#pipe-info-box min-height: 56px)
 *  #10 Loading spinner shown between camera start and first prediction
 *
 * Recognition fixes (v2):
 *  #R1 Canvas draw is horizontally flipped to match the mirrored webcam display
 *  #R2 Only the centred hand ROI is cropped and sent (not the full frame)
 *  #R3 Confidence threshold raised from 60% → 75%
 *  #R4 Temporal smoothing: letter appended only after 3 consecutive matching frames
 *  #R5 ROI guide overlay drawn on canvas so user knows where to place their hand
 */

(function () {
  "use strict";

  /* ─────────────────────────────────────────────────────────
     1. Scroll Reveal (Fix #5 — no flicker for in-viewport els)
  ──────────────────────────────────────────────────────────── */
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          revealObserver.unobserve(e.target); // only reveal once
        }
      });
    },
    { threshold: 0.10 }
  );

  // Wait one frame so layout is complete, then mark already-visible elements
  requestAnimationFrame(() => {
    document.querySelectorAll("section, .roadmap-card, .pipe-step, .story-card").forEach(el => {
      el.classList.add("reveal");
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        // Already visible on load — skip animation to prevent flicker (Fix #5)
        el.classList.add("no-anim");
      } else {
        revealObserver.observe(el);
      }
    });
  });


  /* ─────────────────────────────────────────────────────────
     2. Sticky Nav Shadow
  ──────────────────────────────────────────────────────────── */
  const $navbar = document.getElementById("navbar");
  window.addEventListener("scroll", () => {
    $navbar.classList.toggle("scrolled", window.scrollY > 10);
  }, { passive: true });


  /* ─────────────────────────────────────────────────────────
     3. Auth Modal (Fixes #1, #7)
  ──────────────────────────────────────────────────────────── */
  const STORAGE_KEY = "stt_user";

  const $modal      = document.getElementById("auth-modal");
  const $btnOpen    = document.getElementById("btn-open-auth");
  const $btnClose   = document.getElementById("btn-close-modal");
  const $btnSubmit  = document.getElementById("btn-auth-submit");
  const $btnLogout  = document.getElementById("btn-logout");
  const $navUser    = document.getElementById("nav-user");
  const $authName   = document.getElementById("auth-name");
  const $authPass   = document.getElementById("auth-pass");
  const $modalError = document.getElementById("modal-error");

  function showModalError(msg) {
    $modalError.textContent = msg;
    $modalError.classList.add("visible");
  }

  function clearModalError() {
    $modalError.textContent = "";
    $modalError.classList.remove("visible");
  }

  function refreshAuthUI() {
    const user = localStorage.getItem(STORAGE_KEY);
    if (user) {
      $navUser.textContent = `Hello, ${user}`;
      $btnOpen.style.display   = "none";
      $btnLogout.style.display = "inline-flex";
    } else {
      $navUser.textContent = "";
      $btnOpen.style.display   = "inline-flex";
      $btnLogout.style.display = "none";
    }
  }

  function openModal() {
    clearModalError();
    $authName.value = "";
    $authPass.value = "";
    $modal.style.display = "flex";
    document.body.style.overflow = "hidden";
    // Small delay so display transition completes before focus
    setTimeout(() => $authName.focus(), 50);
  }

  function closeModal() {
    $modal.style.display = "none";
    document.body.style.overflow = "";
    $btnOpen.focus();
  }

  $btnOpen.addEventListener("click",  openModal);
  $btnClose.addEventListener("click", closeModal);

  // Click backdrop to close
  $modal.addEventListener("click", e => { if (e.target === $modal) closeModal(); });

  // Fix #1 — Focus trap: keep Tab / Shift+Tab inside modal
  $modal.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeModal(); return; }
    if (e.key !== "Tab") return;

    const focusable = Array.from(
      $modal.querySelectorAll("button, input, [tabindex]:not([tabindex='-1'])")
    ).filter(el => !el.disabled && el.offsetParent !== null);

    if (!focusable.length) { e.preventDefault(); return; }

    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
  });

  // Fix #7 — Validate both name and password
  $btnSubmit.addEventListener("click", () => {
    const name = $authName.value.trim();
    const pass = $authPass.value;
    clearModalError();

    if (!name) {
      showModalError("Please enter your display name.");
      $authName.focus();
      return;
    }
    if (pass.length < 6) {
      showModalError("Password must be at least 6 characters.");
      $authPass.focus();
      return;
    }

    localStorage.setItem(STORAGE_KEY, name);
    refreshAuthUI();
    closeModal();
  });

  $btnLogout.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    refreshAuthUI();
  });

  // Enter key submits from any field
  [$authName, $authPass].forEach(el => {
    el.addEventListener("keydown", e => { if (e.key === "Enter") $btnSubmit.click(); });
  });

  refreshAuthUI();


  /* ─────────────────────────────────────────────────────────
     4. Pipeline Step Tooltips
  ──────────────────────────────────────────────────────────── */
  const $pipeInfo = document.getElementById("pipe-info-box");
  document.querySelectorAll(".pipe-step").forEach(step => {
    step.addEventListener("mouseenter", () => {
      $pipeInfo.textContent = step.dataset.info || "";
      document.querySelectorAll(".pipe-step").forEach(s => s.classList.remove("active"));
      step.classList.add("active");
    });
    step.addEventListener("mouseleave", () => {
      step.classList.remove("active");
      $pipeInfo.textContent = "Hover a step to learn more.";
    });
  });


  /* ─────────────────────────────────────────────────────────
     5. Live Webcam & Prediction (Fixes #2, #3, #4, #10)
  ──────────────────────────────────────────────────────────── */
  const SERVER = "http://127.0.0.1:5000";

  const $webcam        = document.getElementById("webcam");
  const $snapshot      = document.getElementById("snapshot");
  const $camIdle       = document.getElementById("cam-idle");
  const $camLoading    = document.getElementById("cam-loading");
  const $cameraWrap    = document.getElementById("camera-wrap");
  const $predBadge     = document.getElementById("pred-badge");
  const $currentLetter = document.getElementById("current-letter");
  const $outputBox     = document.getElementById("output-box");
  const $statusNote    = document.getElementById("status-note");
  const $btnStart      = document.getElementById("btn-start");
  const $btnStop       = document.getElementById("btn-stop");
  const $btnClear      = document.getElementById("btn-clear");
  const $btnCopy       = document.getElementById("btn-copy");

  // Confidence meter + stability dots
  const $confFill   = document.getElementById("confidence-fill");
  const $confPct    = document.getElementById("confidence-pct");
  const $stabDots   = [0,1,2].map(i => document.getElementById(`stab-dot-${i}`));

  // Hand tracking
  const $handOverlay  = document.getElementById("hand-overlay");
  const $handBadge    = document.getElementById("hand-badge");
  const $handBadgeTxt = document.getElementById("hand-badge-text");
  const $roiGuide     = document.getElementById("roi-guide");

  // Stores the latest hand bounding-box from MediaPipe { x, y, w, h } in pixels
  // relative to the raw (un-mirrored) video frame. null = no hand detected.
  let latestHandBbox = null;

  let mediaStream    = null;
  let inferenceTimer = null;
  let lastLetter     = null;
  let isFetching     = false;   // Fix #3
  let firstPrediction = true;   // Fix #10

  // Fix #R4 — temporal smoothing: track consecutive identical predictions
  let smoothingBuffer = [];     // stores last N raw predictions
  const SMOOTH_WINDOW = 3;      // require 3 consecutive matching frames
  const CONFIDENCE_THRESHOLD = 75;  // Fix #R3 — raised from 60 → 75

  // Fix #R2 — ROI: fraction of the frame (centred square) sent to model
  // 0.55 means a 55%-width square in the centre of the video frame
  const ROI_FRACTION = 0.55;

  /* Start camera */
  $btnStart.addEventListener("click", async () => {
    // Fix #2 — no alert(), show inline error on denial
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    } catch (err) {
      setStatus("Camera access denied. Please allow camera permissions and try again.", true);
      return;
    }

    $webcam.srcObject = mediaStream;
    $webcam.style.display = "block";
    $camIdle.style.display = "none";

    // Fix #10 — show loading spinner while awaiting first prediction
    firstPrediction = true;
    $camLoading.classList.add("active");
    $predBadge.style.display = "none";  // hide until first prediction (Fix #4)
    $cameraWrap.classList.add("active");

    // Verify server is reachable
    try {
      const r = await fetch(`${SERVER}/health`);
      if (r.ok) {
        setStatus("Connected to prediction server.", false);
      } else {
        setStatus("Server error. Run: python3 core/server.py", true);
      }
    } catch {
      setStatus("⚠ Server offline. Run: python3 core/server.py", true);
    }

    clearOutputBox();

    $btnStart.style.display = "none";
    $btnStop.style.display  = "inline-flex";

    inferenceTimer = setInterval(captureAndPredict, 1500);
  });

  /* Stop camera */
  $btnStop.addEventListener("click", stopCamera);

  function stopCamera() {
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    clearInterval(inferenceTimer); inferenceTimer = null;
    isFetching = false;
    smoothingBuffer = [];  // Fix #R4 — clear smoothing state on stop
    latestHandBbox  = null;

    $webcam.srcObject  = null;
    $webcam.style.display = "none";
    $camIdle.style.display = "flex";
    $camLoading.classList.remove("active");
    $predBadge.style.display = "none";  // Fix #4 — consistent hide on stop
    $cameraWrap.classList.remove("active");

    // Reset hand badge
    $handBadge.classList.remove("detected");
    $handBadgeTxt.textContent = "Scanning\u2026";
    $roiGuide.style.display = "";

    // Clear overlay canvas
    const octx = $handOverlay.getContext("2d");
    octx.clearRect(0, 0, $handOverlay.width, $handOverlay.height);

    $btnStart.style.display = "inline-flex";
    $btnStop.style.display  = "none";
    $currentLetter.textContent = "?";
    lastLetter = null;
    firstPrediction = true;

    setStatus("Requires <code>python3 core/server.py</code> to be running.", false);
  }


  /* ─────────────────────────────────────────────────────────
     5b. MediaPipe Hands — real-time hand detection & skeleton
  ──────────────────────────────────────────────────────────── */

  let mpHands    = null;   // MediaPipe Hands instance
  let mpCamera   = null;   // MediaPipe Camera utility
  const HAND_PAD = 0.18;  // fractional padding around detected bbox

  function initMediaPipe() {
    if (typeof Hands === "undefined") {
      console.warn("[HandTrack] MediaPipe Hands CDN not loaded — falling back to centre ROI.");
      return;
    }

    mpHands = new Hands({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
    });

    mpHands.setOptions({
      maxNumHands:            1,
      modelComplexity:        0,   // lite model — fast enough for real-time
      minDetectionConfidence: 0.55,
      minTrackingConfidence:  0.50,
    });

    mpHands.onResults(onHandResults);
  }

  function startHandTracking() {
    if (!mpHands || typeof Camera === "undefined") return;

    mpCamera = new Camera($webcam, {
      onFrame: async () => {
        if (mpHands && $webcam.readyState >= 2) {
          await mpHands.send({ image: $webcam });
        }
      },
      width: 640,
      height: 480,
    });
    mpCamera.start();
  }

  function stopHandTracking() {
    if (mpCamera) { mpCamera.stop(); mpCamera = null; }
    latestHandBbox = null;
  }

  function onHandResults(results) {
    // Size the overlay canvas to the displayed video
    $handOverlay.width  = $cameraWrap.offsetWidth;
    $handOverlay.height = $cameraWrap.offsetHeight;
    const octx = $handOverlay.getContext("2d");
    octx.clearRect(0, 0, $handOverlay.width, $handOverlay.height);

    const landmarks = results.multiHandLandmarks && results.multiHandLandmarks[0];

    if (!landmarks || landmarks.length === 0) {
      latestHandBbox = null;
      $handBadge.classList.remove("detected");
      $handBadgeTxt.textContent = "Scanning\u2026";
      $roiGuide.style.display = "";          // show fallback ROI box
      return;
    }

    // Hand detected — compute pixel bbox from normalised landmarks
    const vw = $webcam.videoWidth  || 640;
    const vh = $webcam.videoHeight || 480;

    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    landmarks.forEach(lm => {
      if (lm.x < minX) minX = lm.x;
      if (lm.y < minY) minY = lm.y;
      if (lm.x > maxX) maxX = lm.x;
      if (lm.y > maxY) maxY = lm.y;
    });

    // Add padding
    const padX = (maxX - minX) * HAND_PAD;
    const padY = (maxY - minY) * HAND_PAD;
    minX = Math.max(0, minX - padX);
    minY = Math.max(0, minY - padY);
    maxX = Math.min(1, maxX + padX);
    maxY = Math.min(1, maxY + padY);

    latestHandBbox = {
      x: Math.floor(minX * vw),
      y: Math.floor(minY * vh),
      w: Math.floor((maxX - minX) * vw),
      h: Math.floor((maxY - minY) * vh),
    };

    // Hide the static ROI guide — hand tracking takes over
    $roiGuide.style.display = "none";

    // Update badge
    $handBadge.classList.add("detected");
    $handBadgeTxt.textContent = "Hand Detected";

    // Draw skeleton on overlay canvas
    // The video is CSS-mirrored (scaleX(-1)) so we mirror the canvas too
    const cw = $handOverlay.width;
    const ch = $handOverlay.height;

    octx.save();
    octx.translate(cw, 0);
    octx.scale(-1, 1);

    if (typeof drawConnectors !== "undefined" && typeof drawLandmarks !== "undefined") {
      // Draw connectors (skeleton lines)
      drawConnectors(octx, landmarks, HAND_CONNECTIONS, {
        color: "rgba(124,108,255,0.55)",
        lineWidth: 2,
      });
      // Draw landmark dots
      drawLandmarks(octx, landmarks, {
        color: "rgba(192,132,252,0.9)",
        lineWidth: 1,
        radius: 3,
      });
    }

    // Draw bounding box in display coords
    const bx = minX * cw;
    const by = minY * ch;
    const bw = (maxX - minX) * cw;
    const bh = (maxY - minY) * ch;
    octx.strokeStyle = "rgba(34,211,160,0.75)";
    octx.lineWidth   = 2;
    octx.setLineDash([6, 4]);
    octx.strokeRect(bx, by, bw, bh);
    octx.setLineDash([]);

    octx.restore();
  }

  // Hook into camera start/stop
  const _origBtnStart = $btnStart;
  $btnStart.addEventListener("click", () => {
    // initMediaPipe is idempotent; call once
    if (!mpHands) initMediaPipe();
    // Give the webcam 800ms to actually produce frames before MediaPipe starts
    setTimeout(startHandTracking, 800);
  });

  $btnStop.addEventListener("click", stopHandTracking);

  // Init MediaPipe early so WASM downloads in background
  initMediaPipe();

  /* Clear output */
  $btnClear.addEventListener("click", () => { clearOutputBox(); lastLetter = null; });

  /* Copy with checkmark animation (Fix #6) */
  $btnCopy.addEventListener("click", () => {
    const text = $outputBox.dataset.text || "";
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
      const originalHTML = $btnCopy.innerHTML;
      $btnCopy.innerHTML = "✓";
      $btnCopy.style.color = "var(--green)";
      $btnCopy.style.borderColor = "var(--green)";
      setTimeout(() => {
        $btnCopy.innerHTML = originalHTML;
        $btnCopy.style.color = "";
        $btnCopy.style.borderColor = "";
      }, 2000);
    }).catch(() => {
      setStatus("Clipboard copy failed. Please copy manually.", true);
    });
  });

  /* Capture frame and send to server — Fix #3: isFetching guard */
  async function captureAndPredict() {
    if (!mediaStream || isFetching) return;
    isFetching = true;

    const vw = $webcam.videoWidth  || 320;
    const vh = $webcam.videoHeight || 240;

    let srcX, srcY, srcSize;

    if (latestHandBbox) {
      // ── Hand tracking mode: crop tightly to detected hand ──────────────
      // latestHandBbox is in mirrored-video coords; mirror X back for raw frame
      const pad  = Math.floor(latestHandBbox.w * 0.20);  // 20% padding
      const bx   = Math.max(0, latestHandBbox.x - pad);
      const by   = Math.max(0, latestHandBbox.y - pad);
      const bw   = Math.min(vw - bx, latestHandBbox.w + pad * 2);
      const bh   = Math.min(vh - by, latestHandBbox.h + pad * 2);
      srcSize    = Math.min(bw, bh);          // square crop
      srcX       = bx;
      srcY       = by;
    } else {
      // ── Fallback: fixed centre ROI (original behaviour) ─────────────────
      srcSize = Math.floor(Math.min(vw, vh) * ROI_FRACTION);
      srcX    = Math.floor((vw - srcSize) / 2);
      srcY    = Math.floor((vh - srcSize) / 2);
    }

    $snapshot.width  = srcSize;
    $snapshot.height = srcSize;

    const ctx = $snapshot.getContext("2d");
    // Fix #R1 — mirror horizontally to match mirrored video display
    ctx.save();
    ctx.translate(srcSize, 0);
    ctx.scale(-1, 1);
    ctx.drawImage($webcam, srcX, srcY, srcSize, srcSize, 0, 0, srcSize, srcSize);
    ctx.restore();

    const b64 = $snapshot.toDataURL("image/jpeg", 0.85);

    try {
      const res = await fetch(`${SERVER}/predict`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ image: b64 }),
      });

      if (!res.ok) { setStatus("Server error. Check server logs.", true); return; }

      const data = await res.json();

      // Fix #10 — hide spinner and show badge on first successful prediction
      if (firstPrediction) {
        firstPrediction = false;
        $camLoading.classList.remove("active");
        $predBadge.style.display = "flex";  // Fix #4
      }

      // Fix #R3 — raised confidence threshold
      if (data.success && data.confidence > CONFIDENCE_THRESHOLD) {
        // Update confidence meter
        $confFill.style.width = data.confidence.toFixed(1) + "%";
        $confFill.className   = data.confidence >= CONFIDENCE_THRESHOLD ? "high" : "low";
        $confPct.textContent  = data.confidence.toFixed(1) + "%";

        // Fix #R4 — temporal smoothing
        smoothingBuffer.push(data.prediction);
        if (smoothingBuffer.length > SMOOTH_WINDOW) smoothingBuffer.shift();

        // Update stability dots
        $stabDots.forEach((dot, i) => {
          dot.className = "stab-dot";
          if (i < smoothingBuffer.length) {
            const allSame = smoothingBuffer.every(l => l === smoothingBuffer[0]);
            dot.classList.add(smoothingBuffer.length === SMOOTH_WINDOW && allSame ? "locked" : "filled");
          }
        });

        const allMatch = smoothingBuffer.length === SMOOTH_WINDOW &&
                         smoothingBuffer.every(l => l === smoothingBuffer[0]);

        if (allMatch) {
          applyPrediction(smoothingBuffer[0], data.confidence);
        } else {
          $currentLetter.textContent = data.prediction;
        }
        setStatus(`Connected · confidence ${data.confidence.toFixed(1)}%`, false, true);
      } else {
        smoothingBuffer = [];
        $stabDots.forEach(d => { d.className = "stab-dot"; });
        $confFill.style.width = (data.confidence || 0).toFixed(1) + "%";
        $confFill.className   = "low";
        $confPct.textContent  = (data.confidence || 0).toFixed(1) + "%";
        $currentLetter.textContent = "?";
        lastLetter = null;
        setStatus("Low confidence — adjust hand position or lighting.", false);
      }
    } catch {
      setStatus("⚠ Server offline. Run: python3 core/server.py", true);
      if (firstPrediction) {
        firstPrediction = false;
        $camLoading.classList.remove("active");
      }
    } finally {
      isFetching = false;
    }
  }

  function applyPrediction(letter, confidence) {
    // Animate letter change
    if (letter !== $currentLetter.textContent) {
      $currentLetter.style.transform = "scale(1.4)";
      setTimeout(() => { $currentLetter.style.transform = ""; }, 180);
    }
    $currentLetter.textContent = letter;

    // Append only when the letter changes (avoid duplicate spam)
    if (letter !== lastLetter) {
      lastLetter = letter;
      // Don't append "nothing" or "space" as visible chars — handle specially
      if (letter === "nothing") {
        // silence — intentional pause, do nothing
      } else if (letter === "space") {
        appendToOutput(" ");
      } else if (letter === "del") {
        deleteLastOutput();
      } else {
        appendToOutput(letter);
      }
    }
  }

  function appendToOutput(letter) {
    const placeholder = $outputBox.querySelector(".output-placeholder");
    if (placeholder) placeholder.remove();

    const span = document.createElement("span");
    span.textContent = letter;
    span.style.animation = "fadeInLetter 0.2s ease";
    $outputBox.appendChild(span);

    $outputBox.dataset.text = ($outputBox.dataset.text || "") + letter;
    $outputBox.scrollTop = $outputBox.scrollHeight;
  }

  function deleteLastOutput() {
    const current = $outputBox.dataset.text || "";
    if (!current.length) return;
    const newText = current.slice(0, -1);
    $outputBox.dataset.text = newText;
    // Remove last span child (each letter is one span)
    const spans = $outputBox.querySelectorAll("span:not(.output-placeholder)");
    if (spans.length) spans[spans.length - 1].remove();
    if (!newText.length) {
      $outputBox.innerHTML = '<span class="output-placeholder">Translated text appears here…</span>';
      $outputBox.dataset.text = "";
    }
  }

  function clearOutputBox() {
    $outputBox.innerHTML = '<span class="output-placeholder">Translated text appears here…</span>';
    $outputBox.dataset.text = "";
  }

  function setStatus(msg, isError, isSuccess) {
    $statusNote.innerHTML = msg;
    $statusNote.className = "status-note" +
      (isError ? " error" : "") +
      (isSuccess ? " success" : "");
  }

  /* Small keyframe for letter pop-in */
  const styleTag = document.createElement("style");
  styleTag.textContent = `
    @keyframes fadeInLetter {
      from { opacity: 0; transform: translateY(4px) scale(0.85); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
  `;
  document.head.appendChild(styleTag);


  /* ─────────────────────────────────────────────────────────
     6. Personal Gesture Training
  ──────────────────────────────────────────────────────────── */
  const TRAIN_TARGET  = 25;   // frames to collect
  const ALL_CLASSES   = [
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
    "del", "space", "nothing"
  ];

  const $trainGuard      = document.getElementById("train-guard");
  const $trainPanel      = document.getElementById("train-panel");
  const $btnTrainSignin  = document.getElementById("btn-train-signin");
  const $letterGrid      = document.getElementById("letter-grid");
  const $trainSelLetter  = document.getElementById("train-selected-letter");
  const $captureCount    = document.getElementById("capture-count");
  const $captureBar      = document.getElementById("capture-progress-bar");
  const $trainCamWrap    = document.getElementById("train-camera-wrap");
  const $trainCamIdle    = document.getElementById("train-cam-idle");
  const $trainWebcam     = document.getElementById("train-webcam");
  const $trainSnapshot   = document.getElementById("train-snapshot");
  const $trainFlash      = document.getElementById("train-flash");
  const $btnOpenTrainCam = document.getElementById("btn-train-open-cam");
  const $btnCloseTrainCam= document.getElementById("btn-train-close-cam");
  const $btnCapture      = document.getElementById("btn-capture");
  const $btnTrainNow     = document.getElementById("btn-train-now");
  const $btnTrainReset   = document.getElementById("btn-train-reset");
  const $trainProgressWrap  = document.getElementById("train-progress-wrap");
  const $trainProgressFill  = document.getElementById("train-progress-fill");
  const $trainProgressLabel = document.getElementById("train-progress-label");
  const $trainResult        = document.getElementById("train-result");

  const $aslRefPlaceholder  = document.getElementById("asl-ref-placeholder");
  const $aslRefContent      = document.getElementById("asl-ref-content");
  const $aslRefLetter       = document.getElementById("asl-ref-letter");
  const $aslRefDiagram      = document.getElementById("asl-ref-diagram");
  const $aslRefTip          = document.getElementById("asl-ref-tip");

  let trainStream      = null;
  let selectedLetter   = null;
  let capturedImages   = [];  // base64 strings
  let trainPollTimer   = null;

  /* ASL Reference Map */
  const ASL_DICT = {
    A: { char: "A", icon: "✊", tip: "Fist with thumb resting against the side of the index finger." },
    B: { char: "B", icon: "✋", tip: "Flat hand with fingers together, thumb tucked across palm." },
    C: { char: "C", icon: "🫲", tip: "Hand curved to form the shape of a C." },
    D: { char: "D", icon: "☝️", tip: "Index finger pointing up, other fingers curved to touch thumb tip." },
    E: { char: "E", icon: "💅", tip: "Fingers curled inward resting on the thumb." },
    F: { char: "F", icon: "👌", tip: "Index and thumb touching, other three fingers extended and spread." },
    G: { char: "G", icon: "🤏", tip: "Index finger and thumb pointing sideways, parallel." },
    H: { char: "H", icon: "✌️", tip: "Index and middle fingers pointing sideways, together." },
    I: { char: "I", icon: "🤙", tip: "Pinky pointing up, other fingers closed in a fist." },
    J: { char: "J", icon: "🪝", tip: "Pinky points up and draws a J shape in the air." },
    K: { char: "K", icon: "✌️", tip: "Index and middle fingers up and separated, thumb resting between them." },
    L: { char: "L", icon: "👆", tip: "Index finger up, thumb extended sideways to form an L." },
    M: { char: "M", icon: "✊", tip: "Thumb tucked under the first three fingers." },
    N: { char: "N", icon: "✊", tip: "Thumb tucked under the first two fingers." },
    O: { char: "O", icon: "⭕", tip: "Fingers curved to meet thumb, forming an O shape." },
    P: { char: "P", icon: "👇", tip: "Like K, but pointing downwards." },
    Q: { char: "Q", icon: "👇", tip: "Like G, but pointing downwards." },
    R: { char: "R", icon: "🤞", tip: "Index and middle fingers crossed." },
    S: { char: "S", icon: "✊", tip: "Fist with thumb wrapped across the front of the fingers." },
    T: { char: "T", icon: "✊", tip: "Fist with thumb tucked between index and middle fingers." },
    U: { char: "U", icon: "✌️", tip: "Index and middle fingers pointing up and together." },
    V: { char: "V", icon: "✌️", tip: "Index and middle fingers pointing up and spread apart." },
    W: { char: "W", icon: "🖖", tip: "Three fingers pointing up and spread apart (index, middle, ring)." },
    X: { char: "X", icon: "🪝", tip: "Index finger hooked like a pirate hook, others closed." },
    Y: { char: "Y", icon: "🤙", tip: "Thumb and pinky extended, other fingers closed." },
    Z: { char: "Z", icon: "🔤", tip: "Index finger extended, draws a Z shape in the air." },
    del: { char: "DEL", icon: "🔙", tip: "Thumb jerking backwards over the shoulder." },
    space: { char: "SPC", icon: "➖", tip: "Hand moving horizontally flat, or pinch moving sideways." },
    nothing: { char: "---", icon: "🚫", tip: "Empty frame or neutral rest position." }
  };

  /* Build letter grid */
  ALL_CLASSES.forEach(cls => {
    const btn = document.createElement("button");
    btn.className   = "letter-btn";
    btn.textContent = cls.length === 1 ? cls : cls; // single char or keyword
    btn.title       = cls;
    btn.setAttribute("aria-label", `Train letter ${cls}`);
    btn.addEventListener("click", () => selectLetter(cls));
    $letterGrid.appendChild(btn);
  });

  function selectLetter(cls) {
    selectedLetter = cls;
    $trainSelLetter.textContent = cls;
    document.querySelectorAll(".letter-btn").forEach(b => {
      b.classList.toggle("selected", b.textContent === cls);
    });
    
    // Update ASL Reference Panel
    $aslRefPlaceholder.style.display = "none";
    $aslRefContent.style.display     = "block";
    const ref = ASL_DICT[cls] || { char: cls, icon: "✋", tip: "Follow standard ASL hand shape." };
    $aslRefLetter.textContent  = ref.char;
    $aslRefDiagram.textContent = ref.icon;
    $aslRefTip.textContent     = ref.tip;

    resetCapture();
  }

  /* Show/hide guard vs panel based on login */
  function refreshTrainUI() {
    const loggedIn = !!localStorage.getItem(STORAGE_KEY);
    $trainGuard.style.display = loggedIn ? "none"  : "";
    $trainPanel.style.display = loggedIn ? "flex"  : "none";
  }

  // Wire the "Sign In" button inside the guard
  $btnTrainSignin.addEventListener("click", () => { openModal(); });

  // Re-run after every auth change (patch refreshAuthUI)
  const _origRefreshAuth = refreshAuthUI;
  // eslint-disable-next-line no-global-assign
  window.__refreshTrainUI = refreshTrainUI; // expose so submit handler can call it
  // Patch: call refreshTrainUI whenever login state changes
  $btnSubmit.addEventListener("click", () => setTimeout(refreshTrainUI, 60));
  $btnLogout.addEventListener("click", () => setTimeout(refreshTrainUI, 60));

  refreshTrainUI();

  /* Open training camera */
  $btnOpenTrainCam.addEventListener("click", async () => {
    try {
      trainStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    } catch {
      alert("Camera access denied. Please allow camera and try again.");
      return;
    }
    $trainWebcam.srcObject = trainStream;
    $trainWebcam.style.display = "block";
    $trainCamIdle.style.display = "none";
    $trainCamWrap.classList.add("active");
    $btnOpenTrainCam.style.display  = "none";
    $btnCloseTrainCam.style.display = "inline-flex";
    $btnCapture.style.display       = "inline-flex";
    updateCaptureBtn();
  });

  /* Close training camera */
  $btnCloseTrainCam.addEventListener("click", closeTrainCam);

  function closeTrainCam() {
    if (trainStream) { trainStream.getTracks().forEach(t => t.stop()); trainStream = null; }
    $trainWebcam.srcObject = null;
    $trainWebcam.style.display = "none";
    $trainCamIdle.style.display = "flex";
    $trainCamWrap.classList.remove("active");
    $btnOpenTrainCam.style.display  = "inline-flex";
    $btnCloseTrainCam.style.display = "none";
    $btnCapture.style.display       = "none";
  }

  /* Capture a frame */
  $btnCapture.addEventListener("click", () => {
    if (!trainStream || capturedImages.length >= TRAIN_TARGET) return;

    const vw = $trainWebcam.videoWidth  || 320;
    const vh = $trainWebcam.videoHeight || 240;
    const roi = Math.floor(Math.min(vw, vh) * 0.55);
    const rx  = Math.floor((vw - roi) / 2);
    const ry  = Math.floor((vh - roi) / 2);

    $trainSnapshot.width  = roi;
    $trainSnapshot.height = roi;
    const ctx = $trainSnapshot.getContext("2d");
    ctx.save();
    ctx.translate(roi, 0);
    ctx.scale(-1, 1);
    ctx.drawImage($trainWebcam, rx, ry, roi, roi, 0, 0, roi, roi);
    ctx.restore();

    capturedImages.push($trainSnapshot.toDataURL("image/jpeg", 0.85));

    // Flash effect
    $trainFlash.classList.add("flash");
    setTimeout(() => $trainFlash.classList.remove("flash"), 120);

    updateCaptureUI();
  });

  function updateCaptureUI() {
    const n = capturedImages.length;
    $captureCount.textContent = `${n} / ${TRAIN_TARGET}`;
    $captureBar.style.width   = (n / TRAIN_TARGET * 100) + "%";
    if (n >= TRAIN_TARGET) {
      $btnCapture.disabled = true;
      $btnCapture.textContent = "✓ All frames captured";
    }
    updateCaptureBtn();
    // Enable Train Now when letter selected + enough samples
    $btnTrainNow.disabled = !(selectedLetter && capturedImages.length >= 10);
  }

  function updateCaptureBtn() {
    if ($btnCapture.style.display === "none") return;
    const full = capturedImages.length >= TRAIN_TARGET;
    $btnCapture.disabled = full || !trainStream;
    if (!full) $btnCapture.textContent = "📸 Capture Frame";
  }

  function resetCapture() {
    capturedImages = [];
    $captureCount.textContent = `0 / ${TRAIN_TARGET}`;
    $captureBar.style.width   = "0%";
    $btnCapture.disabled = false;
    $btnCapture.textContent = "📸 Capture Frame";
    $btnTrainNow.disabled = true;
    $trainProgressWrap.style.display = "none";
    $trainProgressFill.style.width   = "0%";
    $trainResult.style.display       = "none";
    $trainResult.innerHTML           = "";
    clearInterval(trainPollTimer);
  }

  $btnTrainReset.addEventListener("click", () => {
    selectedLetter = null;
    $trainSelLetter.textContent = "—";
    document.querySelectorAll(".letter-btn").forEach(b => b.classList.remove("selected"));
    closeTrainCam();
    resetCapture();
  });

  /* Train Now */
  $btnTrainNow.addEventListener("click", async () => {
    if (!selectedLetter || capturedImages.length < 10) return;

    $btnTrainNow.disabled   = true;
    $btnTrainReset.disabled = true;
    $trainProgressWrap.style.display = "block";
    $trainResult.style.display       = "none";
    $trainResult.innerHTML           = "";
    $trainProgressFill.style.width   = "5%";
    $trainProgressLabel.textContent  = "Sending samples to server…";

    try {
      const username = localStorage.getItem(STORAGE_KEY) || "anonymous";
      const res = await fetch(`${SERVER}/train`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ letter: selectedLetter, images: capturedImages, username: username }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showTrainResult(false, err.error || "Server returned an error.");
        return;
      }

      // Poll for progress
      trainPollTimer = setInterval(async () => {
        try {
          const sr = await fetch(`${SERVER}/training-status`);
          const st = await sr.json();

          $trainProgressFill.style.width  = st.progress + "%";
          $trainProgressLabel.textContent = st.message || "Training…";

          if (!st.running && st.result !== null) {
            clearInterval(trainPollTimer);
            $btnTrainReset.disabled = false;
            if (st.result.success) {
              showTrainResult(true, st.result.message, st.result.accuracy);
            } else {
              showTrainResult(false, st.result.message);
            }
          }
        } catch {
          clearInterval(trainPollTimer);
          showTrainResult(false, "Lost connection to server while training.");
        }
      }, 1200);

    } catch {
      showTrainResult(false, "⚠ Could not reach server. Is python3 core/server.py running?");
      $btnTrainReset.disabled = false;
    }
  });

  function showTrainResult(success, message, accuracy) {
    $trainProgressWrap.style.display = "none";
    $trainResult.style.display = "block";

    if (success) {
      $trainResult.innerHTML = `
        <div class="train-result-card success">
          <div class="train-result-icon">🎉</div>
          <div>
            <h4>Training Complete!</h4>
            <p>${escHtml(message)}</p>
          </div>
          ${accuracy !== undefined ? `
          <div class="train-accuracy-badge">
            <div class="train-accuracy-val">${accuracy}%</div>
            <div class="train-accuracy-label">Val Acc</div>
          </div>` : ""}
        </div>`;
    } else {
      $trainResult.innerHTML = `
        <div class="train-result-card error">
          <div class="train-result-icon">⚠️</div>
          <div>
            <h4>Training Failed</h4>
            <p>${escHtml(message)}</p>
          </div>
        </div>`;
      $btnTrainNow.disabled = false;
    }
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

})();
