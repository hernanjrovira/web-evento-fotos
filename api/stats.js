// api/stats.js
//
// Vercel Serverless Function. Devuelve un resumen de las estadísticas
// globales del evento: total de dispositivos, archivos y MB, y el detalle
// por dispositivo. Pensado solo para el organizador.
//
// Protección: requiere ?key=TU_CLAVE (o header x-api-key) que coincida con
// la variable de entorno STATS_API_KEY.

module.exports = async (req, res) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, STATS_API_KEY } = process.env;

  const providedKey = req.query?.key || req.headers["x-api-key"];
  if (!STATS_API_KEY || providedKey !== STATS_API_KEY) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    res.status(500).json({
      error: "Backend no configurado: faltan SUPABASE_URL / SUPABASE_SERVICE_KEY en Vercel",
    });
    return;
  }

  const supabaseUrl = SUPABASE_URL.trim().replace(/\/+$/, "");
  const supabaseKey = SUPABASE_SERVICE_KEY.trim();

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  try {
    const devicesRes = await fetch(
      `${supabaseUrl}/rest/v1/devices?select=device_id,ip,first_seen,last_upload,total_files,total_mb&order=total_mb.desc`,
      { headers }
    );
    if (!devicesRes.ok) {
      throw new Error(await devicesRes.text());
    }
    const devices = await devicesRes.json();

    const totals = devices.reduce(
      (acc, d) => {
        acc.totalFiles += d.total_files || 0;
        acc.totalMb += d.total_mb || 0;
        return acc;
      },
      { totalFiles: 0, totalMb: 0 }
    );

    res.status(200).json({
      totalDevices: devices.length,
      totalFiles: totals.totalFiles,
      totalMb: Math.round(totals.totalMb * 100) / 100,
      devices,
    });
  } catch (err) {
    res.status(502).json({ error: "No se pudieron obtener las estadísticas", detail: String(err) });
  }
};
