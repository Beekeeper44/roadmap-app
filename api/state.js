import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

/**
 * One row per key, holding the whole board as a JSON string.
 *
 * That is deliberate. The app already treats its state as a single
 * document, and a document write is atomic — no half-saved board if a
 * request dies midway. The cost is last-write-wins between two people
 * editing at the same moment, which is the right trade for a tool with a
 * handful of users. If concurrent editing ever becomes real, the change
 * is to split items into their own table and write per row.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
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
      const { key, value } = req.body || {};
      if (!key || typeof value !== "string") {
        return res.status(400).json({ error: "key and string value are required" });
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
    // surface the reason — a silent 500 here looks identical to "nothing saved"
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
