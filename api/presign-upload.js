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
