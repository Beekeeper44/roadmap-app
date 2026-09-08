import { getSql, ensureTable, connectionString, URL_VARS, missingUrlPayload } from "./_db.js";

/**
 * Open /api/health when saving fails. It walks the four things that actually
 * go wrong, in order: no env var, bad connection string, missing table, or a
 * role that cannot write.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const out = {
    env: false, via: null, connects: false, table: false, writable: false, rows: null,
    present_vars: URL_VARS.filter((n) => !!process.env[n]),
  };

  const { url, via } = connectionString();
  if (!url) return res.status(500).json({ ...out, ...missingUrlPayload() });
  out.env = true;
  out.via = via;

  const sql = getSql();

  try {
    const ping = await sql`SELECT 1 AS ok`;
    out.connects = ping.length === 1;

    await ensureTable(sql);
    out.table = true;

    await sql`
      INSERT INTO app_state (key, value, updated_at)
      VALUES ('__healthcheck', 'ok', now())
      ON CONFLICT (key) DO UPDATE SET value = 'ok', updated_at = now()
    `;
    await sql`DELETE FROM app_state WHERE key = '__healthcheck'`;
    out.writable = true;

    out.rows = await sql`
      SELECT key, length(value) AS bytes, updated_at FROM app_state ORDER BY key
    `;

    return res.status(200).json({ ...out, ok: true });
  } catch (err) {
    out.error = String(err && err.message ? err.message : err);
    if (/password|authentication|scram/i.test(out.error)) {
      out.fix = "The connection string is being rejected. Copy the pooled string from Neon again.";
    } else if (/permission|denied/i.test(out.error)) {
      out.fix = "The role can connect but not write. Use the owner role.";
    } else if (/fetch|network|ENOTFOUND|timeout/i.test(out.error)) {
      out.fix = "Cannot reach the host. Check the string is the pooled endpoint, not the direct one.";
    }
    return res.status(500).json(out);
  }
}
