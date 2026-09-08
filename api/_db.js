import { neon } from "@neondatabase/serverless";

/**
 * The connection string lands under different names depending on how the
 * database got attached: DATABASE_URL if you added it by hand, POSTGRES_URL
 * if you used the Vercel Neon/Postgres integration. Accept all of them
 * rather than making the deployment match one guess.
 */
export const URL_VARS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "NEON_DATABASE_URL",
  "DATABASE_POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL_UNPOOLED",
];

export function connectionString() {
  for (const name of URL_VARS) {
    const v = process.env[name];
    if (v && v.trim()) return { url: v.trim(), via: name };
  }
  return { url: null, via: null };
}

/**
 * Build the client lazily. Calling neon() at module scope with an undefined
 * string throws while the module is still loading, which makes every request
 * fail with an opaque 500 — including the check that was meant to explain it.
 */
let cached = null;
export function getSql() {
  if (cached) return cached;
  const { url } = connectionString();
  if (!url) return null;
  cached = neon(url);
  return cached;
}

let ensured = false;
export async function ensureTable(sql) {
  if (ensured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      key        text PRIMARY KEY,
      value      text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  ensured = true;
}

export function missingUrlPayload() {
  return {
    error: "No database connection string found in the environment.",
    looked_for: URL_VARS,
    fix: "Add DATABASE_URL (the pooled Neon string) under Settings > Environment Variables for Production, Preview and Development, then REDEPLOY. Environment variables are baked in at build time, so an existing deployment will not pick them up.",
  };
}
