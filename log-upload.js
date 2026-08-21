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

  const { deviceId, fileName, fileSize, mimeType } = body || {};
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
