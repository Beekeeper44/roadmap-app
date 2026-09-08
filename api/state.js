import { getSql, ensureTable, missingUrlPayload } from "./_db.js";

/**
 * One row per key, holding the whole board as a JSON string.
 *
 * A document write is atomic, so a dropped request can never leave half a
 * board behind. The cost is last-write-wins between two people editing at
 * the same moment — the right trade for a tool with a handful of users.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const sql = getSql();
  if (!sql) return res.status(500).json(missingUrlPayload());

  try {
    await ensureTable(sql);

    if (req.method === "GET") {
      const key = req.query.key;
      if (!key) return res.status(400).json({ error: "key is required" });

      const rows = await sql`
        SELECT value, updated_at FROM app_state WHERE key = ${key}
      `;
      return res.status(200).json(
        rows.length
          ? { value: rows[0].value, updatedAt: rows[0].updated_at }
          : { value: null }
      );
    }

    if (req.method === "POST") {
      // Vercel usually parses JSON, but not if the content-type is off
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const { key, value } = body;

      if (!key) return res.status(400).json({ error: "key is required" });
      if (typeof value !== "string") {
        return res.status(400).json({ error: "value must be a JSON string" });
      }

      const rows = await sql`
        INSERT INTO app_state (key, value, updated_at)
        VALUES (${key}, ${value}, now())
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        RETURNING updated_at
      `;
      return res.status(200).json({ ok: true, updatedAt: rows[0].updated_at });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    // never swallow this — a silent 500 looks identical to "nothing saved"
    return res.status(500).json({
      error: String(err && err.message ? err.message : err),
      hint: "Open /api/health for a breakdown",
    });
  }
}
