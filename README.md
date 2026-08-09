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

## Estructura del proyecto

```
event-upload/
├── index.html      → estructura de la página
├── styles.css      → estilos (tema oscuro, un solo acento de color)
├── script.js       → selección de archivos, validación y subida a Cloudinary
└── README.md       → este archivo
```

## Notas de diseño y comportamiento

- **Sin login:** la subida usa un *unsigned upload preset* de Cloudinary; no hay backend propio ni base de datos.
- **Validación en el frontend:** se filtran archivos que no sean imagen/video y se avisa si superan el tamaño máximo (`MAX_IMAGE_MB` / `MAX_VIDEO_MB` en `script.js`), antes de intentar subirlos.
- **Progreso real:** la barra de progreso usa los eventos de subida de `XMLHttpRequest` (no es un progreso simulado).
- **Mobile first:** el `<input type="file" accept="image/*,video/*" multiple>` abre directamente la galería nativa en iOS y Android; no requiere plugins.
- **Accesibilidad:** foco visible en todos los controles, mensajes de estado con `aria-live` para lectores de pantalla, y la animación de flash respeta `prefers-reduced-motion`.
