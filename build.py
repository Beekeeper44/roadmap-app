"""Generate public/app.jsx from the canonical component.

Kept as a script so the browser build and the artifact cannot drift: every
swap below is asserted, and a silent no-op fails the build.
"""
import re, sys

src = open('/mnt/user-data/outputs/admin-roadmap.jsx').read()
swaps = []

def swap(old, new, label):
    global src
    if old not in src:
        swaps.append((label, False)); return
    src = src.replace(old, new); swaps.append((label, True))

swap('import React, { useState, useEffect, useMemo, useRef } from "react";', '''/* global React, ReactDOM */
const { useState, useEffect, useMemo, useRef } = React;

/* Storage: same shape as the browser API it replaces, backed by Neon
   through /api/state so everyone sees the same board. Saves are mirrored
   locally first, so a failed write never loses the board. */
const store = {
  cache(key, value) {
    try { localStorage.setItem(`${key}::pending`, value); } catch (e) {}
  },
  clearCache(key) {
    try { localStorage.removeItem(`${key}::pending`); } catch (e) {}
  },
  readCache(key) {
    try { return localStorage.getItem(`${key}::pending`); } catch (e) { return null; }
  },

  async get(key) {
    const r = await fetch(`/api/state?key=${encodeURIComponent(key)}`);
    if (!r.ok) throw new Error(`load failed: ${r.status}`);
    const j = await r.json();
    if (j.value == null) throw new Error("no saved state yet");
    return { key, value: j.value, updatedAt: j.updatedAt };
  },

  async set(key, value, attempt = 0) {
    this.cache(key, value);
    const r = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!r.ok) {
      let detail = `HTTP ${r.status}`;
      try {
        const j = await r.json();
        if (j && j.error) detail = j.error;
      } catch (e) { /* not JSON — keep the status */ }
      if (attempt < 2 && (r.status >= 500 || r.status === 0)) {
        await new Promise((ok) => setTimeout(ok, 400 * (attempt + 1)));
        return this.set(key, value, attempt + 1);
      }
      throw new Error(detail);
    }
    this.clearCache(key);
    return r.json();
  },
};''', 'react + store')

# attachments go to their own endpoint, not the board document
swap('''const files = {
  async put(id, payload) {
    await window.storage.set(`file:${id}`, JSON.stringify(payload));
  },
  async get(id) {
    const r = await window.storage.get(`file:${id}`);
    return r && r.value ? JSON.parse(r.value) : null;
  },
  async del(id) {
    try { await window.storage.delete(`file:${id}`); } catch (e) { /* already gone */ }
  },
};''', '''const files = {
  async put(id, payload) {
    const r = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: payload.name, data: payload.dataUrl }),
    });
    if (!r.ok) {
      let detail = `HTTP ${r.status}`;
      try { const j = await r.json(); if (j && j.error) detail = j.error; } catch (e) {}
      throw new Error(detail);
    }
    return r.json();
  },
  async get(id) {
    const r = await fetch(`/api/files?id=${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.data ? { dataUrl: j.data, name: j.name } : null;
  },
  async del(id) {
    try {
      await fetch(`/api/files?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (e) { /* already gone */ }
  },
};''', 'files adapter')

swap('''      try {
        const r = await window.storage.get(KEY);
        if (r && r.value) {
          const p = JSON.parse(r.value);''', '''      let r = null;
      try {
        r = await store.get(KEY);
      } catch (e) {
        /* nothing saved yet, or the server is unreachable — fall through to
           whatever is cached locally, then to the seed */
      }
      try {
        const pending = store.readCache(KEY);
        const raw = pending || (r && r.value);
        if (raw) {
          const p = JSON.parse(raw);''', 'load path')

swap('window.storage\n        .set(', 'store\n        .set(', 'save call')
swap('export default function Roadmap()', 'function Roadmap()', 'no default export')

swap('''  const [histFilter, setHistFilter] = useState("All changes");''',
'''  const [histFilter, setHistFilter] = useState("All changes");
  const [saveState, setSaveState] = useState("idle");
  const [saveError, setSaveError] = useState("");''', 'save state')

swap('''    const t = setTimeout(() => {
      store
        .set(KEY, JSON.stringify({
          items, decisions, risks, events, removed: Array.from(removedIds),
        }))
        .catch(() => {});
    }, 400);''', '''    const t = setTimeout(() => {
      setSaveState("saving");
      store
        .set(KEY, JSON.stringify({
          items, decisions, risks, events, removed: Array.from(removedIds),
        }))
        .then(() => { setSaveState("saved"); setSaveError(""); })
        .catch((err) => { setSaveState("error"); setSaveError(String(err.message || err)); });
    }, 600);''', 'save indicator')

swap('''            <span className="text-sm" style={{ color: C.faint }}>
              press <kbd''', '''            <span className="text-sm" style={{
              color: saveState === "error" ? DUE_TONE.late.fg : C.faint,
              fontWeight: saveState === "error" ? 600 : 400,
            }}>
              {saveState === "saving" ? "Saving\\u2026"
                : saveState === "error"
                  ? <a href="/api/health" target="_blank" rel="noreferrer" title={saveError}
                       style={{ color: "inherit", textDecoration: "underline" }}>
                      Not saved: {saveError || "unknown error"}
                    </a>
                : saveState === "saved" ? "Saved" : "\\u00A0"}
            </span>
            <span className="text-sm" style={{ color: C.faint }}>
              press <kbd''', 'masthead status')

src += '\n\nReactDOM.createRoot(document.getElementById("root")).render(<Roadmap />);\n'
open('public/app.jsx', 'w').write(src)

failed = [l for l, ok in swaps if not ok]
for l, ok in swaps:
    print(('OK   ' if ok else 'MISS ') + l)

checks = {
    'no window.storage': 'window.storage' not in src,
    'no imports': not re.search(r'^import ', src, re.M),
    'files -> /api/files': '/api/files' in src,
    'mounts': 'createRoot' in src,
}
for k, v in checks.items():
    print(('OK   ' if v else 'FAIL ') + k)
    if not v: failed.append(k)

sys.exit(1 if failed else 0)
