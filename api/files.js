import { getSql, ensureFiles, missingUrlPayload } from "./_db.js";

/**
 * One row per image, holding a downscaled data URL.
 *
 * Keeping these out of app_state is the point: the board is a single JSON
 * document rewritten on every edit, so an image stored inside it would be
 * re-sent every time anyone typed a character.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const sql = getSql();
  if (!sql) return res.status(500).json(missingUrlPayload());

  try {
    await ensureFiles(sql);

    if (req.method === "GET") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id is required" });

      const rows = await sql`SELECT id, name, data FROM app_files WHERE id = ${id}`;
      if (!rows.length) return res.status(404).json({ error: "not found" });
      return res.status(200).json(rows[0]);
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const { id, name, data } = body;

      if (!id || typeof data !== "string") {
        return res.status(400).json({ error: "id and a data URL string are required" });
      }
      // ~6MB of base64 is about 4.5MB of image; the client downscales well below this
      if (data.length > 8_000_000) {
        return res.status(413).json({ error: "image is too large after resizing" });
      }

      await sql`
        INSERT INTO app_files (id, name, data)
        VALUES (${id}, ${name || null}, ${data})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data
      `;
      return res.status(200).json({ ok: true, id });
    }

    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id is required" });
      await sql`DELETE FROM app_files WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    return res.status(500).json({
      error: String(err && err.message ? err.message : err),
      hint: "Open /api/health for a breakdown",
    });
  }
}
