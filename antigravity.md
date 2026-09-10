# Tarea para Antigravity: migrar el upload de fotos del evento de Cloudinary a Cloudflare R2

## Cómo usar este archivo

Pegá el contenido completo de este archivo como la tarea (task) en el Agent
Manager de Antigravity, con el repositorio del proyecto ya abierto como
workspace. El agente debe ejecutar los pasos en orden y terminar con un
commit nuevo (el más reciente) en el branch actual del repo.

## Contexto

Este es un repo existente (proyecto "Álbum del evento"): una página estática
(HTML/CSS/JS vanilla) + funciones serverless de Vercel que deja a los
invitados de un evento subir fotos y videos sin login. Hasta el commit
actual del repo, el almacenamiento era Cloudinary. La tarea es migrarlo a
**Cloudflare R2** usando URLs pre-firmadas (`@aws-sdk/s3-request-presigner`),
manteniendo el flujo 100% anónimo (sin login) para el invitado.

Todo el código de esta migración ya fue escrito, probado (`node -c` en cada
archivo, más una prueba funcional del endpoint de presign con credenciales
dummy que confirmó que la URL firmada sale bien formada con `forcePathStyle:
true`) y verificado sin dependencias de Cloudinary en package.json. Tu
trabajo NO es rediseñar la migración — es **aplicarla tal cual** sobre el
repo real y dejarla como el commit más reciente.

Una decisión de diseño que tomé y que debés mantener: el pedido original
dice "sistema de subida de imágenes" y "valide que sea imagen", pero el
sitio recolecta fotos Y VIDEOS del evento (así era con Cloudinary). Restringir
el endpoint solo a `image/*` rompería la subida de videos, así que
`api/presign-upload.js` valida `image/*` O `video/*`. Está señalado con un
comentario en el propio archivo por si el usuario prefiere achicar el
alcance después.

## Pasos

### 1. Preparar el repo

```bash
git status
git pull
```

Confirmá que estás en el branch de trabajo del usuario (normalmente `main`)
y que no hay cambios sin commitear que se puedan perder.

### 2. Escribir los archivos

Reemplazá o creá estos archivos EXACTAMENTE con el contenido que sigue (cada
bloque indica la ruta relativa a la raíz del repo). No modifiques `index.html`
ni `styles.css` — no cambian en esta migración.

#### Archivo: `api/presign-upload.js`

```javascript
// api/presign-upload.js
//
// Vercel Serverless Function. Genera una URL pre-firmada (PUT) para que el
// navegador suba el archivo DIRECTO a Cloudflare R2 (compatible con la API
// S3), sin que el archivo pase por este servidor. Reemplaza el flujo
// anterior que subía a Cloudinary.
//
// Flujo: el frontend manda { filename, contentType } → esta función valida
// que sea imagen o video, arma una key única y devuelve { uploadUrl,
// publicUrl }. El frontend hace el PUT directo contra uploadUrl.

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const PRESIGN_EXPIRES_SECONDS = 300; // 5 minutos para completar el PUT

function getR2Client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return null;
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    // Importante para R2: sin esto, el SDK arma URLs virtual-hosted
    // (bucket.accountid.r2.cloudflarestorage.com) que pueden fallar con
    // "signature does not match". Con path-style, la URL queda
    // accountid.r2.cloudflarestorage.com/bucket/key, que es lo que R2 espera.
    forcePathStyle: true,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

// Evita path traversal y caracteres raros; conserva la extensión original.
function sanitizeFilename(name) {
  const base = String(name || "archivo")
    .split(/[/\\]/)
    .pop()
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-120);
  return base || "archivo";
}

// El pedido original habla de "imágenes", pero el sitio recolecta fotos Y
// videos del evento (así estaba desde el flujo con Cloudinary). Mantengo
// ambos para no romper esa funcionalidad. Si preferís restringir solo a
// imágenes, cambiá esta línea por: contentType.startsWith("image/")
function isAllowedContentType(contentType) {
  return /^image\/|^video\//.test(contentType || "");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  const { R2_BUCKET_NAME, R2_PUBLIC_URL } = process.env;
  const client = getR2Client();
  if (!client || !R2_BUCKET_NAME || !R2_PUBLIC_URL) {
    res.status(500).json({
      error:
        "Backend no configurado: revisá R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME y R2_PUBLIC_URL en Vercel",
    });
    return;
  }

  let body = req.body;
  if (!body || typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch {
      body = {};
    }
  }

  const { filename, contentType } = body || {};

  if (!filename || !contentType) {
    res.status(400).json({ error: "Faltan datos (filename, contentType)" });
    return;
  }

  if (!isAllowedContentType(contentType)) {
    res.status(415).json({ error: "Solo se aceptan imágenes o videos" });
    return;
  }

  const safeName = sanitizeFilename(filename);
  const key = `evento/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn: PRESIGN_EXPIRES_SECONDS,
    });

    const publicUrl = `${R2_PUBLIC_URL.replace(/\/+$/, "")}/${key}`;

    res.status(200).json({ uploadUrl, publicUrl, key, expiresIn: PRESIGN_EXPIRES_SECONDS });
  } catch (err) {
    res.status(502).json({ error: "No se pudo generar la URL de subida", detail: String(err) });
  }
};

```

#### Archivo: `script.js`

```javascript
/* ==============================================================
   CONFIGURACIÓN — el almacenamiento (Cloudflare R2) vive del lado del
   servidor (variables de entorno en Vercel, ver README.md). El frontend
   solo necesita saber a qué endpoint propio pedirle la URL de subida.
================================================================= */
const PRESIGN_ENDPOINT = "/api/presign-upload";

/* Límites de validación en el frontend. El backend valida tipo (imagen o
   video) pero NO tamaño — un PUT pre-firmado no impone límite de tamaño
   por sí solo, así que este control del lado del cliente es la única
   barrera de tamaño. Ver README para más detalle. */
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
  sessionCounterEl.textContent = `📊 Fotos subidas: ${s.count} | Tamaño total: ${s.totalMb.toFixed(1)} MB`;
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

scheduleIdleCheck();

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
  const hasValidFile = selectedFiles.some((entry) => entry.valid);
  submitBtn.disabled = !hasValidFile || isUploading;
}

/* ==============================================================
   Subida a Cloudflare R2 (presigned PUT, sin login)
   Mejora 1: progreso real por bytes + fase "Procesando" mientras
   R2 confirma, y el botón queda deshabilitado hasta que TODAS las
   respuestas fueron confirmadas.
================================================================= */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (isUploading) return;

  const toUpload = selectedFiles.filter((entry) => entry.valid);
  if (toUpload.length === 0) {
    setStatus("Elegí al menos un archivo válido antes de subir.", "error");
    return;
  }

  isUploading = true;
  submitBtn.disabled = true;
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
      progressLabel.textContent = `Subiendo... ${pctSent}%`;
    } else if (confirmedCount < toUpload.length) {
      progressLabel.textContent = "Procesando...";
    } else {
      progressLabel.textContent = "✅ Subida exitosa";
    }
  };

  updateOverallProgress();

  await Promise.all(
    toUpload.map((entry, index) =>
      uploadToR2(entry.file, (loaded) => {
        sentBytesByFile[index] = loaded;
        updateOverallProgress();
      })
        .then((result) => {
          confirmedCount += 1;
          sentBytesByFile[index] = entry.file.size;
          entry.confirmed = true;
          markFileConfirmed(entry.id);
          registerSuccessfulUpload(entry.file.size);
          logUploadToBackend(entry.file, result?.url);
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
    progressLabel.textContent = "✅ Subida exitosa";
    setStatus(
      confirmedCount === 1
        ? "¡Listo! Tu archivo se subió correctamente."
        : `¡Listo! Se subieron ${confirmedCount} archivos correctamente.`,
      "success"
    );
    fireFlash();
    selectedFiles = [];
  } else if (confirmedCount > 0) {
    const firstError = toUpload.find((e) => e.lastError)?.lastError;
    setStatus(
      `Se subieron ${confirmedCount} archivos, pero ${failedCount} no se pudieron subir` +
        (firstError ? ` (${firstError})` : "") +
        ". Probá de nuevo con esos.",
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

  setTimeout(() => showProgress(false), failedCount === 0 ? 900 : 0);
  renderFileList();
  updateSubmitState();
});

/* Paso 1: pedir la URL pre-firmada a nuestro backend.
   Paso 2: PUT directo del archivo original (intacto, sin recomprimir)
   contra esa URL, con progreso real de bytes vía XHR. */
function uploadToR2(file, onProgress) {
  return new Promise((resolve, reject) => {
    fetch(PRESIGN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw { kind: "presign", message: body?.error };
        }
        return r.json();
      })
      .then(({ uploadUrl, publicUrl }) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        // El Content-Type debe coincidir con el usado para firmar la URL.
        xhr.setRequestHeader("Content-Type", file.type);

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) onProgress(e.loaded);
        });

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress(file.size);
            resolve({ url: publicUrl });
          } else {
            reject(parseR2Error(xhr));
          }
        };

        xhr.onerror = () => reject({ kind: "network" });
        xhr.send(file); // archivo original, intacto, sin recomprimir
      })
      .catch((err) => reject(err?.kind ? err : { kind: "network", message: String(err) }));
  });
}

function parseR2Error(xhr) {
  if (xhr.status === 403) {
    return { kind: "expired", message: "el enlace de subida expiró, probá de nuevo" };
  }
  return { kind: "r2", message: `HTTP ${xhr.status}` };
}

function friendlyUploadError(err) {
  if (err?.kind === "presign") {
    return err.message || "no se pudo iniciar la subida";
  }
  if (err?.kind === "expired") {
    return err.message;
  }
  if (err?.kind === "network") {
    return "problema de conexión";
  }
  return err?.message || "error desconocido";
}

/* ==============================================================
   Log a backend propio para estadísticas globales (Mejora 4).
   Best-effort: si falla, no afecta la subida real a R2.
================================================================= */
function logUploadToBackend(file, url) {
  try {
    fetch(LOG_UPLOAD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: DEVICE_ID,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        url: url || null,
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
    progressLabel.textContent = "Subiendo... 0%";
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

```

#### Archivo: `api/log-upload.js`

```javascript
// api/log-upload.js
//
// Vercel Serverless Function. Registra cada subida exitosa para armar
// estadísticas globales del evento (por dispositivo, acumulables entre
// visitas). Requiere las variables de entorno SUPABASE_URL y
// SUPABASE_SERVICE_KEY configuradas en el proyecto de Vercel.
//
// Por qué Supabase y no un archivo JSON en el servidor: las funciones
// serverless de Vercel no tienen disco persistente. Cada invocación puede
// correr en una instancia nueva y los despliegues no comparten estado, así
// que escribir un stats.json local se perdería o quedaría inconsistente
// entre requests. Supabase (o cualquier base de datos externa) sí persiste.

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    res.status(500).json({
      error: "Backend no configurado: faltan SUPABASE_URL / SUPABASE_SERVICE_KEY en Vercel",
    });
    return;
  }

  let body = req.body;
  if (!body || typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch {
      body = {};
    }
  }

  const { deviceId, fileName, fileSize, mimeType, url } = body || {};
  if (!deviceId || !fileName || !fileSize) {
    res.status(400).json({ error: "Faltan datos (deviceId, fileName, fileSize)" });
    return;
  }

  const ip =
    String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim() ||
    req.socket?.remoteAddress ||
    "desconocida";

  const nowIso = new Date().toISOString();
  const sizeMb = Math.round((fileSize / (1024 * 1024)) * 100) / 100;

  const baseHeaders = {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  try {
    // 1) Traer el registro actual del dispositivo (si existe), para poder
    //    ACUMULAR en vez de sobrescribir cuando vuelve en otro momento.
    const getRes = await fetch(
      `${SUPABASE_URL}/rest/v1/devices?device_id=eq.${encodeURIComponent(deviceId)}&select=first_seen,total_files,total_mb`,
      { headers: baseHeaders }
    );
    const existingRows = getRes.ok ? await getRes.json() : [];
    const current = Array.isArray(existingRows) ? existingRows[0] : null;

    const upsertRow = {
      device_id: deviceId,
      ip,
      first_seen: current?.first_seen || nowIso,
      last_upload: nowIso,
      total_files: (current?.total_files || 0) + 1,
      total_mb: Math.round(((current?.total_mb || 0) + sizeMb) * 100) / 100,
    };

    // Upsert real vía PostgREST: on_conflict + Prefer: resolution=merge-duplicates
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/devices?on_conflict=device_id`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(upsertRow),
    });

    if (!upsertRes.ok) {
      const detail = await upsertRes.text();
      throw new Error(`No se pudo actualizar el dispositivo: ${detail}`);
    }

    // 2) Guardar el detalle de este archivo en el historial (tabla separada).
    await fetch(`${SUPABASE_URL}/rest/v1/uploads`, {
      method: "POST",
      headers: { ...baseHeaders, Prefer: "return=minimal" },
      body: JSON.stringify([
        {
          device_id: deviceId,
          filename: fileName,
          size_mb: sizeMb,
          mime_type: mimeType || null,
          url: url || null,
          ip,
          created_at: nowIso,
        },
      ]),
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: "No se pudo registrar la subida", detail: String(err) });
  }
};

```

#### Archivo: `package.json`

```json
{
  "name": "evento-fotos",
  "version": "2.0.0",
  "private": true,
  "description": "Página estática + funciones serverless de Vercel para recolectar fotos y videos del evento (Cloudflare R2) y registrar estadísticas globales (Supabase).",
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.632.0",
    "@aws-sdk/s3-request-presigner": "^3.632.0"
  }
}

```

#### Archivo: `README.md`

```markdown
# 📸 Álbum del evento

Página minimalista para que los invitados suban fotos y videos del evento desde su celular, sin login y sin fricción: eligen los archivos, tocan **Subir** y listo. Todo se guarda directo en Cloudflare R2.

**Stack:** HTML/CSS/JS vanilla + Vercel Serverless Functions (Node.js, `@aws-sdk/client-s3` para hablar con R2) + Cloudflare R2 (almacenamiento) + Supabase (estadísticas).

---

## 1. Crear el bucket en Cloudflare R2

1. Entrá al [dashboard de Cloudflare](https://dash.cloudflare.com) → **R2 Object Storage** → **Create bucket**.
2. Nombralo, por ejemplo `evento-fotos`. Región: **Automatic**.
3. Anotá tu **Account ID** (aparece en la URL del dashboard o en la página de resumen de R2) → va a ser `R2_ACCOUNT_ID`.

### 1.1 Habilitar acceso público de lectura

Por defecto un bucket de R2 es privado. Como necesitamos que las fotos se puedan ver después (o mostrarlas en una galería), hay que habilitar acceso público:

1. Entrá al bucket → pestaña **Settings** → **Public access**.
2. Activá **Allow Access** bajo "R2.dev subdomain". Cloudflare te va a dar una URL tipo `https://pub-xxxxxxxxxxxx.r2.dev`.
3. (Recomendado para producción) En vez del subdominio `r2.dev`, conectá un **dominio propio** (Settings → Custom Domains) para tener una URL más prolija y sin los límites de uso del subdominio de pruebas.
4. Esa URL base (con o sin dominio propio) es tu `R2_PUBLIC_URL`.

### 1.2 Crear las credenciales de API (R2 API Token)

1. En **R2 Object Storage** → **Manage R2 API Tokens** → **Create API Token**.
2. Permisos: **Object Read & Write**, scopeado a tu bucket (`evento-fotos`).
3. Cloudflare te muestra **Access Key ID** y **Secret Access Key** una sola vez — copialos ahí mismo:
   - `Access Key ID` → `R2_ACCESS_KEY_ID`
   - `Secret Access Key` → `R2_SECRET_ACCESS_KEY`

### 1.3 Configurar CORS (necesario para subir desde el navegador)

El navegador del invitado hace un `PUT` directo contra R2 desde el dominio de tu Vercel, así que R2 necesita permitir ese origen. En el bucket → **Settings** → **CORS Policy** → pegá:

```json
[
  {
    "AllowedOrigins": [
      "https://tu-evento.vercel.app",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

- `PUT` es lo que necesita la subida en sí.
- `GET`/`HEAD` sirven para poder mostrar o reproducir los archivos después (por ejemplo si armás una galería en el navegador).
- Reemplazá `https://tu-evento.vercel.app` por tu dominio real una vez que deployes (paso 3), y volvé a guardar la política.
- Mientras probás en local podés dejar `http://localhost:3000`, pero sacalo (o restringilo) para producción.

---

## 2. Variables de entorno

Estas variables NO van en el código — se configuran del lado del servidor (Vercel), nunca en el frontend, porque incluyen credenciales secretas:

| Variable | De dónde sale |
|---|---|
| `R2_ACCOUNT_ID` | Tu Account ID de Cloudflare (paso 1) |
| `R2_ACCESS_KEY_ID` | Del API Token de R2 (paso 1.2) |
| `R2_SECRET_ACCESS_KEY` | Del API Token de R2 (paso 1.2) |
| `R2_BUCKET_NAME` | El nombre del bucket, ej. `evento-fotos` |
| `R2_PUBLIC_URL` | La URL pública del paso 1.1, ej. `https://pub-xxxxxxxxxxxx.r2.dev` (sin `/` final) |
| `SUPABASE_URL` | Ver sección 6 (estadísticas) |
| `SUPABASE_SERVICE_KEY` | Ver sección 6 |
| `STATS_API_KEY` | Ver sección 6 |

Configuralas en **Vercel → tu proyecto → Settings → Environment Variables**. El frontend (`script.js`) no tiene ningún dato de R2: solo le pide una URL de subida a nuestro propio endpoint (`/api/presign-upload`).

---

## 3. Deployar en Vercel

**Opción A — desde la web de Vercel (sin instalar nada):**

1. Subí esta carpeta a un repositorio de GitHub.
2. Entrá a [vercel.com](https://vercel.com) → **Add New → Project** → importá el repo.
3. Vercel detecta el `package.json` e instala `@aws-sdk/client-s3` y `@aws-sdk/s3-request-presigner` automáticamente; las funciones en `/api` quedan activas como Serverless Functions sin configuración extra.
4. Cargá las variables de entorno del paso 2 (**Settings → Environment Variables**) antes o después del primer deploy — si las agregás después, hacé un **Redeploy**.
5. En un minuto tenés una URL tipo `https://tu-evento.vercel.app`.

**Opción B — desde la terminal:**

```bash
npm install -g vercel
cd event-upload
npm install
vercel --prod
```

---

## 4. Generar el QR para los invitados

1. Copiá la URL que te dio Vercel.
2. Generá un QR con cualquier generador gratuito, por ejemplo [qr-code-generator.com](https://www.qr-code-generator.com/) o [me-qr.com](https://me-qr.com/).
3. Imprimí el QR en las mesas, o mostralo en pantalla en la entrada.
4. Los invitados escanean → se abre la página → eligen fotos/videos de su galería → tocan **Subir**. No necesitan instalar nada ni crear cuenta.

---

## 5. Cómo ver las fotos después del evento

Todo lo subido queda en tu bucket de R2, dentro de la carpeta `evento/`:

1. Entrá al [dashboard de Cloudflare](https://dash.cloudflare.com) → **R2** → tu bucket → pestaña **Objects**.
2. Ahí podés navegar, previsualizar y descargar archivos uno por uno.
3. Para bajar todo de una: instalá [`rclone`](https://rclone.org/) (soporta R2 nativamente) o usá el [Wrangler CLI](https://developers.cloudflare.com/r2/reference/api-catalog/) de Cloudflare para sincronizar el bucket completo a tu disco.
4. Cada archivo también quedó registrado con su URL pública en la tabla `uploads` de Supabase (ver sección 6) — útil si querés armar un listado o una galería sin ir a buscar cada uno al dashboard.

---

## 6. Backend de estadísticas globales (Supabase + Vercel Functions)

Las estadísticas por dispositivo (fotos subidas, MB totales, primera/última conexión) viven en una base de datos externa, **no en un archivo JSON**.

> ⚠️ **Por qué no un `stats.json` en el servidor:** las funciones serverless de Vercel no tienen disco persistente. Cada request puede correr en una instancia distinta, y un despliegue nuevo no conserva archivos escritos en el anterior. Por eso el backend usa **Supabase** (Postgres gratis) como base de datos real.

### 6.1 Crear el proyecto en Supabase

1. Creá una cuenta gratis en [supabase.com](https://supabase.com) → **New project**.
2. En **SQL Editor**, ejecutá:

```sql
create table devices (
  device_id text primary key,
  ip text,
  first_seen timestamptz not null,
  last_upload timestamptz not null,
  total_files integer not null default 0,
  total_mb numeric not null default 0
);

create table uploads (
  id bigint generated always as identity primary key,
  device_id text references devices(device_id),
  filename text not null,
  size_mb numeric not null,
  mime_type text,
  url text,
  ip text,
  created_at timestamptz not null default now()
);
```

> Si ya tenías estas tablas de una versión anterior (con Cloudinary), solo hace falta agregar la columna nueva: `alter table uploads add column url text;`

3. En **Settings → API**, copiá la **Project URL** (→ `SUPABASE_URL`) y la **service_role key** (→ `SUPABASE_SERVICE_KEY`, no la `anon` key).

### 6.2 Variables de entorno

Ya están listadas en la sección 2. Sumá también `STATS_API_KEY` (una clave inventada por vos, ej. `evento2026-xyz`) para proteger `/api/stats`.

### 6.3 Consultar las estadísticas después del evento

```
https://tu-evento.vercel.app/api/stats?key=evento2026-xyz
```

```json
{
  "totalDevices": 42,
  "totalFiles": 187,
  "totalMb": 3120.4,
  "devices": [
    { "device_id": "...", "ip": "...", "first_seen": "...", "last_upload": "...", "total_files": 12, "total_mb": 240.1 }
  ]
}
```

Sin la `key` correcta, responde `401 No autorizado`.

---

## Estructura del proyecto

```
event-upload/
├── index.html              → estructura de la página
├── styles.css               → estilos (tema oscuro, un solo acento de color)
├── script.js                → selección, validación, presign + PUT a R2, contador e inactividad
├── api/
│   ├── presign-upload.js    → Vercel Function: genera la URL pre-firmada de subida a R2
│   ├── log-upload.js        → Vercel Function: registra cada subida en Supabase
│   └── stats.js              → Vercel Function: devuelve el resumen global (protegido con key)
├── package.json              → dependencias: @aws-sdk/client-s3, @aws-sdk/s3-request-presigner
└── README.md                 → este archivo
```

## Cómo funciona la subida (Cloudflare R2)

1. El navegador selecciona un archivo y llama a `POST /api/presign-upload` con `{ filename, contentType }`.
2. La función serverless valida que sea imagen o video, arma una key única (`evento/<timestamp>-<random>-<nombre-sanitizado>`) y devuelve una **URL pre-firmada** (`PutObjectCommand` + `getSignedUrl`, válida 5 minutos) junto con la URL pública final.
3. El navegador hace `PUT` **directo contra R2** con el archivo original, intacto — no pasa por nuestro servidor, así que no hay límite de tamaño de payload de Vercel de por medio.
4. Cloudflare confirma la subida; recién ahí el frontend marca el archivo como subido y registra la estadística.

Sobre el alcance del endpoint: el pedido original habla de "imágenes", pero mantuve la validación aceptando `image/*` **y** `video/*` porque el sitio recolecta fotos y videos del evento (así era el comportamiento con Cloudinary) — restringir solo a imágenes rompería la subida de videos. Si preferís que sea estrictamente imágenes, es una línea para cambiar en `api/presign-upload.js` (función `isAllowedContentType`), señalada en un comentario ahí mismo.

**Limitación conocida:** una URL pre-firmada de S3/R2 no impone un límite de tamaño por sí sola (eso requeriría un *presigned POST* con condiciones, que es otro mecanismo). El único control de tamaño hoy es del lado del cliente (`MAX_IMAGE_MB` / `MAX_VIDEO_MB` en `script.js`), que un usuario malicioso podría saltear editando el JS. Si esto te importa, la vía más simple es agregar una Cloudflare Worker/Rule que rechace objetos por tamaño en el bucket, o migrar a presigned POST con `content-length-range`.

## Qué cambió en esta versión

**Migración de Cloudinary a Cloudflare R2**
Se reemplazó la subida a Cloudinary (unsigned upload preset) por subida directa a R2 con URLs pre-firmadas generadas por una función propia (`/api/presign-upload`). El archivo llega a R2 tal cual lo eligió el invitado, sin pasar por Cloudinary ni por nuestro servidor. No había ninguna librería de Cloudinary como dependencia de npm (se usaba su REST API por `fetch`), así que no hay nada que desinstalar; sí se agregaron `@aws-sdk/client-s3` y `@aws-sdk/s3-request-presigner` al `package.json`.

**1. Barra de progreso real**
El progreso por bytes (`XMLHttpRequest.upload.onprogress`) del `PUT` a R2 es real. Igual que antes, hay tres estados: **"Subiendo... X%"** → **"Procesando..."** (bytes ya enviados, esperando la confirmación HTTP de R2) → **"✅ Subida exitosa"**. El botón **Subir** queda deshabilitado hasta que todas las respuestas fueron confirmadas.

**2. Detección de inactividad**
A los 30 minutos sin interacción aparece "Tu sesión expiró" con botón de recarga; se posterga si hay una subida en curso.

**3. Contador persistente por sesión**
`📊 Fotos subidas: X | Tamaño total: Y MB` en `localStorage`, se actualiza en tiempo real.

**4. Estadísticas globales**
Sin cambios de fondo — sigue en Supabase — pero ahora la tabla `uploads` también guarda la `url` pública de R2 de cada archivo.

## Notas de diseño y comportamiento

- **Sin login para los invitados:** la URL pre-firmada es justamente el mecanismo que permite subir sin que el invitado tenga credenciales; las credenciales reales de R2 nunca salen del servidor.
- **Archivo intacto:** el `PUT` manda el `File` original tal cual lo entregó el input o el drag & drop, sin recomprimir ni transformar nada (a diferencia de Cloudinary, R2 no optimiza automáticamente — si en algún momento querés miniaturas o compresión, hace falta agregarlo aparte, por ejemplo con Cloudflare Images o una función propia).
- **Validación en el frontend:** se filtran archivos que no sean imagen/video y se avisa si superan el tamaño máximo (`MAX_IMAGE_MB` / `MAX_VIDEO_MB` en `script.js`).
- **Mobile first:** el `<input type="file" accept="image/*,video/*" multiple>` abre directamente la galería nativa en iOS y Android.
- **Accesibilidad:** foco visible en todos los controles, mensajes de estado con `aria-live`, animación de flash que respeta `prefers-reduced-motion`.
- **El logging de estadísticas nunca bloquea ni rompe la subida real:** si `/api/log-upload` falla, el invitado no se entera y su archivo queda subido en R2 igual.

```


### 3. Eliminar rastros de Cloudinary

No había ninguna librería de Cloudinary como dependencia de npm (se
consumía su REST API vía `fetch`), así que no hay paquete que desinstalar.
Igual, confirmá que no quede código funcional que la referencie:

```bash
grep -rin "cloudinary" --include="*.js" --include="*.html" --include="*.css" --include="*.json" . | grep -v node_modules
```

Solo deberían aparecer menciones dentro de comentarios o del README que
explican el cambio (contexto histórico), nunca código que efectivamente la
llame. Si encontrás algo distinto (por ejemplo un archivo `cloudinary.js` u
otra función serverless vieja apuntando a Cloudinary), eliminalo.

### 4. Instalar dependencias y verificar

```bash
npm install
node -c script.js
node -c api/presign-upload.js
node -c api/log-upload.js
node -c api/stats.js
```

Todos los `node -c` deben terminar sin error (validan sintaxis, no
comportamiento — no hay credenciales reales de R2 en este entorno).

### 5. Variables de entorno (NO van en el repo)

No crees ni completes archivos `.env` con valores reales, y no inventes
credenciales. Estas variables las tiene que cargar el usuario a mano en
**Vercel → su proyecto → Settings → Environment Variables** después de tener
su bucket de R2 creado (instrucciones completas ya están en el README.md que
acabás de escribir, sección 1 y 2):

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_URL`
- `SUPABASE_URL` (sin cambios respecto a la versión anterior)
- `SUPABASE_SERVICE_KEY` (sin cambios)
- `STATS_API_KEY` (sin cambios)

Si el repo tiene un `.env.example` o similar, actualizalo para listar estas
claves sin valores (o con placeholders tipo `TU_VALOR_AQUI`), pero nunca
generes ni commitees secretos reales.

### 6. Commit

Dejá esta migración como el commit más nuevo del branch actual — no
reescribas historia (nada de `rebase -i`, `commit --amend` sobre commits
viejos, ni force-push). Un commit normal, arriba de `HEAD`:

```bash
git add -A
git commit -m "Migrar almacenamiento de Cloudinary a Cloudflare R2 (presigned PUT)

- Nuevo api/presign-upload.js: genera URL pre-firmada via @aws-sdk/s3-request-presigner
  (forcePathStyle habilitado, requerido por R2 para evitar signature mismatch)
- script.js: reemplaza el upload a Cloudinary por presign + PUT directo a R2,
  archivo original intacto, mantiene progreso real y fases Subiendo/Procesando
- api/log-upload.js: acepta y guarda la url publica de R2 en la tabla uploads de Supabase
- package.json: agrega @aws-sdk/client-s3 y @aws-sdk/s3-request-presigner
- README.md: seccion de setup de R2 (bucket, CORS, API token, acceso publico)
  reemplaza la de Cloudinary"
```

### 7. Push

```bash
git push origin HEAD
```

Si el push es rechazado por cambios remotos nuevos, hacé `git pull --rebase`
únicamente sobre commits que no sean el que acabás de crear vos (o sea: traé
lo nuevo del remoto, no reescribas el commit de la migración) y reintentá el
push. Si hay conflictos reales en archivos que no sean los 5 listados arriba,
pausá y avisale al usuario en vez de resolverlos a ciegas.

### 8. Resumen final

Al terminar, mostrale al usuario:
- El hash del commit final y el mensaje.
- Confirmación de que `npm install` y los `node -c` pasaron.
- Un recordatorio de que todavía falta el paso manual: crear el bucket de
  R2, el token de API, la política CORS, y cargar las variables de entorno
  en Vercel (README.md, secciones 1 y 2) — esto el agente no puede hacerlo
  por vos porque requiere acceso a las cuentas de Cloudflare/Supabase/Vercel
  del usuario.

