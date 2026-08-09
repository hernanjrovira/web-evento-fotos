/* ==============================================================
   CONFIGURACIÓN — completá estos tres valores con los tuyos.
   Ver README.md para el paso a paso de Cloudinary.
================================================================= */
const CLOUDINARY_CONFIG = {
  cloudName: "rrromouo",       // ej: "dxample123"
  uploadPreset: "evento-fotos-isa", // preset unsigned creado en Cloudinary
  folder: "evento",                 // carpeta dentro de tu cuenta de Cloudinary (opcional)
};

/* Límites de validación en el frontend.
   El plan free de Cloudinary también aplica sus propios límites de
   tamaño; si una subida falla por tamaño, ajustá estos valores según
   lo que veas en tu dashboard de Cloudinary. */
const MAX_IMAGE_MB = 30;
const MAX_VIDEO_MB = 300;
const MAX_FILES = 50;

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

// Cada entrada: { file, id, valid, reason }
let selectedFiles = [];
let isUploading = false;

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
      li.appendChild(badge);
    } else {
      const note = document.createElement("span");
      note.className = "invalid-note";
      note.textContent = entry.reason;
      li.appendChild(note);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-btn";
    removeBtn.setAttribute("aria-label", "Quitar archivo");
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => removeFile(entry.id));
    li.appendChild(removeBtn);

    fileListEl.appendChild(li);
  }
}

function removeFile(id) {
  selectedFiles = selectedFiles.filter((entry) => entry.id !== id);
  renderFileList();
  updateSubmitState();
}

function updateSubmitState() {
  const hasValidFile = selectedFiles.some((entry) => entry.valid);
  submitBtn.disabled = !hasValidFile || isUploading;
}

/* ==============================================================
   Subida a Cloudinary (unsigned upload preset, sin login)
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
  submitBtn.disabled = true;
  setStatus("", "");
  showProgress(true);

  let uploaded = 0;
  let failed = 0;
  const totalBytes = toUpload.reduce((sum, entry) => sum + entry.file.size, 0);
  let sentBytesByFile = new Array(toUpload.length).fill(0);

  const updateOverallProgress = () => {
    const sent = sentBytesByFile.reduce((a, b) => a + b, 0);
    const pct = totalBytes ? Math.min(100, Math.round((sent / totalBytes) * 100)) : 0;
    progressFill.style.width = pct + "%";
    progressLabel.textContent = `Subiendo ${pct}%`;
  };

  await Promise.all(
    toUpload.map((entry, index) =>
      uploadToCloudinary(entry.file, (loaded) => {
        sentBytesByFile[index] = loaded;
        updateOverallProgress();
      })
        .then(() => {
          uploaded += 1;
          sentBytesByFile[index] = entry.file.size;
          updateOverallProgress();
        })
        .catch(() => {
          failed += 1;
        })
    )
  );

  isUploading = false;
  showProgress(false);

  if (failed === 0) {
    setStatus(
      uploaded === 1
        ? "¡Listo! Tu archivo se subió correctamente."
        : `¡Listo! Se subieron ${uploaded} archivos correctamente.`,
      "success"
    );
    fireFlash();
    selectedFiles = [];
    renderFileList();
  } else if (uploaded > 0) {
    setStatus(
      `Se subieron ${uploaded} archivos, pero ${failed} no se pudieron subir. Probá de nuevo con esos.`,
      "error"
    );
    selectedFiles = selectedFiles.filter((entry) => !entry.valid);
  } else {
    setStatus(
      "No se pudo subir ningún archivo. Revisá tu conexión e intentá nuevamente.",
      "error"
    );
  }

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

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    });

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(file.size);
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`Cloudinary respondió ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("Error de red"));
    xhr.send(data);
  });
}

/* ==============================================================
   UI helpers
================================================================= */
function showProgress(show) {
  progressWrap.hidden = !show;
  if (show) {
    progressFill.style.width = "0%";
    progressLabel.textContent = "Subiendo 0%";
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
