/* ==============================================================
   CONFIGURACIÓN — completá estos valores con los tuyos.
   Ver README.md para el paso a paso de Cloudinary y del backend.
================================================================= */
const CLOUDINARY_CONFIG = {
  cloudName: "rrromouo",
  uploadPreset: "evento-fotos-isa",
  folder: "evento",
};

/* Límites de validación en el frontend.
   El plan free de Cloudinary también aplica sus propios límites de
   tamaño; si una subida falla por tamaño, ajustá estos valores según
   lo que veas en tu dashboard de Cloudinary. */
const MAX_IMAGE_MB = 30;
const MAX_VIDEO_MB = 300;
const MAX_FILES = 50;

/* Endpoint propio (Vercel Serverless Function) para estadísticas
   globales. Es "best effort": si falla, no interrumpe la subida real. */
const LOG_UPLOAD_ENDPOINT = "/api/log-upload";

/* Minutos de inactividad antes de mostrar el aviso de sesión expirada. */
const IDLE_LIMIT_MS = 30 * 60 * 1000;

/* ==============================================================
   Estado y referencias al DOM
================================================================= */
const form = document.getElementById("upload-form");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const fileListEl = document.getElementById("file-list");
const submitBtn = document.getElementById("submit-btn");
const progressWrap = document.getElementById("progress-wrap");
const progressFill = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");
const statusEl = document.getElementById("status");
const flashEl = document.getElementById("flash");
const sessionCounterEl = document.getElementById("session-counter");
const idleOverlay = document.getElementById("idle-overlay");
const idleReloadBtn = document.getElementById("idle-reload-btn");

// Cada entrada: { file, id, valid, reason }
let selectedFiles = [];
let isUploading = false;

/* ==============================================================
   Identidad del dispositivo (para las estadísticas globales)
   — no es autenticación, solo un id anónimo guardado en localStorage.
================================================================= */
function getDeviceId() {
  const KEY = "eventoDeviceId";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}
const DEVICE_ID = getDeviceId();

/* ==============================================================
   Contador de sesión (Mejora 3) — persiste en localStorage.
   Solo se limpia si el usuario borra el caché del navegador.
================================================================= */
const SESSION_STATS_KEY = "eventoSessionStats";

function loadSessionStats() {
  try {
    const raw = localStorage.getItem(SESSION_STATS_KEY);
    if (!raw) return { count: 0, totalMb: 0 };
    const parsed = JSON.parse(raw);
    return {
      count: Number(parsed.count) || 0,
      totalMb: Number(parsed.totalMb) || 0,
    };
  } catch {
    return { count: 0, totalMb: 0 };
  }
}

function saveSessionStats(stats) {
  localStorage.setItem(SESSION_STATS_KEY, JSON.stringify(stats));
}

function registerSuccessfulUpload(fileSizeBytes) {
  const stats = loadSessionStats();
  stats.count += 1;
  stats.totalMb += fileSizeBytes / (1024 * 1024);
  saveSessionStats(stats);
  renderSessionCounter(stats);
}

function renderSessionCounter(stats) {
  const s = stats || loadSessionStats();
  if (s.count === 0) {
    sessionCounterEl.textContent = "";
    return;
  }
  sessionCounterEl.textContent = `✨ Fotos mágicas subidas: ${s.count} | Tamaño: ${s.totalMb.toFixed(1)} MB`;
}

renderSessionCounter();

/* ==============================================================
   Detección de inactividad (Mejora 2)
   No corta la subida en curso: si el usuario está subiendo algo,
   se posterga el aviso hasta que termine.
================================================================= */
let idleTimer = null;

function scheduleIdleCheck() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (isUploading) {
      // Reintentar más tarde en vez de interrumpir una subida activa.
      scheduleIdleCheck();
      return;
    }
    showIdleOverlay();
  }, IDLE_LIMIT_MS);
}

function showIdleOverlay() {
  idleOverlay.hidden = false;
}

["mousemove", "keydown", "click", "touchstart", "scroll"].forEach((evt) => {
  window.addEventListener(evt, scheduleIdleCheck, { passive: true });
});

idleReloadBtn.addEventListener("click", () => {
  window.location.reload();
});

// scheduleIdleCheck();

/* ==============================================================
   Selección de archivos (input nativo + drag & drop)
================================================================= */
fileInput.addEventListener("change", () => {
  addFiles(Array.from(fileInput.files || []));
  // Se limpia para poder volver a elegir el mismo archivo si el usuario
  // lo quita y lo agrega de nuevo.
  fileInput.value = "";
});

["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("is-dragover");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-dragover");
  });
});

dropzone.addEventListener("drop", (e) => {
  const dropped = Array.from(e.dataTransfer?.files || []);
  addFiles(dropped);
});

function addFiles(newFiles) {
  if (isUploading) return;

  for (const file of newFiles) {
    if (selectedFiles.length >= MAX_FILES) {
      setStatus(`Podés subir hasta ${MAX_FILES} archivos por vez.`, "error");
      break;
    }
    selectedFiles.push({
      file,
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      confirmed: false,
      ...validateFile(file),
    });
  }

  renderFileList();
  updateSubmitState();
}

function validateFile(file) {
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");

  if (!isImage && !isVideo) {
    return { valid: false, reason: "Formato no soportado" };
  }

  const sizeMb = file.size / (1024 * 1024);
  const limit = isImage ? MAX_IMAGE_MB : MAX_VIDEO_MB;

  if (sizeMb > limit) {
    return { valid: false, reason: `Supera ${limit} MB` };
  }

  return { valid: true, reason: null };
}

/* ==============================================================
   Render de la grilla de previews
================================================================= */
function renderFileList() {
  fileListEl.innerHTML = "";

  for (const entry of selectedFiles) {
    const li = document.createElement("li");
    li.className = "file-item" + (entry.valid ? "" : " is-invalid");
    li.dataset.id = entry.id;

    const isVideo = entry.file.type.startsWith("video/");
    const url = URL.createObjectURL(entry.file);

    let mediaEl;
    if (isVideo) {
      mediaEl = document.createElement("video");
      mediaEl.src = url;
      mediaEl.muted = true;
      mediaEl.playsInline = true;
    } else {
      mediaEl = document.createElement("img");
      mediaEl.src = url;
      mediaEl.alt = "";
    }
    li.appendChild(mediaEl);

    if (entry.valid) {
      const badge = document.createElement("span");
      badge.className = "kind-badge";
      badge.textContent = isVideo ? "Video" : "Foto";
      badge.dataset.role = "kind-badge";
      li.appendChild(badge);
    } else {
      const note = document.createElement("span");
      note.className = "invalid-note";
      note.textContent = entry.reason;
      li.appendChild(note);
    }

    if (!isUploading) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "remove-btn";
      removeBtn.setAttribute("aria-label", "Quitar archivo");
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => removeFile(entry.id));
      li.appendChild(removeBtn);
    }

    fileListEl.appendChild(li);
  }
}

function markFileConfirmed(id) {
  const li = fileListEl.querySelector(`[data-id="${id}"]`);
  const badge = li?.querySelector('[data-role="kind-badge"]');
  if (badge) {
    badge.textContent = "✓ Lista";
    badge.classList.add("is-done");
  }
}

function removeFile(id) {
  selectedFiles = selectedFiles.filter((entry) => entry.id !== id);
  renderFileList();
  updateSubmitState();
}

function updateSubmitState() {
  const validCount = selectedFiles.filter((entry) => entry.valid).length;
  submitBtn.disabled = validCount === 0 || isUploading;
  if (isUploading) {
    submitBtn.textContent = "Enviando fotos...";
  } else if (validCount > 1) {
    submitBtn.textContent = `Enviar ${validCount} Fotos`;
  } else if (validCount === 1) {
    submitBtn.textContent = "Enviar 1 Foto";
  } else {
    submitBtn.textContent = "¡Enviar!";
  }
}

/* ==============================================================
   Subida a Cloudinary (unsigned upload preset, sin login)
   Mejora 1: progreso real por bytes + fase "Procesando" mientras
   Cloudinary confirma, y el botón queda deshabilitado hasta que
   TODAS las respuestas fueron confirmadas.
================================================================= */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (isUploading) return;

  const toUpload = selectedFiles.filter((entry) => entry.valid);
  if (toUpload.length === 0) {
    setStatus("Elegí al menos un archivo válido antes de subir.", "error");
    return;
  }

  if (
    CLOUDINARY_CONFIG.cloudName === "TU_CLOUD_NAME" ||
    CLOUDINARY_CONFIG.uploadPreset === "TU_UPLOAD_PRESET"
  ) {
    setStatus(
      "Falta configurar Cloudinary en script.js (cloudName / uploadPreset). Ver README.",
      "error"
    );
    return;
  }

  isUploading = true;
  updateSubmitState();
  renderFileList(); // oculta los botones de "quitar" mientras sube
  setStatus("", "");
  showProgress(true);

  let confirmedCount = 0;
  let failedCount = 0;
  const totalBytes = toUpload.reduce((sum, entry) => sum + entry.file.size, 0);
  const sentBytesByFile = new Array(toUpload.length).fill(0);

  const updateOverallProgress = () => {
    const sent = sentBytesByFile.reduce((a, b) => a + b, 0);
    const pctSent = totalBytes ? Math.min(100, Math.round((sent / totalBytes) * 100)) : 0;
    progressFill.style.width = pctSent + "%";

    if (pctSent < 100) {
      progressLabel.textContent = `Enviando ${pctSent}%`;
    } else if (confirmedCount < toUpload.length) {
      progressLabel.textContent = "Guardando en el álbum...";
    } else {
      progressLabel.textContent = "✨ ¡Fotos mágicas subidas!";
    }
  };

  updateOverallProgress();

  await Promise.all(
    toUpload.map((entry, index) =>
      uploadToCloudinary(entry.file, (loaded) => {
        sentBytesByFile[index] = loaded;
        updateOverallProgress();
      })
        .then(() => {
          confirmedCount += 1;
          sentBytesByFile[index] = entry.file.size;
          entry.confirmed = true;
          markFileConfirmed(entry.id);
          registerSuccessfulUpload(entry.file.size);
          logUploadToBackend(entry.file);
          updateOverallProgress();
        })
        .catch((err) => {
          failedCount += 1;
          entry.lastError = friendlyUploadError(err);
          updateOverallProgress();
        })
    )
  );

  isUploading = false;

  if (failedCount === 0) {
    progressLabel.textContent = "✨ ¡Fotos mágicas subidas con éxito!";
    setStatus(
      confirmedCount === 1
        ? "🌸 ¡Listo! Tu foto mágica se subió correctamente."
        : `🌸 ¡Listo! Se subieron ${confirmedCount} fotos mágicas correctamente.`,
      "success"
    );
    fireFlash();
    selectedFiles = [];
  } else if (confirmedCount > 0) {
    const firstError = toUpload.find((e) => e.lastError)?.lastError;
    setStatus(
      `Se subieron ${confirmedCount} fotos, pero ${failedCount} no se pudieron subir` +
      (firstError ? ` (${firstError})` : "") +
      ". Probá de nuevo con esas.",
      "error"
    );
    selectedFiles = selectedFiles.filter((entry) => !entry.valid || !entry.confirmed);
  } else {
    const firstError = toUpload.find((e) => e.lastError)?.lastError;
    setStatus(
      firstError || "No se pudo subir ningún archivo. Revisá tu conexión e intentá nuevamente.",
      "error"
    );
  }

  setTimeout(() => showProgress(false), failedCount === 0 ? 1200 : 0);
  renderFileList();
  updateSubmitState();
});

function uploadToCloudinary(file, onProgress) {
  return new Promise((resolve, reject) => {
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/auto/upload`;
    const data = new FormData();
    data.append("file", file);
    data.append("upload_preset", CLOUDINARY_CONFIG.uploadPreset);
    if (CLOUDINARY_CONFIG.folder) {
      data.append("folder", CLOUDINARY_CONFIG.folder);
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    // Progreso REAL de bytes enviados (evento nativo de XHR, no simulado).
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    });

    xhr.onload = () => {
      // Los bytes ya llegaron (100%), pero recién acá tenemos la
      // confirmación real del servidor — por eso la fase "Procesando"
      // vive entre el último evento de progreso y este callback.
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(file.size);
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(parseCloudinaryError(xhr));
      }
    };

    xhr.onerror = () => reject({ kind: "network" });
    xhr.send(data);
  });
}

function parseCloudinaryError(xhr) {
  try {
    const body = JSON.parse(xhr.responseText);
    const message = body?.error?.message || "";
    if (/preset/i.test(message) && /(not found|disabled|invalid)/i.test(message)) {
      return { kind: "preset", message };
    }
    return { kind: "cloudinary", message: message || `HTTP ${xhr.status}` };
  } catch {
    return { kind: "cloudinary", message: `HTTP ${xhr.status}` };
  }
}

function friendlyUploadError(err) {
  if (err?.kind === "preset") {
    return "la configuración de subida del evento no es válida, avisale al organizador";
  }
  if (err?.kind === "network") {
    return "problema de conexión";
  }
  return err?.message || "error desconocido";
}

/* ==============================================================
   Log a backend propio para estadísticas globales (Mejora 4).
   Best-effort: si falla, no afecta la subida real a Cloudinary.
================================================================= */
function logUploadToBackend(file) {
  try {
    fetch(LOG_UPLOAD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: DEVICE_ID,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        timestamp: new Date().toISOString(),
      }),
      keepalive: true,
    }).catch(() => {
      /* silencioso: esto es solo para estadísticas del organizador */
    });
  } catch {
    /* no-op */
  }
}

/* ==============================================================
   UI helpers
================================================================= */
function showProgress(show) {
  progressWrap.hidden = !show;
  if (show) {
    progressFill.style.width = "0%";
    progressLabel.textContent = "Enviando 0%";
  }
}

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = "status" + (kind ? ` ${kind}` : "");
}

function fireFlash() {
  flashEl.classList.remove("fire");
  // Forzar reflow para poder relanzar la animación si se sube más de una vez.
  // eslint-disable-next-line no-unused-expressions
  flashEl.offsetHeight;
  flashEl.classList.add("fire");
}
