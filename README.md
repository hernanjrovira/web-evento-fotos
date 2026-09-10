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
