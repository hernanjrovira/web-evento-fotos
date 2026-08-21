# 📸 Álbum del evento

Página minimalista para que los invitados suban fotos y videos del evento desde su celular, sin login y sin fricción: eligen los archivos, tocan **Subir** y listo. Todo se guarda directo en Cloudinary.

**Stack:** HTML/CSS/JS vanilla (sin dependencias) + Cloudinary (unsigned upload) + Vercel.

---

## 1. Configurar Cloudinary (plan free)

1. Creá una cuenta gratis en [cloudinary.com](https://cloudinary.com/users/register/free).
2. En el **Dashboard**, copiá tu **Cloud Name** (aparece arriba de todo, ej: `dxample123`).
3. Creá un **Upload Preset sin firma** (esto es lo que permite subir archivos sin que el invitado inicie sesión):
   - Ir a **Settings** (ícono de tuerca) → pestaña **Upload**.
   - Bajar hasta **Upload presets** → **Add upload preset**.
   - **Signing Mode:** elegí **Unsigned**.
   - (Opcional) En **Folder** podés fijar una carpeta, ej. `evento`, para que todo quede ordenado.
   - (Opcional) En **Media analysis / Incoming transformation** podés activar optimización automática si querés, aunque Cloudinary ya optimiza la entrega por defecto.
   - Guardá y copiá el **nombre del preset** (ej: `evento_unsigned`).
4. Anotá estos dos datos, los vas a necesitar en el paso 2:
   - `Cloud Name`
   - `Upload Preset` (unsigned)

> ⚠️ El plan free tiene límites de tamaño y de crédito mensual. Si una subida falla por tamaño, revisá el límite vigente en tu dashboard (**Settings → Usage**) y ajustá `MAX_IMAGE_MB` / `MAX_VIDEO_MB` en `script.js`.

---

## 2. Completar la configuración en el código

Abrí `script.js` y editá las primeras líneas:

```js
const CLOUDINARY_CONFIG = {
  cloudName: "TU_CLOUD_NAME",       // el Cloud Name del paso 1
  uploadPreset: "TU_UPLOAD_PRESET", // el preset unsigned del paso 1
  folder: "evento",                 // opcional, o dejalo en ""
};
```

No hace falta ninguna API key ni secreto: el upload preset unsigned es justamente lo que permite que cualquier invitado suba archivos sin credenciales.

---

## 3. Deployar en Vercel

**Opción A — desde la web de Vercel (sin instalar nada):**

1. Subí esta carpeta a un repositorio de GitHub.
2. Entrá a [vercel.com](https://vercel.com) → **Add New → Project**.
3. Importá el repositorio.
4. Como es HTML/CSS/JS estático, Vercel lo detecta automáticamente (no necesita build command ni framework). Dejá todo por defecto y hacé **Deploy**.
5. En un minuto tenés una URL tipo `https://tu-evento.vercel.app`.

**Opción B — desde la terminal:**

```bash
npm install -g vercel
cd event-upload
vercel --prod
```

---

## 4. Generar el QR para los invitados

1. Copiá la URL que te dio Vercel (ej: `https://tu-evento.vercel.app`).
2. Generá un QR con cualquier generador gratuito, por ejemplo [qr-code-generator.com](https://www.qr-code-generator.com/) o [me-qr.com](https://me-qr.com/).
3. Imprimí el QR en las mesas, o mostralo en una pantalla/cartel en la entrada.
4. Los invitados escanean con la cámara del celular → se abre la página en el navegador → eligen fotos/videos de su galería → tocan **Subir**. No necesitan instalar nada ni crear cuenta.

---

## 5. Cómo ver las fotos después del evento

Todo lo subido queda en tu cuenta de Cloudinary:

1. Entrá a tu **Media Library** en [console.cloudinary.com](https://console.cloudinary.com).
2. Si configuraste `folder`, vas a encontrar todo dentro de esa carpeta (ej. `evento/`).
3. Desde ahí podés:
   - Verlas y descargarlas una por una, o
   - Seleccionar varias y descargar un `.zip`, o
   - Usar la [API de Cloudinary](https://cloudinary.com/documentation/admin_api) si querés automatizar la descarga completa de la carpeta.

---

## 6. Backend de estadísticas globales (Supabase + Vercel Functions)

Las estadísticas por dispositivo (fotos subidas, MB totales, primera/última conexión) viven en una base de datos externa, **no en un archivo JSON**. Esto es importante:

> ⚠️ **Por qué no un `stats.json` en el servidor:** las funciones serverless de Vercel no tienen disco persistente. Cada request puede correr en una instancia distinta, y un despliegue nuevo no conserva archivos escritos en el anterior. Un `stats.json` local se perdería o quedaría inconsistente. Por eso el backend (`/api/log-upload.js` y `/api/stats.js`) usa **Supabase** (Postgres gratis) como base de datos real.

### 6.1 Crear el proyecto en Supabase

1. Creá una cuenta gratis en [supabase.com](https://supabase.com) → **New project**.
2. Cuando esté listo, entrá a **SQL Editor** y ejecutá esto para crear las dos tablas:

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
  ip text,
  created_at timestamptz not null default now()
);
```

3. En **Settings → API**, copiá:
   - **Project URL** → esto es tu `SUPABASE_URL`.
   - **service_role key** (no la `anon` key, porque el backend necesita permiso de escritura) → esto es tu `SUPABASE_SERVICE_KEY`.

### 6.2 Configurar las variables de entorno en Vercel

En tu proyecto de Vercel: **Settings → Environment Variables**, agregá:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | la Project URL del paso anterior |
| `SUPABASE_SERVICE_KEY` | la service_role key (¡nunca la pongas en el frontend!) |
| `STATS_API_KEY` | una clave inventada por vos, ej. `evento2026-xyz`, para proteger `/api/stats` |

Después de agregarlas, volvé a deployar (**Deployments → ⋯ → Redeploy**) para que las funciones las tomen.

Las carpetas `api/log-upload.js` y `api/stats.js` ya están en el repo — Vercel las detecta automáticamente como Serverless Functions, no necesitás un servidor Express aparte.

### 6.3 Consultar las estadísticas después del evento

Abrí en el navegador (o con `curl`):

```
https://tu-evento.vercel.app/api/stats?key=evento2026-xyz
```

Vas a recibir algo así:

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

Sin la `key` correcta, el endpoint responde `401 No autorizado`.

---

## Estructura del proyecto

```
event-upload/
├── index.html          → estructura de la página
├── styles.css          → estilos (tema oscuro, un solo acento de color)
├── script.js           → selección, validación, subida a Cloudinary, contador e inactividad
├── api/
│   ├── log-upload.js   → Vercel Function: registra cada subida en Supabase
│   └── stats.js        → Vercel Function: devuelve el resumen global (protegido con key)
├── package.json
└── README.md            → este archivo
```

## Qué cambió en esta versión

**1. Barra de progreso real (antes saltaba a 100% de golpe)**
El progreso por bytes (`XMLHttpRequest.upload.onprogress`) ya era real, pero para archivos que suben rápido —o videos que Cloudinary sigue procesando después de recibir todos los bytes— la barra llegaba a 100% mientras el servidor todavía no confirmaba nada. Ahora hay tres estados explícitos: **"Subiendo... X%"** (mientras se transfieren bytes) → **"Procesando..."** (bytes ya enviados, esperando confirmación del servidor) → **"✅ Subida exitosa"** (recién cuando Cloudinary confirmó todos los archivos). El botón **Subir** queda deshabilitado durante todo ese tramo, no solo mientras se transfieren bytes.

**2. Detección de inactividad**
Después de 30 minutos sin ningún clic, toque, tecla o scroll, aparece un aviso de "Tu sesión expiró" con un botón para recargar. Si el usuario está subiendo algo en ese momento, el aviso se posterga hasta que termine esa subida (no la interrumpe).
Sobre validar el upload preset "antes" de subir: Cloudinary no ofrece un endpoint público para chequear un preset sin intentar una subida real, así que en vez de simular una validación que no existe, el error se detecta en el momento: si Cloudinary responde que el preset no existe o está deshabilitado, el mensaje de error lo dice explícitamente ("la configuración de subida del evento no es válida, avisale al organizador") en vez de un error genérico de red.

**3. Contador persistente por sesión**
En el pie de página aparece `📊 Fotos subidas: X | Tamaño total: Y MB`, guardado en `localStorage` del navegador de cada invitado. Se actualiza en tiempo real con cada archivo confirmado y sobrevive a recargas de página; solo se pierde si el usuario borra el caché del navegador.

**4. Estadísticas globales (todos los dispositivos)**
Cada subida exitosa también se registra (best-effort, sin bloquear la subida real) contra `/api/log-upload`, que acumula por dispositivo en Supabase. Ver la sección 6 más arriba para el setup completo.

## Notas de diseño y comportamiento

- **Sin login para los invitados:** la subida a Cloudinary sigue usando un *unsigned upload preset*; el backend de estadísticas es aparte y no le pide nada al invitado.
- **Validación en el frontend:** se filtran archivos que no sean imagen/video y se avisa si superan el tamaño máximo (`MAX_IMAGE_MB` / `MAX_VIDEO_MB` en `script.js`).
- **Mobile first:** el `<input type="file" accept="image/*,video/*" multiple>` abre directamente la galería nativa en iOS y Android.
- **Accesibilidad:** foco visible en todos los controles, mensajes de estado con `aria-live`, y la animación de flash respeta `prefers-reduced-motion`.
- **El logging de estadísticas nunca bloquea ni rompe la subida real:** si `/api/log-upload` falla (backend no configurado, sin conexión, etc.), el invitado no se entera y su archivo queda subido en Cloudinary igual.
