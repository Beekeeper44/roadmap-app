/* global React, ReactDOM */
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
};

/* ==========================================================
   Arena Club — Admin Roadmap status report
   Reads as a prepared document, works as a live tool:
   click a stat to filter, drag a row to reorder, drag a row
   onto a status pill to move it, click a row to edit.
   ========================================================== */

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const C = {
  ink: "#1A1D21",
  body: "#454B52",
  mute: "#7B838C",
  faint: "#9AA1A9",
  rule: "#E4E7EA",
  ruleSoft: "#EFF1F3",
  page: "#FFFFFF",
  shell: "#F6F7F8",
  accent: "#2C6EBF",
};

/* status vocabulary, shared by the stat cards, pills and badges */
const STATUS = {
  Shipped:          { bg: "#E4F3E9", fg: "#237748", dot: "#3B9A69" },
  "In progress":    { bg: "#E5EFFB", fg: "#22558F", dot: "#3D7EC4" },
  "Ready to build": { bg: "#FCF1D8", fg: "#8A5B00", dot: "#C89327" },
  Blocked:          { bg: "#FBE7E6", fg: "#A63A2E", dot: "#C4544A" },
  "Deferred / other": { bg: "#EFE7F1", fg: "#6B4A73", dot: "#9C6FA6" },
  "Needs discovery":  { bg: "#EEF0F2", fg: "#5A636C", dot: "#8B949D" },
  "Up for discussion": { bg: "#E2F0EF", fg: "#1F6B66", dot: "#3E9791" },
  History:            { bg: "#E4F3E9", fg: "#237748", dot: "#3B9A69" },
};

const BOARDS = {
  prd: {
    label: "Admin roadmap",
    title: "Admin Roadmap — Discovery & Status Update",
    byline: "Prepared by Sumit, India Team Lead · August 31, 2026 · Source: 6 PRDs, 8/18 Ops discovery call, Admin Roadmap brief",
    /* Shipped is terminal: choosing it stamps the finish date, takes the row
       off this board, and files it under History. It sits last in the list
       because it is an exit, not a stage. */
    statuses: ["In progress", "Ready to build", "Blocked", "Needs discovery", "Deferred / other", "Shipped"],
    columns: [
      { key: "item",        label: "PRD name",                w: 1.3 },
      { key: "phase",       label: "Phase",                   w: 0.9 },
      { key: "task",        label: "Task",                    w: 2.4, clamp: 3 },
      { key: "status",      label: "Readiness",               px: 165, badge: true },
      { key: "due",         label: "Due",                     px: 175, due: true },
      { key: "owner",       label: "Owner",                   w: 0.8 },
      { key: "developer",   label: "Developer",               w: 0.9 },
      { key: "estimate",    label: "Est. (days)",             px: 100, num: true },
      { key: "blockers",    label: "Dependencies / blockers", w: 1.6, clamp: 3 },
      { key: "notes",       label: "Notes",                   w: 1.8, clamp: 3 },
      { key: "analysisDoc", label: "Analysis doc",            w: 0.9, clamp: 2 },
    ],
  },
  intake: {
    label: "Intake requests",
    title: "Product Intake — Request Log",
    byline: "Ops and warehouse intake · reviewed weekly · source: intake sheet",
    /* intake is a holding pen, not a build board. Nothing here is shipped
       or in flight — the moment it is picked up it moves to the roadmap. */
    statuses: ["Up for discussion", "Blocked", "Needs discovery", "Deferred / other"],
    columns: [
      { key: "item",     label: "Request",           w: 1.3 },
      { key: "type",     label: "Type",              px: 110 },
      { key: "task",     label: "Problem statement", w: 2.6, clamp: 3 },
      { key: "status",   label: "Status",            px: 165, badge: true },
      { key: "due",      label: "Due",               px: 175, due: true },
      { key: "owner",    label: "Requested by",      w: 0.9 },
      { key: "developer", label: "Developer",        w: 0.9 },
      { key: "teams",    label: "Teams impacted",    w: 1.1, clamp: 2 },
      { key: "impact",   label: "Business impact",   w: 1.4, clamp: 3 },
      { key: "notes",    label: "Notes",             w: 1.4, clamp: 3 },
    ],
  },
};

/* Images live under their own keys, not inside the board document. The
   board is saved as a single JSON blob on every edit — putting screenshots
   in it would mean re-uploading every image on every keystroke. */
const files = {
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
};

/* PDFs go in whole — no downscaling to do. The ceiling is the 8M characters
   the files endpoint accepts, and base64 costs about a third on top, so the
   real limit is a little over 5MB of PDF. */
const PDF_LIMIT = 5 * 1024 * 1024;

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`could not read ${file.name}`));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });

const prettySize = (bytes) =>
  bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/* Downscale before storing. A phone screenshot is several megabytes and
   nobody needs that to read a UI mock. */
const compressImage = (file, maxPx = 1600, quality = 0.72) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("could not read that file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(`${file.name} is not an image`));
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        /* A PNG of a spreadsheet is mostly text, and JPEG smears text. Keep
           PNG lossless and only re-encode photographs. */
        const png = file.type === "image/png";
        const dataUrl = png
          ? canvas.toDataURL("image/png")
          : canvas.toDataURL("image/jpeg", quality);
        resolve({ dataUrl, w, h });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

/* A URL pasted without a scheme resolves relative to this app, which sends
   you somewhere useless. Add https:// when it is missing. */
const asHref = (v) => {
  const t = String(v || "").trim();
  if (!t) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
};

/* Chrome and Safari block opening a data: URL in a new tab, which is what a
   thumbnail link would be. Convert to a blob URL first. */
const openInNewTab = async (dataUrl, name) => {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) { URL.revokeObjectURL(url); return false; }   // pop-up blocked
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  } catch (e) {
    return false;
  }
};

/* Shipped is the old name, History the new one — both mean archived, and
   both display as Shipped in the History view. */
const ARCHIVED = ["Shipped", "History"];
const isArchived = (i) => ARCHIVED.includes(i.status);

/* dates are plain YYYY-MM-DD strings; parse at local midnight so a date
   never slips a day depending on the timezone */
const asDate = (str) => {
  if (!str) return null;
  const d = new Date(`${str}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const DAY = 86400000;

/* "Fri, 12 Sep" plus how far off it is, and how alarmed to look */
const dueInfo = (str) => {
  const d = asDate(str);
  if (!d) return null;
  const days = Math.round((d - startOfToday()) / DAY);
  const label = d.toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short",
  });
  let rel, tone;
  if (days < 0)        { rel = `${-days} day${days === -1 ? "" : "s"} late`; tone = "late"; }
  else if (days === 0) { rel = "today";      tone = "soon"; }
  else if (days === 1) { rel = "tomorrow";   tone = "soon"; }
  else if (days <= 5)  { rel = `in ${days} days`; tone = "soon"; }
  else                 { rel = `in ${days} days`; tone = "calm"; }
  return { label, rel, tone, days };
};

const DUE_TONE = {
  late: { fg: "#A63A2E", bg: "#FBE7E6" },
  soon: { fg: "#8A5B00", bg: "#FCF1D8" },
  calm: { fg: "#454B52", bg: "transparent" },
};

const today = () => {
  const d = startOfToday();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* flex vs fixed width, in one place */
const colStyle = (c) =>
  c.px ? { width: c.px, flexShrink: 0 } : { flex: `${c.w} 1 0`, minWidth: 0 };

/* long cells show a few lines and keep the rest for the detail panel */
const clampStyle = (n) => n
  ? { display: "-webkit-box", WebkitLineClamp: n, WebkitBoxOrient: "vertical",
      overflow: "hidden", lineHeight: 1.45 }
  : { lineHeight: 1.45 };

/* Ids are derived from the row itself rather than a counter. That matters:
   with a counter, inserting one seed row renumbers every row after it, and
   saved data can no longer be matched against the seed. */
const slug = (...parts) =>
  parts.filter(Boolean).join("~")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);

/* ------------------------------- roadmap ------------------------------- */

const PRD = [
  {
    item: "PO Number in Work Queues", phase: "Ph1 — Queue column", status: "Shipped",
    owner: "Abhijeet", next: "None", estimate: "2",
    task: "PO column in 4 queues (Vaulting, Editing, PreProcessing, Processing) — sortable and searchable.",
    notes: "Field already exists and is joined to order; display + query change only. Confirmed easy in call.",
    blockers: "",
  },
  {
    item: "PO Number in Work Queues", phase: "Ph1 — Task header", status: "Shipped",
    owner: "Abhijeet", next: "Confirm multi-PO question retroactively", estimate: "2",
    task: "PO number on task header beside order number.",
    notes: "Two separate builds per PRD — column and header both needed. Open item: does one order carry more than one PO?",
    blockers: "",
  },
  {
    item: "PO Number in Work Queues", phase: "Ph2 — Line thumbnail", status: "Deferred / other",
    owner: "", next: "Revisit after image-source decision", estimate: "",
    task: "Line thumbnail on preprocessing line.",
    notes: "Sumit explicitly deferred this on the call. Do not estimate yet.",
    blockers: "",
  },
  {
    item: 'Box Screen "Load 10 / 12"', phase: "N/A", status: "Shipped",
    owner: "Aditya Dixit", next: "None", estimate: "4",
    task: "Box screen: replace single 'Load All' button with 'Load 10' / 'Load 12' preset buttons. 91% of intake is pre-graded slabs, 10-12 fit per box.",
    notes: "Raised live on the call by Sumit/Alan. Alan has a prototype and has already validated with end users. Small, well-scoped UI change — good filler / quick win per Alan's request.",
    blockers: "",
  },
  {
    item: "Card Type — Data Entry", phase: "Change 2 — Subgrade sort", status: "In progress",
    owner: "Aditya D", next: "Continue build", estimate: "",
    task: "Reverse subgrade dropdown sort, mirroring the overall dropdown change already shipped.",
    notes: "Overall dropdown already redone 10-to-1; subgrade (Beckett) categories still 1-to-10. Small, mechanical fix confirmed on call.",
    blockers: "",
  },
  {
    item: "Card Type — Data Entry", phase: "Change 3 — Set ID optional", status: "In progress",
    owner: "Amit D", next: "Waiting on Amit's downstream check", estimate: "",
    task: "Remove the Set ID requirement.",
    notes: "Alan is confident it's safe; Amit to confirm via Metabase query before build.",
    blockers: "Amit is checking whether removing Set ID causes downstream issues — card is identified via set ID + subset ID / insert ID.",
  },
  {
    item: "Card Not Found — Vaulting Scan", phase: "Ph1 — Status modal + logging", status: "Ready to build",
    owner: "Sushant", next: "Estimate & schedule", estimate: "",
    task: "Replace the generic 'Card not found' alert with a real status modal (vaulted / pending shipping / archive / data issue / support / not found), and log the status returned by every scan.",
    notes: "Display only, no routing logic change. Alan shared a working prototype — team to mimic existing layout. Larger ADAC number font is a UI fix. The logging ships with Phase 1 and is what sizes Phase 2/3 later.",
    blockers: "",
  },
  {
    item: "Card Type / Card Hedge Suggestions", phase: "Ph1", status: "Ready to build",
    owner: "Unassigned", next: "Estimate & schedule", estimate: "",
    task: "Cert-driven suggestions across 5 steps (set, insert, card, parallel, comp) with sync eligibility rules.",
    notes: "PRD marked scoped and settled by Alan — not discussed on this call.",
    blockers: "", analysisDoc: "no new changes.",
  },
  {
    item: "Check-in / Check-out", phase: "Ph2 — Attribution log", status: "Ready to build",
    owner: "Unassigned", next: "Estimate & schedule", estimate: "",
    task: "Ops log — attribution of who checked an item in or out.",
    notes: "Alan confirmed this is straightforward ops-log work.",
    blockers: "",
  },
  {
    item: "Card Type — Data Entry", phase: "Change 1 — New grade values", status: "Blocked",
    owner: "Alan / Ops team", next: "Decide: separate grade or plain-10 designation", estimate: "",
    task: "Add Pristine 10 / Black Label 10 / Gold 10 to the pregraded dropdown.",
    notes: "Open question of whether these are separate grade values or a designation on plain 10 — affects comps and pricing. Not ready to size.",
    blockers: "Alan doing more homework on grading criteria impact.",
  },
  {
    item: "Sort on Admin Tables", phase: "Ph1", status: "Blocked",
    owner: "Alan / Ops team", next: "Confirm sort-at-query feasibility + column list", estimate: "",
    task: "Server-side sort across the whole result set on Orders, Cards, Items and all queue pages.",
    notes: "Ask is 'sort on every column' per PRD, but Alan is validating actual priority columns with the ops team to avoid unnecessary or slow sorts. Wait for his list before finalizing scope — the core mechanism can still be estimated now.",
    blockers: "Alan confirming which columns are priority. Estimate value confirmed; ~2-3 more per page pending.",
  },
  {
    item: "Card Not Found — Vaulting Scan", phase: "Ph2 / Ph3", status: "Blocked",
    owner: "Alan / Ops team", next: "Waiting on Ph1 log data", estimate: "",
    task: "Re-vault a card from the station (move + release old slot); flagged / archived bin with tracked slot.",
    notes: "Sumit flagged that re-vault needs analysis before scoping. Alan called the flagged-bin half the harder one — do not estimate until Phase 1 data is in.",
    blockers: "Depends on Phase 1 log data.",
  },
  {
    item: "Check-in / Check-out", phase: "Ph1", status: "Blocked",
    owner: "Alan / Ops team", next: "Who else reads external check-out status?", estimate: "",
    task: "Remove all 4 states (ext/int check-in/check-out) and route retrieval orders directly through Pending Retrieval → scan bin → scan item → Pending Shipping, mirroring the watch flow.",
    notes: "Called 'the biggest lift' and 'big fun one' by Alan. Sumit flagged this needs analysis before removing steps, especially backward compatibility for existing orders.",
    blockers: "Needs edge-case analysis across all 4 statuses for existing vs new orders.",
  },
  {
    item: "Check-in / Check-out", phase: "Ph3 — Flagged bin", status: "Deferred / other",
    owner: "", next: "Paused on 8/18 call", estimate: "",
    task: "Marked flagged bin for cards that fail Pending Checkout.",
    notes: "Explicitly skipped on the call — 'let's pass on that'. Do not estimate now.",
    blockers: "",
  },
  {
    item: "Card Type / Card Hedge Suggestions", phase: "Ph2", status: "Deferred / other",
    owner: "", next: "Needs Ph1 measurement data", estimate: "",
    task: "Auto-accept band, identity-keyed comp recalculation, Card Hedge miss fallback.",
    notes: "Explicitly sequenced by what Phase 1 measures. Do not estimate yet.",
    blockers: "Needs Phase 1 measurement data first.",
  },
  {
    item: "Remove Bin Scan Validation", phase: "—", status: "Needs discovery",
    owner: "Michael, Luis", next: "Write spec / define scope", estimate: "",
    task: "For watches, ops wants to remove mandatory bin scan validation from the release, retrieval and shipping flows so operators can scan items directly without first scanning storage bins. When releasing watches a rack is a bin, so a user has to walk to the rack in the vault to scan it — releasing watches is usually done at a workstation, not in the aisles. Validation stays in place for the vaulting flow.",
    notes: "Raised in intake by Michael, Luis. Sheet note: add to check in/out intake request, add to PRD. Distinct from Check-in / Check-out Ph1 — that removes the four check states for cards; this removes bin-scan validation on three watch flows and keeps it for vaulting.",
    blockers: "",
  },
  {
    item: "Bulk Recomp", phase: "—", status: "Needs discovery",
    owner: "", next: "Write spec / define scope", estimate: "",
    task: "Bulk recomp.", notes: "", blockers: "",
  },
  {
    item: "Submit Order in Admin (Slabs & Raw)", phase: "—", status: "Needs discovery",
    owner: "", next: "Write spec / define scope", estimate: "",
    task: "Create a submit order in admin for slabs and raw.", notes: "", blockers: "",
  },
  {
    item: "Bulk Tag in Warehouse", phase: "—", status: "Needs discovery",
    owner: "", next: "Write spec / define scope", estimate: "",
    task: "Add bulk tag in warehouse.", notes: "", blockers: "",
  },
  {
    item: "Auto Approve", phase: "Ph1 — Edge", status: "Needs discovery",
    owner: "", next: "Write spec / define scope", estimate: "",
    task: "Edge auto approve.", notes: "", blockers: "",
  },
  {
    item: "Auto Approve", phase: "Ph2 — Corner", status: "Needs discovery",
    owner: "", next: "Write spec / define scope", estimate: "",
    task: "Corner auto approve.", notes: "", blockers: "",
  },
  {
    item: "Admin Split", phase: "Ph2 — Fix Phase 1 bugs", status: "In progress",
    owner: "", next: "Continue build", estimate: "",
    task: "Fix Phase 1 bugs from the admin / consumer split.", notes: "", blockers: "",
  },
  {
    item: "Admin Split", phase: "Ph2 — Remove web & consumer API code", status: "In progress",
    owner: "", next: "Continue build", estimate: "",
    task: "Remove web and consumer API code from admin.", notes: "", blockers: "",
  },
  {
    item: "Admin Split", phase: "Ph2 — Performance improvements", status: "In progress",
    owner: "", next: "Continue build", estimate: "",
    task: "Performance improvements following the split.", notes: "", blockers: "",
  },
].map((r) => ({
  ...r, id: slug("prd", r.item, r.phase), board: "prd", type: "",
  developer: r.developer || "",
  prdFile: r.prdFile || null, prdFlag: r.prdFlag || false, adminUrl: r.adminUrl || "",
  images: r.images || [], impactImages: r.impactImages || [],
  analysisDoc: r.analysisDoc || "",
  due: r.due || "",
  finished: r.status === "Shipped" ? (r.finished || "") : "",
}));

/* -------------------------------- intake -------------------------------- */

const mk = (item, status, owner, next, task, opts = {}) => ({
  id: slug("intake", item), board: "intake", item, status, owner, next, task,
  phase: opts.phase || "—", type: opts.type || "", notes: opts.notes || "",
  due: opts.due || "", finished: opts.finished || "",
  developer: opts.developer || "",
  prdFile: null, prdFlag: false, adminUrl: opts.adminUrl || "",
  images: [], impactImages: [],
  blockers: opts.blockers || "", estimate: "", teams: opts.teams || "",
  impact: opts.impact || "",
});

const INTAKE = [
  mk("Cards to Items cutover", "Shipped", "Tech", "None",
    "Admin and Consumer sit on the same dB, which causes issues with releases and impacts data storage. Split ADMIN and CONSUMER — to do that we need to know which data is consumer-primary and needs connection points to Admin.",
    { teams: "All Teams", type: "Platform" }),
  mk("Cropping tool — task per hour limit", "Shipped", "Alan", "None",
    "Crop Tool was limited in task per hour.",
    { impact: "70K per whole PL", notes: "Would need discovery — would go to Sean" }),
  mk("Label printers — print all alignment", "Shipped", "Assembly", "None",
    "When we hit print all, it will not align labels so we have to print labels individually.",
    { teams: "Assembly", impact: "Fixed last week" }),
  mk("Card type overall dropdown order", "Shipped", "Alan", "None",
    "Card type additional overall dropdown 10-A, highest number at the top.", { type: "Quick win" }),
  mk("PO display across queues", "Shipped", "Michael", "None",
    "The PO # only shows up in the Imaging Queue. It should also show in the Editing & Vaulting Queue, and when you click to process the order and move through the current task.",
    { type: "Quick win" }),
  mk("PO lookup plus line thumbnail", "Shipped", "Brock", "None",
    "PO lookup addition to the Editing, Vaulting, PreProcessing and Processing queues, plus a thumbnail (or blank 'no image') on the line once a Reference # and variant are selected.",
    { type: "Quick win" }),
  mk("Items processing flow — Phase 2", "In progress", "Company Wide", "Continue build",
    "To expand category expansion we need to move from cards-specific into items-based. Goal was to start with watches in MVP state.",
    { teams: "Watches, Tech", phase: "Ph2", notes: "Unified flow merge" }),
  mk("Card Not Found", "In progress", "Jackie, Luis, Brad", "V2 build continuing",
    "~200 cards per day are archived after we've already paid for them and processed them, forcing each recoverable card back through the full pipeline a second time and driving ~$415K/year in external re-holdering fees plus daily recon labor. Root causes are upstream and preventable: vendor quality misses on medium/low value cards, a triage policy that defaults to archiving rather than reworking, and a system constraint that blocks re-storing a card with an existing location.",
    { teams: "Processing, Scanning, Vaulting, Grading (inc PL), Recon TMs", type: "Quick win",
      impact: "External fees ~$415K/year known. Doubled pipeline labor: per-card cost × cards/day recovered × 260 days × 2 — likely the biggest line. Working capital tied up: avg dollar value out of pool × 3-4 week avg cycle × cost of capital. Effective write-offs: low-value cards/day not worth recovery × COGS." }),
  mk("Make set ID input optional on card type edits", "Ready to build", "Alan", "Estimate & schedule",
    "Remove the pop-up set ID input on edits in card type (card section only). Make set up optional.",
    { type: "Quick win" }),
  mk("Additional pregraded dropdown options", "Ready to build", "Alan", "Estimate & schedule",
    "Add Pristine 10, Black Label 10, Gold 10 to the dropdown for pregraded slabs in Data.",
    { type: "Quick win" }),
  mk("Sort on all admin pages", "Ready to build", "Ops", "Estimate & schedule",
    "Only a few pages allow sorting, which delays getting work done. Add sort to all main admin pages — orders, cards, items, order detail.",
    { type: "Quick win" }),
  mk("Auto-approve human sub-grade verify", "Ready to build", "Alan", "Estimate & schedule",
    "Raw cards are slowing because sub grades need a secondary verify. Make corner and edges verify work like the crop task — if a human completes it, it approves itself and skips the verify step.",
    { teams: "Review / Grading", type: "Quick win" }),
  mk("Scanner to station assignment", "Ready to build", "Scanning", "Estimate & schedule",
    "Regardless of which station I am at, I have to log into the scanners. It defaults to scanner 1, 2 and 3, so if I do not pay attention I will clear my peers' work. Assign scanners to stations to remove the login and reduce errors.",
    { type: "Quick win", notes: "Added from walk on 07/13" }),
  mk("Internal / external check-out flow", "Blocked", "Ops", "Confirm overlap with Check-in / Check-out PRD",
    "Remove unnecessary steps in vaulting and retrieval. We no longer have an offsite vault, so check in/out is unnecessary. Remove during vaulting; during OB, move validation earlier (during picking) to streamline.",
    { teams: "Outbound Processing", type: "Quick win", blockers: "Duplicates the Check-in / Check-out roadmap item" }),
  mk("Admin UI flow (watches and items pages)", "Blocked", "BG, Michael", "Scope against unified flow",
    "The Orders page should be the primary workflow hub, with next steps unlocking progressively. No jumping around, going backwards, skipping steps or re-entering the order #. No page-forward function beyond 25 items. No sort by AC#, brand or bin.",
    { blockers: "Overlaps unified flow work already in flight" }),
  mk("Separate processing, vaulting and shipping bins", "Blocked", "Luis", "Add cost savings to PRD",
    "Separate processing, vaulting and shipping bins into three distinct sections with their own number sequencing. Right now it's all lumped together, which makes expanding any section harder and leaves confusing gaps.",
    { impact: "Walk thru biz case with this one", blockers: "Needs cost savings written into the PRD" }),
  mk("Ability to cancel / edit order", "Blocked", "Jackie", "Business impact needed",
    "Orders cannot be edited or cancelled, which leads to archiving cards or creating new orders for cards to be re-ingested.",
    { teams: "Processing, Scanning", type: "Quick win", blockers: "Business impact needed before approval" }),
  mk("Recrop should not reset other subgrades", "Deferred / other", "Alan", "Revisit with cropping tool work",
    "Recrop should not trigger a reset in other subgrades.",
    { impact: "70K per whole PL", notes: "Would need discovery — would go to Sean" }),
  mk("Scanning page — printer dropdown order", "Deferred / other", "Luis", "Bundle with scanner station work",
    "The Scanning page doesn't match how the workflow runs. Scanners select from a long dropdown each time. The Epson is most used but the Fuji is listed first, and labels can only print from the Fuji section, so scanners toggle back and forth.",
    { teams: "Scanning" }),
  mk("Receipt printer resets to null", "Deferred / other", "Scanning", "Bundle with scanner station work",
    "After each scan run the receipt printer defaults back to null and has to be reselected. Add presets for scanner stations with scanners and printer synced.",
    { teams: "Scanning" }),
  mk("Admin user access tiers", "Needs discovery", "Operations, Technology", "Write spec / define scope",
    "Giving users access to ADMIN takes more time than needed. Define tiers of access so users get the right permissions first time.",
    { teams: "All Admin Users" }),
  mk("Order confirmation integration", "Needs discovery", "Lilly", "Write spec / define scope",
    "Order confirmation is not included in order creation logs. Not all customers include it in the box, causing extra research for processing.",
    { teams: "Processing" }),
  mk("Bin consolidation", "Needs discovery", "BG", "Write spec / define scope",
    "Consolidate partial bins efficiently. We are at 50% or less utilization on older bins — merging three partial bins would save storage space.",
    { teams: "Vaulting / Shipping / Inventory" }),
  mk("Inventory transfer", "Needs discovery", "BG", "Confirm which pages this lives on",
    "Quickly transfer individual cards from one bin to another. Today this means typing the new bin and slot number on the card page — very error prone."),
  mk("Cycle count", "Needs discovery", "BG", "Write spec / define scope",
    "To maintain inventory accuracy metrics we need a cycle count process that systemically generates random bins to audit.",
    { teams: "All" }),
  mk("Bin / box creation and adjustments", "Needs discovery", "Luis", "Write spec / define scope",
    "Too slow and manual, and there's no way to change status once created — mistakes stick until someone edits the database directly.",
    { teams: "Vaulting / Shipping" }),
  mk("Correcting bin status", "Needs discovery", "Luis", "Write spec / define scope",
    "Bin status does not change as cards move through processing. We rely on Metabase to find bins ready to vault, which makes it hard to search for bins in a specific state.",
    { teams: "Vaulting" }),
  mk("Watch receiving & sorting", "Deferred / other", "BG, Michael", "Confirm overlap with items processing",
    "Support receiving and sorting of watch invoices on arrival, with label creation and printing tied to the watch record.",
    { impact: "Tied to items processing flow, currently in flight", blockers: "Possible duplicate — is this part of REF# 3?" }),
  mk("Item order creation", "Needs discovery", "BG, Michael", "Write spec / define scope",
    "In addition to the CSV upload, build Orders/POs in admin similar to cards."),
  mk("CubiScan integration", "Needs discovery", "BG, Michael", "Write spec / define scope",
    "Integrate with CubiScan to capture weight and dimensions for each watch, stored at the item level."),
  mk("Watch bin assignment", "Needs discovery", "BG, Michael", "Write spec / define scope",
    "Determine bin size classification from dimensions (M, L, XL). Each category needs its own bins, with the ability to override the system suggestion."),
  mk("Camera barcode scanning vs gun scanner", "Needs discovery", "Michael", "Write spec / define scope",
    "Camera-based scanning is slower for high-volume flows. Add handheld gun scanner support across processing, vaulting, retrieval and shipping."),
  mk("Watch deletion & archiving controls", "Needs discovery", "Michael", "Write spec / define scope",
    "No way to properly remove invalid, duplicate or cancelled watch records. Archiving should preserve audit data; deletion should be permission-restricted with safeguards."),
  mk("Vaulting system enhancement", "Needs discovery", "Michael", "Write spec / define scope",
    "Configurable storage layouts for variable-sized inventory: customizable slot sizes, flexible slot counts, category-specific validation. Existing card vault configs stay unchanged."),
  mk("Imaging primary asset tagging", "Needs discovery", "Michael", "Write spec / define scope",
    "Automatically assign the Front image as primary, and the primary video when only one is uploaded, with manual override retained."),
  mk("Reference number auto-population", "Needs discovery", "Michael", "Write spec / define scope",
    "When a watch reference number already exists, populate previously captured shared data automatically. Support multiple variants per reference number."),
  mk("Overhandling of cards", "Needs discovery", "Luis", "Write spec / define scope",
    "Remove the step of storing scanned cards in processing bins before vaulting. Store directly in the vault and release into slab packs once graded and error-checked."),
  mk("Rebuild task manager", "Needs discovery", "Alan", "Write spec / define scope",
    "Rebuild the task manager so it works without breaking the system and without limitations."),
  mk("Shipping page — label delay", "Needs discovery", "Manny", "Write spec / define scope",
    "Shipping labels take up to two hours to generate. They show in Arta but do not appear on the admin page."),
  mk("Retrieval assignment", "Needs discovery", "Retrieval", "Write spec / define scope",
    "Assign and release work to users in retrieval. Today we hand out Google Sheets with 40 tasks each — manual and dependent on external tools.",
    { notes: "Added from walk on 07/13" }),
  mk("Data fields — watches", "Needs discovery", "Buying", "Reconfigure the sheet",
    "Fields Buying wants kept: brand, model, reference number, year, box, papers, dial colour, movement type, condition, bracelet material and colour, size, case material, bezel material, gender.",
    { notes: "Added from discussion with Buying" }),
  mk("Priority and user assignment on scanning", "Needs discovery", "Ops", "Write spec / define scope",
    "Add priority and user assignment to scanning to remove the Metabase dependency.",
    { notes: "From walk thru with ENG team" }),
  mk("Assign user to retrieval", "Needs discovery", "Ops", "Write spec / define scope",
    "Assign a user to retrieval to remove the Google Sheet.",
    { notes: "From walk thru with ENG team" }),
  mk("Carrier colour coding", "Needs discovery", "Ops", "Write spec / define scope",
    "Add colour coding or an identifier so the user can see which carrier it is. Currently tracked in an external Google Sheet.",
    { notes: "From walk thru with ENG team" }),
  mk("Re-scans onto occupied scan beds", "Needs discovery", "Eli", "Write spec / define scope",
    "To re-scan, users must ensure cards are not loaded onto another scan bed. No functionality to load on another scanner if someone forgets to clear theirs.",
    { teams: "Scanning" }),
  mk("Archive button in data entry", "Needs discovery", "Alan", "Write spec / define scope",
    "Add an archive button for Set, Insert, Card Type and Parallel in Data Entry for eligible people."),
  mk("Employee production calcs", "Needs discovery", "Alan", "Write spec / define scope",
    "Backstage to show average cards done by grader, not points, using Metabase logic."),
  mk("Bulk format change across inventory", "Needs discovery", "Alan", "Write spec / define scope",
    "Bulk data change to change formats across the same cards in inventory without hunting down every card done in the past."),
  mk("Card type enhancements using AI and Card Hedge", "Needs discovery", "Alan", "Write spec / define scope",
    "When we re-crop we have to complete all the other sub-grade tasks — double labor. Only goes to one person rather than across the team."),
  mk("Centering AI enhancement", "Needs discovery", "Alan", "Write spec / define scope",
    "Position lines based on previous work to make verify easier and more effective, plus calibration."),
  mk("Overall grade check for Arena slabs", "Needs discovery", "Alan", "Write spec / define scope",
    "Check whether subgrades correctly produced the right overall grade. Update the scoring system."),
  mk("New review page as grade report", "Needs discovery", "Alan", "Write spec / define scope",
    "A review page that acts like a grade report, where adjustments can be made without clicking into the task."),
  mk("Pick path optimization", "Needs discovery", "Alan", "Write spec / define scope",
    "Optimize the pick path for retrieval."),
  mk("RFID — inventory", "Needs discovery", "Alan, Jackie, Michael", "Write spec / define scope",
    "Facility does not use RFID currently. Use case: separate watches from boxes to bring back together.",
    { impact: "Will increase storage capacity in vault for watches minimum 5x" }),
  mk("Barcode integration", "Needs discovery", "Alan, Michael", "Write spec / define scope",
    "Barcode integration across all products — tracking, arrivals, storage."),
  mk("Comp overdue notifications", "Needs discovery", "Alan", "Write spec / define scope",
    "Notification system for cards that need comping because they are overdue and out of date."),
  mk("BDQ functions", "Needs discovery", "Alan", "Confirm direction",
    "Move all admin functions to BDQ.",
    { impact: "This should go the other way around" }),
];

/* Requests that are already on the roadmap do not belong in intake — they
   would double-count the work and pad the backburner. They are removed from
   the intake board entirely; what they add (who raised it, the business
   impact they argued) is folded into the roadmap item that covers them, so
   nothing that was written down is lost. */
const COVERED_BY = {
  // "intake request": "Target item::Exact phase"   (phase optional)
  "Cards to Items cutover":                        "Admin Split::Ph2 — Fix Phase 1 bugs",
  "Card type overall dropdown order":              "Card Type — Data Entry::Change 2 — Subgrade sort",
  "PO display across queues":                      "PO Number in Work Queues::Ph1 — Queue column",
  "PO lookup plus line thumbnail":                 "PO Number in Work Queues::Ph2 — Line thumbnail",
  "Make set ID input optional on card type edits": "Card Type — Data Entry::Change 3 — Set ID optional",
  "Additional pregraded dropdown options":         "Card Type — Data Entry::Change 1 — New grade values",
  "Sort on all admin pages":                       "Sort on Admin Tables::Ph1",
  "Card Not Found":                                "Card Not Found — Vaulting Scan::Ph1 — Status modal + logging",
  "Internal / external check-out flow":            "Check-in / Check-out::Ph1",
  "Auto-approve human sub-grade verify":           "Auto Approve::Ph1 — Edge",
  "Watch receiving & sorting":                     "Items processing flow — Phase 2",
  "Assign user to retrieval":                      "Retrieval assignment",
};

/* Order matters here:
   1. fold anything already covered elsewhere into its target, and drop it
   2. of what is left, anything shipped or in flight is work rather than
      intake — move it onto the roadmap
   3. the remainder is the intake board: up for discussion, blocked, parked */

const ALL_TARGETS = [...PRD, ...INTAKE];   // two targets are other intake rows

const NOT_COVERED = INTAKE.filter((i) => {
  const targetName = COVERED_BY[i.item];
  if (!targetName) return true;

  /* several roadmap items share a name across phases, so match the phase
     too when one is given — otherwise the note lands on the wrong row */
  const [wantItem, wantPhase] = targetName.split("::");
  const target = ALL_TARGETS.find(
    (r) => r.item === wantItem && (!wantPhase || r.phase === wantPhase)
  );
  if (target) {
    const who = i.owner ? ` by ${i.owner}` : "";
    const why = i.impact ? ` Impact given: ${i.impact}` : "";
    target.notes = `${target.notes ? target.notes + " " : ""}Also raised in intake${who} as "${i.item}".${why}`;
  }
  return false;                             // never reaches either board
});

const IN_FLIGHT = ["Shipped", "In progress", "Ready to build"];
NOT_COVERED.forEach((i) => {
  if (IN_FLIGHT.includes(i.status)) { i.board = "prd"; i.phase = i.phase || "—"; }
});

/* "History" is only ever seen in data saved by an earlier version — fold it
   back to Shipped so both names cannot coexist. */
const SEED = [...PRD, ...NOT_COVERED].map((i) =>
  i.status === "History" ? { ...i, status: "Shipped" } : i
);

/* open questions holding up work — each names what it blocks */
const DECISIONS = [
  {
    id: "d1", resolved: false, owner: "Alan / Ops team",
    question: "Are Pristine 10 / Black Label 10 / Gold 10 separate grade values, or a plain-10 with a designation?",
    blocks: "Card Type — Data Entry", blocksPhase: "Change 1 — New grade values",
  },
  {
    id: "d2", resolved: false, owner: "Alan / Ops team",
    question: "Can sort be pushed to the query on admin table pages, and which columns actually need it?",
    blocks: "Sort on Admin Tables", blocksPhase: "Ph1",
  },
  {
    id: "d3", resolved: false, owner: "Alan / Ops team",
    question: "Who else reads the external check-out status — reporting, finance, insurance?",
    blocks: "Check-in / Check-out", blocksPhase: "Ph1 (blocks starting at all)",
  },
  {
    id: "d4", resolved: false, owner: "Alan / Ops team",
    question: "Can one order carry more than one PO?",
    blocks: "PO Number in Work Queues", blocksPhase: "Ph1 — Task header (shipped, but never formally confirmed)",
  },
  {
    id: "d5", resolved: false, owner: "Alan / Ops team",
    question: "Does a holding / flagged bin count as vaulted for inventory and insurance?",
    blocks: "Card Not Found — Vaulting Scan", blocksPhase: "Ph3, and Check-out Ph3",
  },
];

/* sequencing notes — where two workstreams collide */
const RISKS = [
  {
    id: "k1", tone: "conflict",
    text: "Card Not Found Ph1's new status block and Check-in/Check-out Ph1 both touch the same modals — one adds to them, the other deletes them. Needs a sequencing call.",
  },
  {
    id: "k2", tone: "duplicate",
    text: "Card Not Found Ph3's holding bin and Check-in/Check-out Ph3's flagged bin may be the same idea proposed twice — decide once.",
  },
  {
    id: "k3", tone: "order",
    text: "Sort on Admin Tables should ship before PO's sort and flagged-bin ageing work, or both duplicate it later.",
  },
];

const RISK_TONE = {
  conflict: { bar: "#3D7EC4", bg: "#F4F8FD" },
  duplicate: { bar: "#C89327", bg: "#FDFAF2" },
  order: { bar: "#8B949D", bg: "#F7F8F9" },
};

const KEY = "arena-roadmap-v5";

/* ------------------------------- pieces ------------------------------- */

function Badge({ status }) {
  const s = STATUS[status] || STATUS["Needs discovery"];
  return (
    <span className="inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap"
          style={{ background: s.bg, color: s.fg }}>
      {status}
    </span>
  );
}

function Stat({ status, count, active, onClick, onDrop, isDropTarget }) {
  const s = STATUS[status];
  return (
    <button
      onClick={onClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="rounded-xl px-6 py-5 text-left transition-colors"
      style={{
        background: s.bg,
        outline: isDropTarget ? `2px dashed ${s.fg}` : active ? `2px solid ${s.fg}` : "2px solid transparent",
        outlineOffset: -2,
        minWidth: 150,
        flex: "1 1 150px",
      }}
    >
      <div className="text-4xl font-semibold tabular-nums leading-none" style={{ color: s.fg }}>
        {count}
      </div>
      <div className="text-base mt-2" style={{ color: s.fg, opacity: 0.85 }}>{status}</div>
    </button>
  );
}

const inputStyle = {
  width: "100%", border: `1px solid ${C.rule}`, borderRadius: 8,
  padding: "11px 13px", fontSize: 16, color: C.ink, background: "#fff", fontFamily: FONT,
};

/* -------------------------------- app -------------------------------- */

function Roadmap() {
  const [items, setItems] = useState(SEED);
  const [decisions, setDecisions] = useState(DECISIONS);
  const [risks, setRisks] = useState(RISKS);
  const [editDecision, setEditDecision] = useState(null);
  const [board, setBoard] = useState("prd");
  const [filter, setFilter] = useState("All items");
  const [sortKey, setSortKey] = useState(null);
  /* the page can sit open for days — re-render when the date rolls over so
     "in 4 days" and the days-left counters stay true without a refresh */
  const [dayStamp, setDayStamp] = useState(today());
  const [removedIds, setRemovedIds] = useState(new Set());
  const [events, setEvents] = useState([]);        // status + board change log
  const [histFilter, setHistFilter] = useState("All changes");
  const [saveState, setSaveState] = useState("idle");
  const [saveError, setSaveError] = useState("");
  const [imgCache, setImgCache] = useState({});   // id -> dataUrl
  const [imgBusy, setImgBusy] = useState(false);
  const [imgError, setImgError] = useState("");
  const [dropping, setDropping] = useState(false);
  const [lightbox, setLightbox] = useState(null);   // { id, name }
  const [armedDelete, setArmedDelete] = useState(null);
  const [prdCache, setPrdCache] = useState({});
  const [prdBusy, setPrdBusy] = useState(false);
  const [prdError, setPrdError] = useState("");
  const [prdDrop, setPrdDrop] = useState(false);
  const [impactDrop, setImpactDrop] = useState(false);
  const [armedPrd, setArmedPrd] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [sortDir, setSortDir] = useState("asc");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const first = useRef(true);

  /* space flips between the two boards — but not while you are typing in a
     field, and not on a focused button, where space means "press me" */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && lightbox) { setLightbox(null); setArmedDelete(null); return; }
      if (e.key !== " " && e.code !== "Space") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const tag = t && t.tagName ? t.tagName.toLowerCase() : "";
      if (["input", "textarea", "select", "button", "a"].includes(tag)) return;
      if (t && t.isContentEditable) return;
      e.preventDefault();                       // otherwise the page scrolls
      setBoard((b) => (b === "prd" ? "intake" : "prd"));
      setOpenId(null);
      setFilter("All items");
      setSortKey(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  useEffect(() => {
    const id = setInterval(() => {
      const t = today();
      setDayStamp((prev) => (prev === t ? prev : t));
    }, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      let r = null;
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
          const p = JSON.parse(raw);
          if (p && Array.isArray(p.items) && p.items.length) {
            /* saved rows win — they carry your edits. Seed rows that are
               new since you last loaded get appended, unless you deleted
               them, so adding an item upstream no longer wipes your work. */
            const savedIds = new Set(p.items.map((i) => i.id));
            const removed = new Set(Array.isArray(p.removed) ? p.removed : []);
            const fresh = SEED.filter((i) => !savedIds.has(i.id) && !removed.has(i.id));
            setItems([...p.items, ...fresh]);
            setRemovedIds(removed);
            if (fresh.length) setNewCount(fresh.length);
          }
          if (p && Array.isArray(p.decisions)) setDecisions(p.decisions);
          if (p && Array.isArray(p.risks)) setRisks(p.risks);
          if (p && Array.isArray(p.events)) setEvents(p.events);
        }
      } catch (e) { /* first run */ }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => {
      setSaveState("saving");
      store
        .set(KEY, JSON.stringify({
          items, decisions, risks, events, removed: Array.from(removedIds),
        }))
        .then(() => { setSaveState("saved"); setSaveError(""); })
        .catch((err) => { setSaveState("error"); setSaveError(String(err.message || err)); });
    }, 600);
    return () => clearTimeout(t);
  }, [items, decisions, risks, events, removedIds, loaded]);

  const isHistory = board === "history";
  const cfg = BOARDS[board] || BOARDS.prd;
  const mine = useMemo(
    () => items.filter((i) => i.board === board && !isArchived(i)),
    [items, board]
  );
  /* everything that has shipped, newest finish first */
  const archived = useMemo(
    () => items.filter(isArchived).sort((a, b) => (b.finished || "").localeCompare(a.finished || "")),
    [items]
  );

  const searched = mine.filter((i) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return [i.item, i.task, i.owner, i.developer, i.next, i.notes, i.blockers, i.phase, i.teams]
      .filter(Boolean).join(" ").toLowerCase().includes(q);
  });

  const visible = filter === "All items" ? searched : searched.filter((i) => i.status === filter);
  const countOf = (s) => searched.filter((i) => i.status === s).length;

  /* Every status and board change is logged. The log is the only record of
     when something shipped — the finished date is a day, this is the moment,
     and it survives someone later moving the row somewhere else. */
  const logEvent = (e) =>
    setEvents((prev) => [{ ...e, at: new Date().toISOString() }, ...prev].slice(0, 2000));

  const patch = (id, ch) => {
    const before = items.find((x) => x.id === id);
    if (before) {
      if (ch.status && ch.status !== before.status) {
        logEvent({
          itemId: id, item: before.item, phase: before.phase,
          board: ch.board || before.board,
          kind: "status", from: before.status, to: ch.status,
        });
      }
      if (ch.board && ch.board !== before.board) {
        logEvent({
          itemId: id, item: before.item, phase: before.phase,
          board: ch.board,
          kind: "board", from: BOARDS[before.board].label, to: BOARDS[ch.board].label,
        });
      }
    }
    setItems((p) => p.map((i) => {
    if (i.id !== id) return i;
    const next = { ...i, ...ch };
    /* moving to Shipped stamps the finish date, once. Moving back off
       Shipped leaves it — it did finish, whatever happened after. */
    if (ARCHIVED.includes(ch.status) && !next.finished) next.finished = today();
    return next;
    }));
  };

  /* sorting sits on top of the manual order — it never rewrites it, so
     clearing the sort returns every row to where you dragged it. */
  const valueFor = (i, col) => {
    const c = cfg.columns[col];
    if (!c) return "";
    if (c.key === "status") return String(cfg.statuses.indexOf(i.status)).padStart(2, "0");
    if (c.num) {
      const n = parseFloat(i[c.key]);
      return isNaN(n) ? Infinity : n;          // unestimated sorts last
    }
    if (c.due) return i.due || "9999-99-99";   // undated sorts last
    return String(i[c.key] || "").toLowerCase();
  };

  const rows = useMemo(() => {
    if (sortKey === null) return visible;
    const out = visible.slice().sort((a, b) => {
      const av = valueFor(a, sortKey), bv = valueFor(b, sortKey);
      if (av === bv) return 0;
      if (av === "" || av === Infinity) return 1;    // blanks always sink
      if (bv === "" || bv === Infinity) return -1;
      return (av < bv ? -1 : 1) * (sortDir === "asc" ? 1 : -1);
    });
    return out;
  }, [visible, sortKey, sortDir, board, dayStamp]);

  /* promote an intake request onto the roadmap, or push one back.
     A status the destination board does not have is remapped — and a
     promotion must never land on "Shipped", which is what taking the
     first status in the list would do. */
  const LANDING = {
    prd:    { "Up for discussion": "Ready to build", "Needs discovery": "Needs discovery",
              Shipped: "In progress",
              Blocked: "Blocked", "Deferred / other": "Deferred / other" },
    intake: { Shipped: "Up for discussion", History: "Up for discussion",
              "In progress": "Up for discussion",
              "Ready to build": "Up for discussion", Blocked: "Blocked",
              "Deferred / other": "Deferred / other", "Needs discovery": "Needs discovery" },
  };

  /* Attachments. Each image is written under its own key and the item keeps
     only the id, so saving the board stays cheap no matter how many are added. */
  const addImages = async (itemId, fileList, field = "images") => {
    const incoming = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!incoming.length) return;

    setImgBusy(true);
    setImgError("");
    const added = [];
    for (const f of incoming) {
      try {
        const { dataUrl, w, h } = await compressImage(f);
        const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await files.put(id, { dataUrl, name: f.name, w, h });
        setImgCache((c) => ({ ...c, [id]: dataUrl }));
        added.push({ id, name: f.name });
      } catch (err) {
        setImgError(String(err.message || err));
      }
    }
    if (added.length) {
      const current = items.find((i) => i.id === itemId);
      patch(itemId, { [field]: [...((current && current[field]) || []), ...added] });
    }
    setImgBusy(false);
  };

  /* One PRD per item. Attaching a second replaces the first and deletes the
     old file, rather than leaving an orphan taking up space. */
  const setPrdFile = async (itemId, fileList) => {
    const file = Array.from(fileList || [])[0];
    if (!file) return;
    setPrdError("");

    if (file.type && file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      setPrdError(`${file.name} is not a PDF`);
      return;
    }
    if (file.size > PDF_LIMIT) {
      setPrdError(`${file.name} is ${prettySize(file.size)} — the limit is ${prettySize(PDF_LIMIT)}`);
      return;
    }

    setPrdBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const id = `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await files.put(id, { dataUrl, name: file.name });

      const current = items.find((i) => i.id === itemId);
      const previous = current && current.prdFile;
      patch(itemId, { prdFile: { id, name: file.name, size: file.size } });
      setPrdCache((c) => ({ ...c, [id]: dataUrl }));
      if (previous && previous.id) await files.del(previous.id);
    } catch (err) {
      setPrdError(String(err.message || err));
    }
    setPrdBusy(false);
  };

  const openPrd = async (rec) => {
    if (!rec) return;
    let dataUrl = prdCache[rec.id];
    if (!dataUrl) {
      const stored = await files.get(rec.id);
      dataUrl = stored && stored.dataUrl;
      if (dataUrl) setPrdCache((c) => ({ ...c, [rec.id]: dataUrl }));
    }
    if (dataUrl) openInNewTab(dataUrl, rec.name);
    else setPrdError("That file is missing from storage.");
  };

  const removePrd = async (itemId, rec) => {
    patch(itemId, { prdFile: null });
    if (rec && rec.id) await files.del(rec.id);
  };

  const removeImage = async (itemId, imgId, field = "images") => {
    const current = items.find((i) => i.id === itemId);
    patch(itemId, {
      [field]: ((current && current[field]) || []).filter((x) => x.id !== imgId),
    });
    await files.del(imgId);
  };

  const moveBoard = (id, to) => {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    const toStatuses = BOARDS[to].statuses;
    const landed = LANDING[to][it.status] || it.status;
    patch(id, {
      board: to,
      status: toStatuses.includes(landed) ? landed : toStatuses[toStatuses.length - 1],
      phase: it.phase && it.phase !== "—" ? it.phase : (to === "prd" ? "Ph1" : "—"),
    });
    setBoard(to);
    setFilter("All items");
    setSortKey(null);
    setOpenId(id);
  };

  /* status sections, in pipeline order. The last two are cold — they get
     pushed below a hard break rather than mixed into the live work. */
  /* Needs discovery is real work waiting on a spec, so it stays above the
     line. Only work parked on purpose goes below it. */
  const BACKBURNER = ["Deferred / other"];
  const groups = useMemo(
    () => cfg.statuses.map((st) => ({
      status: st,
      backburner: BACKBURNER.includes(st),
      rows: visible.filter((i) => i.status === st),
    })),
    [visible, cfg.statuses]
  );

  /* one row, shared by the grouped and the sorted-flat views */
  const renderRow = (i, idx, list) => {
    const dragging = dragId === i.id;
    const over = overId === i.id && dragId && dragId !== i.id;
    const canDrag = sortKey === null;
    return (
      <div key={i.id}
        draggable={canDrag}
        onDragStart={() => canDrag && setDragId(i.id)}
        onDragOver={(e) => { if (canDrag) { e.preventDefault(); setOverId(i.id); } }}
        onDragLeave={() => setOverId(null)}
        onDrop={(e) => {
          if (!canDrag) return;
          e.preventDefault();
          /* dropping into another section moves the item there too */
          const dragged = items.find((x) => x.id === dragId);
          if (dragged && dragged.status !== i.status) patch(dragId, { status: i.status });
          reorder(i.id);
          setOverId(null); setDragId(null);
        }}
        onClick={() => setOpenId(i.id)}
        className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-3 py-4 cursor-pointer"
        style={{
          borderBottom: `1px solid ${C.ruleSoft}`,
          borderTop: over ? `2px solid ${C.accent}` : "2px solid transparent",
          background: dragging ? "#FAFBFC" : "transparent",
          opacity: dragging ? 0.5 : 1,
        }}>
        {/* position within this section — renumbers itself as rows move.
            The tick says a PRD is attached, without opening the row. */}
        <span className="flex items-baseline gap-1.5"
              style={{ width: 62, flexShrink: 0, cursor: canDrag ? "grab" : "default" }}
              title={canDrag ? "Drag to reorder, or drop on another section to move it" : "Clear the sort to drag rows"}>
          <span className="text-base tabular-nums" style={{ color: C.faint }}>
            {idx + 1}
          </span>
          {i.prdFile ? (
            /* attached — the tick reports a fact, so it is not a toggle */
            <span className="text-base" style={{ color: C.accent }}
                  title={`PRD attached: ${i.prdFile.name}`}>✓</span>
          ) : (
            /* no file, but the PRD may exist elsewhere — click to say so */
            <button
              onClick={(e) => { e.stopPropagation(); patch(i.id, { prdFlag: !i.prdFlag }); }}
              title={i.prdFlag
                ? "Marked as having a PRD — click to clear"
                : "Click to mark that a PRD exists"}
              className="text-base"
              style={{
                border: "none", background: "none", padding: 0, lineHeight: 1,
                cursor: "pointer",
                color: i.prdFlag ? C.accent : C.rule,
              }}>
              ✓
            </button>
          )}
          <span style={{ color: C.rule, fontSize: 13 }}>{canDrag ? "⠿" : ""}</span>
        </span>

        {cfg.columns.map((c) => {
          if (c.badge) {
            /* the only six values allowed — picking one moves the row to
               that section, since the sections are built from status */
            const st = STATUS[i.status] || STATUS["Needs discovery"];
            return (
              <span key={c.key}
                    style={{ ...colStyle(c), position: "relative", display: "inline-block" }}
                    onClick={(e) => e.stopPropagation()}>
                <select
                  value={i.status}
                  onChange={(e) => patch(i.id, { status: e.target.value })}
                  title="Change the status — the row moves to that section"
                  style={{
                    appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
                    background: st.bg, color: st.fg,
                    border: `1px solid ${st.bg}`, borderRadius: 999,
                    padding: "7px 30px 7px 14px",
                    fontSize: 14, fontWeight: 600, fontFamily: FONT,
                    cursor: "pointer", width: "100%", maxWidth: 160,
                    outlineColor: st.dot,
                  }}>
                  {cfg.statuses.map((sv) => (
                    <option key={sv} value={sv} style={{ background: "#fff", color: C.ink }}>
                      {sv}
                    </option>
                  ))}
                </select>
                <span style={{
                  position: "absolute", right: 18, top: "50%", transform: "translateY(-50%)",
                  pointerEvents: "none", color: st.fg, fontSize: 11,
                }}>▾</span>
              </span>
            );
          }
          if (c.due) {
            const info = dueInfo(i.due);
            const done = dueInfo(i.finished);
            return (
              <span key={c.key} style={{ ...colStyle(c), lineHeight: 1.35 }}>
                {done ? (
                  <span className="text-base" style={{ color: STATUS.Shipped.fg }}>
                    {done.label}
                  </span>
                ) : info ? (
                  <>
                    <span className="text-base" style={{ color: C.ink }}>{info.label}</span>
                    <br />
                    <span className="text-sm rounded px-1.5 py-0.5"
                          style={{
                            color: DUE_TONE[info.tone].fg,
                            background: DUE_TONE[info.tone].bg,
                            fontWeight: info.tone === "calm" ? 400 : 600,
                          }}>
                      {info.rel}
                    </span>
                  </>
                ) : (
                  <span className="text-base" style={{ color: C.faint }}>No date</span>
                )}
              </span>
            );
          }
          if (c.num) {
            const est = i[c.key];
            const info = !i.finished ? dueInfo(i.due) : null;
            return (
              <span key={c.key}
                style={{ ...colStyle(c), textAlign: "right", paddingRight: 18, lineHeight: 1.35 }}>
                <span className="text-base tabular-nums"
                      style={{ color: est ? C.ink : C.faint }}>
                  {est || "—"}
                </span>
                {info && (
                  <>
                    <br />
                    <span className="text-sm tabular-nums"
                          style={{ color: DUE_TONE[info.tone].fg,
                                   fontWeight: info.tone === "calm" ? 400 : 600 }}>
                      {info.days < 0
                        ? `${-info.days} over`
                        : `${info.days} left`}
                    </span>
                  </>
                )}
              </span>
            );
          }
          const raw = i[c.key];
          const val = (raw === undefined || raw === null || raw === "") ? "—" : String(raw);
          const first = c.key === "item";
          return (
            <span key={c.key}
              className={first ? "text-base font-medium" : "text-base"}
              style={{
                ...colStyle(c),
                ...clampStyle(c.clamp),
                color: val === "—" ? C.faint : C.ink,
                textAlign: c.num ? "right" : "left",
                paddingRight: c.num ? 18 : 0,
              }}>
              {val}
            </span>
          );
        })}

        <span className="flex gap-1 shrink-0 items-center" style={{ width: 108 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              moveBoard(i.id, board === "intake" ? "prd" : "intake");
            }}
            title={board === "intake"
              ? "Move this request onto the roadmap"
              : "Send this back to intake for discussion"}
            className="text-sm rounded px-2"
            style={{
              height: 28,
              border: `1px solid ${board === "intake" ? C.accent : C.rule}`,
              background: board === "intake" ? "#F4F8FD" : "#fff",
              color: board === "intake" ? C.accent : C.mute,
              fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer",
            }}>
            {board === "intake" ? "→ Roadmap" : "← Intake"}
          </button>
          <button
            disabled={!canDrag || idx === 0}
            onClick={(e) => { e.stopPropagation(); moveBy(i.id, -1, list); }}
            title="Move up" className="text-sm rounded"
            style={{
              width: 28, height: 28, border: `1px solid ${C.rule}`, background: "#fff",
              color: C.mute, opacity: !canDrag || idx === 0 ? 0.3 : 1,
              cursor: !canDrag || idx === 0 ? "default" : "pointer",
            }}>↑</button>
          <button
            disabled={!canDrag || idx === list.length - 1}
            onClick={(e) => { e.stopPropagation(); moveBy(i.id, 1, list); }}
            title="Move down" className="text-sm rounded"
            style={{
              width: 28, height: 28, border: `1px solid ${C.rule}`, background: "#fff",
              color: C.mute, opacity: !canDrag || idx === list.length - 1 ? 0.3 : 1,
              cursor: !canDrag || idx === list.length - 1 ? "default" : "pointer",
            }}>↓</button>
        </span>
      </div>
    );
  };

  const toggleSort = (col) => {
    if (sortKey !== col) { setSortKey(col); setSortDir("asc"); return; }
    if (sortDir === "asc") { setSortDir("desc"); return; }
    setSortKey(null);           // third click returns to your manual order
  };

  /* move a row one place, using what's on screen rather than the raw
     array, so a hidden row never swallows the move */
  const moveBy = (id, dir, list) => {
    const scope = list || rows;
    const pos = scope.findIndex((r) => r.id === id);
    const neighbour = scope[pos + dir];
    if (!neighbour) return;
    setItems((p) => {
      const a = p.findIndex((x) => x.id === id);
      const b = p.findIndex((x) => x.id === neighbour.id);
      if (a < 0 || b < 0) return p;
      const n = p.slice();
      const [moved] = n.splice(a, 1);
      n.splice(b, 0, moved);
      return n;
    });
  };

  const reorder = (targetId) => {
    if (!dragId || dragId === targetId) return;
    setItems((p) => {
      const from = p.findIndex((i) => i.id === dragId);
      const to = p.findIndex((i) => i.id === targetId);
      if (from < 0 || to < 0) return p;
      const n = p.slice();
      const [m] = n.splice(from, 1);
      n.splice(to, 0, m);
      return n;
    });
  };

  const addItem = () => {
    const fresh = {
      id: `new-${Date.now()}`, board, item: "New item", phase: "—", status: "Needs discovery",
      owner: "", developer: "", next: "Write spec / define scope", task: "", notes: "",
      prdFile: null, prdFlag: false, adminUrl: "", images: [], impactImages: [],
      blockers: "", estimate: "", teams: "", impact: "", type: "",
    };
    setItems((p) => [fresh, ...p]);
    setFilter("All items");
    setOpenId(fresh.id);
  };

  const copyRows = async () => {
    const head = cfg.columns.map((c) => c.label);
    const body = rows.map((i) => cfg.columns.map((c) => i[c.key]));
    const tsv = [head, ...body]
      .map((r) => r.map((c) => String(c === undefined || c === null ? "" : c)
        .replace(/[\t\n]/g, " ")).join("\t"))
      .join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      alert(`${rows.length} rows copied with all ${head.length} columns. Paste into the sheet.`);
    } catch (e) {
      alert("Clipboard is blocked in this frame. Open the prototype in its own tab.");
    }
  };

  const shipped = countOf("Shipped");
  const inprog = countOf("In progress");
  const ready = countOf("Ready to build");
  const blocked = countOf("Blocked");
  const deferred = countOf("Deferred / other");
  const discovery = countOf("Needs discovery");

  const open = items.find((i) => i.id === openId) || null;

  /* fetch only what the open row needs, once */
  useEffect(() => { setArmedPrd(false); setArmedDelete(null); setPrdError(""); }, [openId]);
  useEffect(() => { setImgError(""); }, [lightbox]);

  useEffect(() => {
    if (!open) return;
    const all = [...(open.images || []), ...(open.impactImages || [])];
    if (!all.length) return;
    let cancelled = false;
    (async () => {
      for (const img of all) {
        if (imgCache[img.id]) continue;
        try {
          const rec = await files.get(img.id);
          if (!cancelled && rec && rec.dataUrl) {
            setImgCache((c) => ({ ...c, [img.id]: rec.dataUrl }));
          }
        } catch (e) { /* missing attachment — the tile shows a placeholder */ }
      }
    })();
    return () => { cancelled = true; };
  }, [openId,
      open && open.images && open.images.length,
      open && open.impactImages && open.impactImages.length]);

  /* history, newest first, grouped under a day heading */
  const histEvents = useMemo(() => {
    const list = histFilter === "Shipped only"
      ? events.filter((e) => ARCHIVED.includes(e.to))
      : histFilter === "Moved boards"
        ? events.filter((e) => e.kind === "board")
        : events;
    const groups = [];
    list.forEach((e) => {
      const d = new Date(e.at);
      const key = d.toDateString();
      let g = groups.find((x) => x.key === key);
      if (!g) {
        const days = Math.round((startOfToday() - new Date(d).setHours(0, 0, 0, 0)) / DAY);
        groups.push((g = {
          key,
          label: days === 0 ? "Today"
            : days === 1 ? "Yesterday"
            : d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }),
          rows: [],
        }));
      }
      g.rows.push(e);
    });
    return groups;
  }, [events, histFilter, dayStamp]);

  const shippedSince = (days) => events.filter(
    (e) => ARCHIVED.includes(e.to) && (Date.now() - new Date(e.at)) < days * DAY
  ).length;

  const dated = searched.filter((i) => i.due && !i.finished).map((i) => dueInfo(i.due));
  const overdue = dated.filter((d) => d && d.days < 0).length;
  const dueSoon = dated.filter((d) => d && d.days >= 0 && d.days <= 7).length;
  const openQs = decisions.filter((d) => !d.resolved);
  const owners = Array.from(new Set(openQs.map((d) => d.owner).filter(Boolean)));

  return (
    <div style={{ background: C.shell, fontFamily: FONT, color: C.ink, minHeight: "100vh" }}>
      <div style={{ background: C.page, maxWidth: "100%", margin: "0 auto", minHeight: "100vh" }}
           className="px-6 sm:px-10 py-10"
           onDragEnd={() => { setDragId(null); setOverId(null); setDropTarget(null); }}>

        {/* masthead */}
        <div className="flex items-baseline gap-3 mb-1">
          <span className="text-sm" style={{ color: C.faint }}>Arena Club · Admin Product</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm" style={{
              color: saveState === "error" ? DUE_TONE.late.fg : C.faint,
              fontWeight: saveState === "error" ? 600 : 400,
            }}>
              {saveState === "saving" ? "Saving\u2026"
                : saveState === "error"
                  ? <a href="/api/health" target="_blank" rel="noreferrer" title={saveError}
                       style={{ color: "inherit", textDecoration: "underline" }}>
                      Not saved: {saveError || "unknown error"}
                    </a>
                : saveState === "saved" ? "Saved" : "\u00A0"}
            </span>
            <span className="text-sm" style={{ color: C.faint }}>
              press <kbd style={{
                border: `1px solid ${C.rule}`, borderRadius: 4, padding: "1px 6px",
                fontFamily: FONT, fontSize: 13, color: C.mute,
              }}>space</kbd> to switch
            </span>
            {[...Object.entries(BOARDS), ["history", { label: "History" }]].map(([k, b]) => (
              <button key={k}
                onClick={() => { setBoard(k); setFilter("All items"); setOpenId(null); }}
                className="text-sm px-3.5 py-1.5 rounded-full"
                style={{
                  background: board === k ? C.ink : "transparent",
                  color: board === k ? "#fff" : C.mute,
                  border: `1px solid ${board === k ? C.ink : C.rule}`,
                }}>
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <h1 className="text-4xl font-bold tracking-tight mb-2" style={{ color: "#16305C" }}>
          {cfg.title}
        </h1>
        <p className="text-base mb-8" style={{ color: C.mute }}>{cfg.byline}</p>

        <div style={{ height: 1, background: C.rule }} className="mb-7" />

        {isHistory ? (
          <>
            <h2 className="text-2xl font-semibold mb-3" style={{ color: "#16305C" }}>History</h2>
            <p className="text-lg mb-7" style={{ color: C.body, maxWidth: "78ch", lineHeight: 1.65 }}>
              {archived.length} item{archived.length === 1 ? " has" : "s have"} shipped.
              {" "}
              {events.length === 0
                ? "Nothing is logged yet — every status change from here on is recorded with the date and time it happened."
                : <>
                    {shippedSince(7)} shipped in the last 7 days, {shippedSince(30)} in the last 30.
                    {" "}{events.length} change{events.length === 1 ? "" : "s"} recorded in total.
                  </>}
            </p>

            {/* the shipped list — what this tab is really for */}
            {archived.length > 0 && (
              <div className="mb-10">
                <div className="flex items-baseline gap-3 pb-2"
                     style={{ borderBottom: `1px solid ${C.rule}` }}>
                  <h3 className="text-xl font-semibold" style={{ color: STATUS.Shipped.fg }}>
                    Shipped
                  </h3>
                  <span className="text-base tabular-nums" style={{ color: C.faint }}>
                    {archived.length}
                  </span>
                </div>

                {archived.map((i, n) => (
                  <div key={i.id} onClick={() => setOpenId(i.id)}
                    className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-3 py-3.5 cursor-pointer"
                    style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                    <span className="flex items-baseline gap-1.5 shrink-0" style={{ width: 62 }}>
                      <span className="text-base tabular-nums" style={{ color: C.faint }}>
                        {n + 1}
                      </span>
                      {(i.prdFile || i.prdFlag) && (
                        <span className="text-base" style={{ color: C.accent }}
                              title={i.prdFile ? `PRD attached: ${i.prdFile.name}` : "PRD exists"}>
                          ✓
                        </span>
                      )}
                    </span>
                    <span className="text-lg font-medium" style={{ flex: "2 1 0", color: C.ink }}>
                      {i.item}
                    </span>
                    <span className="text-base" style={{ flex: "1.2 1 0", color: C.body }}>
                      {i.phase && i.phase !== "—" ? i.phase : "—"}
                    </span>
                    <span style={{ width: 130 }}><Badge status="Shipped" /></span>
                    <span className="text-base" style={{ flex: "1 1 0", color: i.owner ? C.ink : C.faint }}>
                      {i.owner || "—"}
                    </span>
                    <span className="text-base" style={{ flex: "1 1 0", color: i.developer ? C.ink : C.faint }}>
                      {i.developer || "—"}
                    </span>
                    <span className="text-base shrink-0" style={{ width: 175, color: C.ink }}>
                      {i.finished
                        ? dueInfo(i.finished).label
                        : <span style={{ color: C.faint }}>No date</span>}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); patch(i.id, { status: "In progress" }); }}
                      title="Put this back on the roadmap"
                      className="text-sm rounded px-2 shrink-0"
                      style={{
                        height: 28, border: `1px solid ${C.rule}`, background: "#fff",
                        color: C.mute, whiteSpace: "nowrap", cursor: "pointer",
                      }}>
                      Reopen
                    </button>
                  </div>
                ))}
              </div>
            )}

            <h3 className="text-xl font-semibold mb-3" style={{ color: C.ink }}>Change log</h3>

            <div className="flex flex-wrap gap-1.5 mb-6">
              {["All changes", "Shipped only", "Moved boards"].map((f) => {
                const on = histFilter === f;
                return (
                  <button key={f} onClick={() => setHistFilter(f)}
                    className="text-base px-4 py-2 rounded-full"
                    style={{
                      background: on ? "#16305C" : "#fff",
                      color: on ? "#fff" : C.body,
                      border: `1px solid ${on ? "#16305C" : C.rule}`,
                      fontWeight: on ? 600 : 400,
                    }}>
                    {f}
                  </button>
                );
              })}
            </div>

            {histEvents.length === 0 ? (
              <p className="text-base py-10" style={{ color: C.faint }}>
                Nothing matches that filter yet.
              </p>
            ) : histEvents.map((g) => (
              <div key={g.key} className="mb-7">
                <div className="flex items-baseline gap-3 pb-2"
                     style={{ borderBottom: `1px solid ${C.rule}` }}>
                  <h3 className="text-xl font-semibold" style={{ color: C.ink }}>{g.label}</h3>
                  <span className="text-base tabular-nums" style={{ color: C.faint }}>
                    {g.rows.length}
                  </span>
                </div>

                {g.rows.map((e, n) => {
                  const item = items.find((x) => x.id === e.itemId);
                  const time = new Date(e.at).toLocaleTimeString(undefined,
                    { hour: "numeric", minute: "2-digit" });
                  return (
                    <div key={e.at + n}
                      onClick={() => {
                        if (!item) return;
                        setBoard(item.board); setFilter("All items"); setOpenId(item.id);
                      }}
                      className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-3 py-3.5"
                      style={{
                        borderBottom: `1px solid ${C.ruleSoft}`,
                        cursor: item ? "pointer" : "default",
                      }}>
                      <span className="text-base tabular-nums shrink-0"
                            style={{ width: 84, color: C.faint }}>{time}</span>

                      <span className="text-base" style={{ flex: "2 1 0", color: C.ink }}>
                        {e.item}
                        {e.phase && e.phase !== "—" && (
                          <span style={{ color: C.faint }}> · {e.phase}</span>
                        )}
                        {!item && (
                          <span style={{ color: C.faint }}> · deleted since</span>
                        )}
                      </span>

                      <span className="flex items-center gap-2 shrink-0" style={{ flex: "1.6 1 0" }}>
                        {e.kind === "status" ? (
                          <>
                            <Badge status={e.from} />
                            <span style={{ color: C.faint }}>→</span>
                            <Badge status={e.to} />
                          </>
                        ) : (
                          <span className="text-base" style={{ color: C.body }}>
                            {e.from} <span style={{ color: C.faint }}>→</span> {e.to}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}

            <p className="text-base mt-8" style={{ color: C.faint }}>
              Click any entry to open the item. Entries stay even if the item is later deleted —
              that is the point of a log.
            </p>
          </>
        ) : (
          <>

        {newCount > 0 && (
          <div className="flex items-center gap-3 mb-6 px-4 py-3 rounded-lg"
               style={{ background: "#F4F8FD", border: `1px solid ${C.rule}` }}>
            <span className="text-base" style={{ color: C.ink }}>
              {newCount} new {newCount === 1 ? "item has" : "items have"} been added since you
              last opened this. Your own changes are untouched.
            </span>
            <button onClick={() => setNewCount(0)} className="ml-auto text-sm"
                    style={{ color: C.accent }}>Dismiss</button>
          </div>
        )}

        {/* summary */}
        <h2 className="text-2xl font-semibold mb-3" style={{ color: "#16305C" }}>Summary</h2>
        <p className="text-lg mb-7" style={{ color: C.body, maxWidth: "78ch", lineHeight: 1.65 }}>
          {board === "prd" ? (
            <>
              {searched.length} items are in flight, with {archived.filter((i) => i.board === "prd").length} shipped
              and moved to History. {inprog} in active build, {ready} scoped and ready to schedule,
              {" "}{blocked} blocked on an open question, {deferred} deliberately deferred,
              and {discovery} need a written spec before they can be sized.
            </>
          ) : (
            <>
              {searched.length} requests are on file, none of them started — anything picked up
              moves to the roadmap. {countOf("Up for discussion")} {countOf("Up for discussion") === 1 ? "is" : "are"} up
              for discussion, {blocked} blocked on an open question, {discovery} needing a written
              spec before they can be sized, and {deferred} parked on the backburner.
            </>
          )}
          {overdue > 0 && (
            <span style={{ color: DUE_TONE.late.fg, fontWeight: 600 }}>
              {" "}{overdue} {overdue === 1 ? "is" : "are"} past due.
            </span>
          )}
          {overdue === 0 && dueSoon > 0 && (
            <span style={{ color: DUE_TONE.soon.fg, fontWeight: 600 }}>
              {" "}{dueSoon} due within the week.
            </span>
          )}
        </p>

        <div className="flex flex-wrap gap-2.5 mb-9">
          {cfg.statuses.filter((st) => !ARCHIVED.includes(st)).map((s) => (
            <Stat key={s} status={s} count={countOf(s)}
                  active={filter === s}
                  isDropTarget={dropTarget === s && !!dragId}
                  onClick={() => setFilter(filter === s ? "All items" : s)}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragId) patch(dragId, { status: s });
                    setDragId(null); setDropTarget(null);
                  }} />
          ))}

          {/* shipped work lives in History — the card is the way in */}
          <Stat status="Shipped"
                count={archived.filter((i) => board === "history" || i.board === board).length}
                active={false}
                isDropTarget={dropTarget === "Shipped" && !!dragId}
                onClick={() => { setBoard("history"); setOpenId(null); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) patch(dragId, { status: "Shipped" });
                  setDragId(null); setDropTarget(null);
                }} />
        </div>

        {/* at a glance */}
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h2 className="text-2xl font-semibold" style={{ color: "#16305C" }}>At a glance</h2>
          <div className="ml-auto flex items-center gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder="Search"
                   style={{ ...inputStyle, width: 250, padding: "9px 13px", fontSize: 16 }} />
            <button onClick={copyRows} className="text-sm px-3.5 py-2 rounded"
                    style={{ border: `1px solid ${C.rule}`, color: C.body }}>Copy rows</button>
            <button onClick={addItem} className="text-sm px-3.5 py-2 rounded font-medium"
                    style={{ background: C.ink, color: "#fff" }}>Add item</button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3 mb-4">
          {["All items", ...cfg.statuses.filter((st) => !ARCHIVED.includes(st))].map((s) => {
            const on = filter === s;
            const drop = dropTarget === s && dragId && s !== "All items";
            return (
              <button key={s}
                onClick={() => setFilter(s)}
                onDragOver={(e) => { if (s !== "All items") { e.preventDefault(); setDropTarget(s); } }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && s !== "All items") patch(dragId, { status: s });
                  setDragId(null); setDropTarget(null);
                }}
                className="text-base px-4 py-2 rounded-full"
                style={{
                  background: on ? "#16305C" : "#fff",
                  color: on ? "#fff" : C.body,
                  border: `1px solid ${drop ? C.ink : on ? "#16305C" : C.rule}`,
                  outline: drop ? `2px dashed ${C.ink}` : "none",
                  fontWeight: on ? 600 : 400,
                }}>
                {s}
              </button>
            );
          })}
        </div>

        {/* table — scrolls sideways so nothing gets crushed */}
        <div className="overflow-x-auto" style={{ borderTop: `1px solid ${C.rule}` }}>
         <div style={{ minWidth: board === "prd" ? 1900 : 1740 }}>
          <div className="hidden sm:flex gap-4 px-3 py-3.5 text-sm"
               style={{ color: C.mute, borderBottom: `1px solid ${C.rule}` }}>
            <span style={{ width: 26, flexShrink: 0 }} />
            {cfg.columns.map((c, ci) => (
              <button key={c.key} onClick={() => toggleSort(ci)}
                className="text-sm text-left flex items-start gap-1.5"
                style={{
                  ...colStyle(c), background: "none", border: "none", padding: 0,
                  cursor: "pointer", fontFamily: FONT,
                  color: sortKey === ci ? C.ink : C.mute,
                  fontWeight: sortKey === ci ? 600 : 400,
                }}
                title={sortKey === ci
                  ? (sortDir === "asc" ? "Sort descending" : "Back to your manual order")
                  : `Sort by ${c.label}`}>
                {c.label}
                <span style={{ opacity: sortKey === ci ? 1 : 0.25 }}>
                  {sortKey === ci ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                </span>
              </button>
            ))}
            <span style={{ width: 108, flexShrink: 0 }} />
          </div>

          {sortKey !== null && (
            <div className="flex items-center gap-2 px-3 py-3 text-sm"
                 style={{ background: "#F4F8FD", color: C.body, borderBottom: `1px solid ${C.rule}` }}>
              <span>
                Sorted by {cfg.columns[sortKey].label} — dragging is off while a sort is on.
              </span>
              <button onClick={() => setSortKey(null)}
                      className="underline" style={{ color: C.accent }}>
                Back to my order
              </button>
            </div>
          )}

          {visible.length === 0 ? (
            <div className="py-14 text-center">
              <p className="text-lg mb-3" style={{ color: C.mute }}>
                No items match. Clear the filter or start a new one.
              </p>
              <button onClick={addItem} className="text-base px-4 py-2 rounded font-medium"
                      style={{ background: C.ink, color: "#fff" }}>Add item</button>
            </div>
          ) : sortKey !== null ? (
            /* a sort flattens the groups — you asked for one order, not six */
            rows.map((i, idx) => renderRow(i, idx, rows))
          ) : (
            groups.map((g, gi) => {
              if (!g.rows.length) return null;
              const s = STATUS[g.status];
              const firstBackburner =
                g.backburner && !groups.slice(0, gi).some((x) => x.backburner && x.rows.length);
              return (
                <React.Fragment key={g.status}>
                  {firstBackburner && (
                    <div className="mt-12 mb-2 pt-7 px-4 pb-5 rounded-lg"
                         style={{
                           borderTop: `3px solid ${STATUS["Deferred / other"].dot}`,
                           background: "#FBF8FC",
                         }}>
                      <h3 className="text-2xl font-semibold"
                          style={{ color: STATUS["Deferred / other"].fg }}>Backburner</h3>
                      <p className="text-base mt-1.5"
                         style={{ color: STATUS["Deferred / other"].fg, opacity: 0.75, maxWidth: "72ch" }}>
                        Parked on purpose — skipped, sequenced behind something else, or waiting
                        on a decision that has not been made. Nothing below this line is scheduled.
                      </p>
                    </div>
                  )}
                  <div className="flex items-center gap-3 px-3 pt-7 pb-2.5"
                       style={{ borderTop: gi === 0 || firstBackburner ? "none" : `1px solid ${C.rule}` }}>
                    <span style={{ width: 10, height: 10, borderRadius: 10, background: s.dot }} />
                    <h3 className="text-xl font-semibold" style={{ color: s.fg }}>{g.status}</h3>
                    <span className="text-base tabular-nums" style={{ color: C.faint }}>
                      {g.rows.length}
                    </span>
                  </div>
                  {g.rows.map((i, idx) => renderRow(i, idx, g.rows))}
                </React.Fragment>
              );
            })
          )}
         </div>
        </div>

        <p className="text-base mt-8" style={{ color: C.faint }}>
          Open a row to move it between boards — an intake request that gets picked up becomes a
          roadmap item, keeping its dates, notes and owner. Change a status from its dropdown and
          the row moves to that section. Click a column
          heading to sort — again to reverse, a third time to go back to your own order.
          Drag a row, or use the arrows, to move it within a section.
        </p>

        {board === "prd" && (
          <>
            {/* ---------------- open decisions ---------------- */}
            <div style={{ height: 1, background: C.rule }} className="mt-10 mb-7" />

            <div className="flex items-baseline gap-3 mb-2">
              <h2 className="text-2xl font-semibold" style={{ color: "#16305C" }}>
                Blocked — decisions needed
              </h2>
              <button
                onClick={() => setDecisions((p) => [
                  { id: `d${Date.now()}`, resolved: false, owner: "Alan / Ops team",
                    question: "New open question", blocks: "", blocksPhase: "" },
                  ...p,
                ])}
                className="ml-auto text-sm px-3.5 py-2 rounded"
                style={{ border: `1px solid ${C.rule}`, color: C.body }}>
                Add question
              </button>
            </div>

            <p className="text-lg mb-5" style={{ color: C.body, maxWidth: "78ch", lineHeight: 1.65 }}>
              {openQs.length === 0
                ? "Every open question has been answered. Nothing is waiting on a decision."
                : `${openQs.length} open question${openQs.length === 1 ? " is" : "s are"} holding up work. Each is small enough to resolve in one sitting${owners.length === 1 ? ` — all ${openQs.length === 1 ? "of it sits" : "sit"} with ${owners[0]}` : ""}.`}
            </p>

            <div>
              {[...decisions].sort((a, b) => (a.resolved === b.resolved ? 0 : a.resolved ? 1 : -1))
                .map((d) => {
                  const target = items.find(
                    (i) => i.board === "prd" && i.item === d.blocks &&
                      (!d.blocksPhase || d.blocksPhase.startsWith(i.phase.split(" ")[0]))
                  );
                  const editing = editDecision === d.id;
                  return (
                    <div key={d.id}
                      className="mb-2 rounded-lg px-4 py-3.5"
                      style={{
                        border: `1px solid ${C.rule}`,
                        background: d.resolved ? "#FAFBFC" : "#fff",
                        opacity: d.resolved ? 0.62 : 1,
                      }}>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-1 min-w-0">
                          {editing ? (
                            <textarea
                              autoFocus
                              style={{ ...inputStyle, minHeight: 64, lineHeight: 1.5 }}
                              value={d.question}
                              onChange={(e) => setDecisions((p) =>
                                p.map((x) => (x.id === d.id ? { ...x, question: e.target.value } : x)))}
                              onBlur={() => setEditDecision(null)}
                            />
                          ) : (
                            <p
                              onClick={() => setEditDecision(d.id)}
                              className="text-lg cursor-text"
                              style={{
                                color: C.ink, lineHeight: 1.55, maxWidth: "80ch",
                                textDecoration: d.resolved ? "line-through" : "none",
                              }}>
                              {d.question}
                            </p>
                          )}
                        </div>

                        <div className="sm:text-right shrink-0" style={{ maxWidth: 280 }}>
                          <span className="inline-flex items-center rounded px-2.5 py-1 text-sm font-medium"
                                style={{ background: "#E5EFFB", color: "#22558F" }}>
                            {d.owner}
                          </span>
                          {d.blocks && (
                            <p
                              onClick={() => { if (target) { setFilter("All items"); setOpenId(target.id); } }}
                              className="text-sm mt-2"
                              style={{
                                color: target ? C.accent : C.mute,
                                cursor: target ? "pointer" : "default",
                                lineHeight: 1.45,
                              }}>
                              Blocks: {d.blocks}{d.blocksPhase ? ` — ${d.blocksPhase}` : ""}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-3 mt-2.5">
                        <button
                          onClick={() => setDecisions((p) =>
                            p.map((x) => (x.id === d.id ? { ...x, resolved: !x.resolved } : x)))}
                          className="text-sm px-3 py-1.5 rounded"
                          style={{
                            border: `1px solid ${C.rule}`,
                            background: d.resolved ? STATUS.Shipped.bg : "#fff",
                            color: d.resolved ? STATUS.Shipped.fg : C.body,
                          }}>
                          {d.resolved ? "Answered" : "Mark answered"}
                        </button>
                        <button
                          onClick={() => setDecisions((p) => p.filter((x) => x.id !== d.id))}
                          className="text-sm px-3 py-1.5 rounded ml-auto"
                          style={{ color: C.faint }}>
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* ---------------- risks ---------------- */}
            <div className="flex items-baseline gap-3 mt-9 mb-3">
              <h2 className="text-2xl font-semibold" style={{ color: "#16305C" }}>
                Risks &amp; sequencing notes
              </h2>
              <button
                onClick={() => setRisks((p) => [...p,
                  { id: `k${Date.now()}`, tone: "order", text: "New sequencing note" }])}
                className="ml-auto text-sm px-3.5 py-2 rounded"
                style={{ border: `1px solid ${C.rule}`, color: C.body }}>
                Add note
              </button>
            </div>

            {risks.map((r) => {
              const tone = RISK_TONE[r.tone] || RISK_TONE.order;
              return (
                <div key={r.id} className="mb-2 rounded-lg overflow-hidden flex"
                     style={{ background: tone.bg }}>
                  <button
                    onClick={() => setRisks((p) => p.map((x) => x.id === r.id
                      ? { ...x, tone: x.tone === "conflict" ? "duplicate" : x.tone === "duplicate" ? "order" : "conflict" }
                      : x))}
                    title="Change the note type"
                    style={{ width: 5, background: tone.bar, border: "none", cursor: "pointer" }}
                  />
                  <div className="flex-1 px-4 py-3">
                    <textarea
                      value={r.text}
                      onChange={(e) => setRisks((p) =>
                        p.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)))}
                      className="w-full text-lg"
                      style={{
                        color: C.ink, lineHeight: 1.55, border: "none", outline: "none",
                        background: "transparent", resize: "vertical", minHeight: 54,
                        fontFamily: FONT, maxWidth: "88ch",
                      }}
                    />
                  </div>
                  <button
                    onClick={() => setRisks((p) => p.filter((x) => x.id !== r.id))}
                    className="text-lg px-4"
                    style={{ color: C.faint, border: "none", background: "transparent" }}>
                    ×
                  </button>
                </div>
              );
            })}
          </>
        )}
          </>
        )}
      </div>

      {/* full-size image viewer — above the drawer, Esc or backdrop to close */}
      {lightbox && (
        <div
          onClick={() => { setLightbox(null); setArmedDelete(null); }}
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            background: "rgba(16,19,22,0.86)",
            display: "flex", flexDirection: "column",
          }}>
          <div className="flex items-center gap-3 px-5 py-3"
               onClick={(e) => e.stopPropagation()}
               style={{ color: "#fff" }}>
            <span className="text-base truncate" style={{ flex: 1 }}>{lightbox.name}</span>

            <button
              onClick={async () => {
                const ok = await openInNewTab(imgCache[lightbox.id], lightbox.name);
                if (!ok) setImgError("Your browser blocked the new tab — use Download instead.");
              }}
              className="text-sm px-3 py-1.5 rounded"
              style={{ border: "1px solid rgba(255,255,255,0.35)", background: "transparent",
                       color: "#fff", cursor: "pointer" }}>
              Open in new tab
            </button>

            <a href={imgCache[lightbox.id]} download={lightbox.name || "image.jpg"}
               className="text-sm px-3 py-1.5 rounded"
               style={{ border: "1px solid rgba(255,255,255,0.35)", color: "#fff",
                        textDecoration: "none" }}>
              Download
            </a>

            {armedDelete === lightbox.id ? (
              <button
                onClick={() => {
                  if (open) removeImage(open.id, lightbox.id, lightbox.field || "images");
                  setArmedDelete(null); setLightbox(null);
                }}
                className="text-sm px-3 py-1.5 rounded"
                style={{ background: STATUS.Blocked.bg, color: STATUS.Blocked.fg,
                         border: "none", cursor: "pointer" }}>
                Delete for good?
              </button>
            ) : (
              <button
                onClick={() => setArmedDelete(lightbox.id)}
                className="text-sm px-3 py-1.5 rounded"
                style={{ border: "1px solid rgba(255,255,255,0.35)", background: "transparent",
                         color: "#fff", cursor: "pointer" }}>
                Delete
              </button>
            )}

            <button onClick={() => { setLightbox(null); setArmedDelete(null); }}
                    className="text-sm px-3 py-1.5 rounded"
                    style={{ border: "1px solid rgba(255,255,255,0.35)", background: "transparent",
                             color: "#fff", cursor: "pointer" }}>
              Close
            </button>
          </div>

          <div className="flex-1 flex items-center justify-center px-5 pb-5 relative"
               onClick={() => { setLightbox(null); setArmedDelete(null); }}>
            {imgError && (
              <span className="absolute text-sm px-3 py-1.5 rounded"
                    style={{ top: 64, background: DUE_TONE.late.bg, color: DUE_TONE.late.fg }}>
                {imgError}
              </span>
            )}
            {imgCache[lightbox.id] ? (
              <img src={imgCache[lightbox.id]} alt={lightbox.name}
                   onClick={(e) => e.stopPropagation()}
                   style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
                            borderRadius: 8 }} />
            ) : (
              <span style={{ color: "#fff" }}>Loading…</span>
            )}
          </div>
        </div>
      )}

      {/* detail */}
      {open && (
        <>
          <div onClick={() => setOpenId(null)}
               style={{ position: "fixed", inset: 0, background: "rgba(26,29,33,0.32)" }} />
          <div className="p-6 overflow-y-auto"
               style={{
                 position: "fixed", top: 0, right: 0, bottom: 0,
                 width: "min(700px, 100%)", background: "#fff",
                 borderLeft: `1px solid ${C.rule}`,
               }}>
            <div className="flex items-start gap-3 mb-1">
              <Badge status={open.status} />
              <button onClick={() => setOpenId(null)}
                      className="ml-auto text-sm px-2 py-1 rounded"
                      style={{ color: C.mute, border: `1px solid ${C.rule}` }}>Close</button>
            </div>

            {/* names already in use, so the same person is not spelled
                three ways across the board */}
            <datalist id="developer-names">
              {Array.from(new Set(items.map((i) => i.developer).filter(Boolean)))
                .sort()
                .map((n) => <option key={n} value={n} />)}
            </datalist>

            <input
              value={open.item}
              onChange={(e) => patch(open.id, { item: e.target.value })}
              className="text-3xl font-bold tracking-tight w-full mt-4 mb-6"
              style={{ color: "#16305C", border: "none", outline: "none", fontFamily: FONT }}
            />

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-sm mb-2" style={{ color: C.mute }}>Status</span>
                <select style={inputStyle} value={open.status}
                        onChange={(e) => patch(open.id, { status: e.target.value })}>
                  {cfg.statuses.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-sm mb-2" style={{ color: C.mute }}>
                  {board === "prd" ? "Owner" : "Requested by"}
                </span>
                <input style={inputStyle} value={open.owner || ""}
                       onChange={(e) => patch(open.id, { owner: e.target.value })} />
              </label>
              <label className="block">
                <span className="block text-sm mb-2" style={{ color: C.mute }}>Developer</span>
                <input style={inputStyle} value={open.developer || ""}
                       placeholder="Who is building it"
                       list="developer-names"
                       onChange={(e) => patch(open.id, { developer: e.target.value })} />
              </label>
              <label className="block">
                <span className="block text-sm mb-2" style={{ color: C.mute }}>
                  {board === "prd" ? "Phase" : "Type"}
                </span>
                <input style={inputStyle}
                       value={board === "prd" ? (open.phase || "") : (open.type || "")}
                       onChange={(e) => patch(open.id,
                         board === "prd" ? { phase: e.target.value } : { type: e.target.value })} />
              </label>
              <label className="block">
                <span className="block text-sm mb-2" style={{ color: C.mute }}>Estimate (days)</span>
                <input style={inputStyle} value={open.estimate || ""}
                       onChange={(e) => patch(open.id, { estimate: e.target.value })} />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
              <label className="block">
                <span className="block text-sm mb-2" style={{ color: C.mute }}>Due date</span>
                <input type="date" style={inputStyle} value={open.due || ""}
                       onChange={(e) => patch(open.id, { due: e.target.value })} />
                {dueInfo(open.due) && !open.finished && (
                  <span className="text-sm" style={{ color: DUE_TONE[dueInfo(open.due).tone].fg }}>
                    {dueInfo(open.due).label} — {dueInfo(open.due).rel}
                  </span>
                )}
              </label>
              <label className="block">
                <span className="block text-sm mb-2" style={{ color: C.mute }}>Finished</span>
                <input type="date" style={inputStyle} value={open.finished || ""}
                       onChange={(e) => patch(open.id, { finished: e.target.value })} />
                {dueInfo(open.finished) && (
                  <span className="text-sm" style={{ color: STATUS.Shipped.fg }}>
                    {dueInfo(open.finished).label}
                    {dueInfo(open.due) &&
                      ` — ${asDate(open.finished) <= asDate(open.due) ? "on time" : "late"}`}
                  </span>
                )}
              </label>
            </div>

            {/* PRD lives as a PDF, so this is a file rather than a link */}
            <div className="mt-4">
              <span className="flex items-center gap-2 text-sm mb-2" style={{ color: C.mute }}>
                PRD (PDF)
                {!open.prdFile && (
                  <button
                    onClick={() => patch(open.id, { prdFlag: !open.prdFlag })}
                    className="text-sm"
                    style={{ border: "none", background: "none", padding: 0, cursor: "pointer",
                             color: open.prdFlag ? C.accent : C.faint,
                             textDecoration: "underline" }}>
                    {open.prdFlag ? "✓ marked as having a PRD" : "mark as having a PRD"}
                  </button>
                )}
              </span>

              {open.prdFile ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2.5"
                     style={{ border: `1px solid ${C.rule}`, background: "#FCFCFD" }}>
                  <button onClick={() => openPrd(open.prdFile)}
                          title="Open the PDF in a new tab"
                          className="text-base truncate"
                          style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none",
                                   background: "none", color: C.accent,
                                   textDecoration: "underline", cursor: "pointer" }}>
                    {open.prdFile.name} ↗
                  </button>

                  {open.prdFile.size && (
                    <span className="text-sm shrink-0" style={{ color: C.faint }}>
                      {prettySize(open.prdFile.size)}
                    </span>
                  )}

                  <label className="text-sm px-3 py-1.5 rounded shrink-0"
                         style={{ border: `1px solid ${C.rule}`, background: "#fff",
                                  color: C.body, cursor: "pointer" }}>
                    Replace
                    <input type="file" accept="application/pdf,.pdf" style={{ display: "none" }}
                           onChange={(e) => { setPrdFile(open.id, e.target.files); e.target.value = ""; }} />
                  </label>

                  {armedPrd ? (
                    <button onClick={() => { removePrd(open.id, open.prdFile); setArmedPrd(false); }}
                            className="text-sm px-3 py-1.5 rounded shrink-0"
                            style={{ background: STATUS.Blocked.bg, color: STATUS.Blocked.fg,
                                     border: "none", cursor: "pointer" }}>
                      Sure?
                    </button>
                  ) : (
                    <button onClick={() => setArmedPrd(true)}
                            className="text-sm px-3 py-1.5 rounded shrink-0"
                            style={{ border: `1px solid ${C.rule}`, background: "#fff",
                                     color: C.mute, cursor: "pointer" }}>
                      Remove
                    </button>
                  )}
                </div>
              ) : (
                <div
                  onDragOver={(e) => { e.preventDefault(); setPrdDrop(true); }}
                  onDragLeave={() => setPrdDrop(false)}
                  onDrop={(e) => {
                    e.preventDefault(); setPrdDrop(false);
                    setPrdFile(open.id, e.dataTransfer.files);
                  }}
                  className="rounded-lg px-4 py-5 text-center"
                  style={{
                    border: `2px dashed ${prdDrop ? C.accent : C.rule}`,
                    background: prdDrop ? "#F4F8FD" : "#FCFCFD",
                  }}>
                  <p className="text-base mb-2" style={{ color: C.body }}>
                    {prdBusy ? "Attaching…" : "Drop the PRD here, or"}
                  </p>
                  <label className="text-base px-3.5 py-2 rounded inline-block"
                         style={{ border: `1px solid ${C.rule}`, background: "#fff",
                                  color: C.accent, cursor: "pointer" }}>
                    Choose a PDF
                    <input type="file" accept="application/pdf,.pdf" style={{ display: "none" }}
                           onChange={(e) => { setPrdFile(open.id, e.target.files); e.target.value = ""; }} />
                  </label>
                  <p className="text-sm mt-2" style={{ color: C.faint }}>
                    Up to {prettySize(PDF_LIMIT)}
                  </p>
                </div>
              )}

              {prdError && (
                <p className="text-sm mt-2" style={{ color: DUE_TONE.late.fg }}>{prdError}</p>
              )}
            </div>

            <label className="block mt-4">
              <span className="block text-sm mb-2" style={{ color: C.mute }}>Admin URL</span>
              <input style={inputStyle} value={open.adminUrl || ""}
                     placeholder="https://admin.arenaclub.com/…"
                     onChange={(e) => patch(open.id, { adminUrl: e.target.value })} />
              {open.adminUrl && open.adminUrl.trim() && (
                <a href={asHref(open.adminUrl)} target="_blank" rel="noreferrer"
                   title={asHref(open.adminUrl)}
                   className="block text-sm mt-1.5 truncate"
                   style={{ color: C.accent, textDecoration: "underline" }}>
                  {open.adminUrl.replace(/^https?:\/\//i, "")} ↗
                </a>
              )}
            </label>

            {/* Impact — evidence for the business case. Click a tile and it
                opens in a new tab, since these are usually numbers you want
                side by side with something else. */}
            <div className="mt-4">
              <span className="block text-sm mb-2" style={{ color: C.mute }}>
                Impact {open.impactImages && open.impactImages.length
                  ? `(${open.impactImages.length})` : ""}
              </span>

              <div
                onDragOver={(e) => { e.preventDefault(); setImpactDrop(true); }}
                onDragLeave={() => setImpactDrop(false)}
                onDrop={(e) => {
                  e.preventDefault(); setImpactDrop(false);
                  addImages(open.id, e.dataTransfer.files, "impactImages");
                }}
                onPaste={(e) => {
                  const f = e.clipboardData && e.clipboardData.files;
                  if (f && f.length) { e.preventDefault(); addImages(open.id, f, "impactImages"); }
                }}
                className="rounded-lg px-4 py-5 text-center"
                style={{
                  border: `2px dashed ${impactDrop ? C.accent : C.rule}`,
                  background: impactDrop ? "#F4F8FD" : "#FCFCFD",
                }}>
                <p className="text-base mb-2" style={{ color: C.body }}>
                  Drop the impact numbers here, paste a screenshot, or
                </p>
                <label className="text-base px-3.5 py-2 rounded inline-block"
                       style={{ border: `1px solid ${C.rule}`, background: "#fff",
                                color: C.accent, cursor: "pointer" }}>
                  Choose files
                  <input type="file" accept="image/*" multiple style={{ display: "none" }}
                         onChange={(e) => {
                           addImages(open.id, e.target.files, "impactImages");
                           e.target.value = "";
                         }} />
                </label>
                <p className="text-sm mt-2" style={{ color: C.faint }}>
                  PNGs stay lossless so figures remain readable. Click a tile to view it.
                </p>
              </div>

              {open.impactImages && open.impactImages.length > 0 && (
                <div className="flex flex-wrap gap-3 mt-3">
                  {open.impactImages.map((img) => (
                    <div key={img.id} className="rounded-lg overflow-hidden"
                         style={{ border: `1px solid ${C.rule}`, width: 148 }}>
                      {imgCache[img.id] ? (
                        <button onClick={() => setLightbox({ ...img, field: "impactImages" })}
                                title="Click to view full size"
                                style={{ display: "block", width: "100%", padding: 0,
                                         border: "none", background: "none", cursor: "zoom-in" }}>
                          <img src={imgCache[img.id]} alt={img.name}
                               style={{ width: "100%", height: 96, objectFit: "cover",
                                        display: "block" }} />
                        </button>
                      ) : (
                        <div className="flex items-center justify-center text-sm"
                             style={{ height: 96, background: C.shell, color: C.faint }}>
                          loading…
                        </div>
                      )}
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <span className="text-sm truncate" style={{ color: C.body, flex: 1 }}
                              title={img.name}>{img.name}</span>
                        {armedDelete === img.id ? (
                          <button
                            onClick={() => {
                              removeImage(open.id, img.id, "impactImages");
                              setArmedDelete(null);
                            }}
                            className="text-sm px-2 rounded shrink-0"
                            style={{ background: STATUS.Blocked.bg, color: STATUS.Blocked.fg,
                                     border: "none", cursor: "pointer" }}>
                            Sure?
                          </button>
                        ) : (
                          <button onClick={() => setArmedDelete(img.id)}
                                  title="Delete this image"
                                  className="text-base px-1.5 rounded shrink-0"
                                  style={{ color: C.mute, border: `1px solid ${C.rule}`,
                                           background: "#fff", cursor: "pointer" }}>
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <label className="block mt-4">
              <span className="block text-sm mb-2" style={{ color: C.mute }}>Next action</span>
              <input style={inputStyle} value={open.next || ""}
                     onChange={(e) => patch(open.id, { next: e.target.value })} />
            </label>

            <label className="block mt-4">
              <span className="block text-sm mb-2" style={{ color: C.mute }}>
                {board === "prd" ? "Task" : "Problem statement"}
              </span>
              <textarea style={{ ...inputStyle, minHeight: 150, lineHeight: 1.6 }}
                        value={open.task || ""}
                        onChange={(e) => patch(open.id, { task: e.target.value })} />
            </label>

            <label className="block mt-4">
              <span className="block text-sm mb-2" style={{ color: C.mute }}>Dependencies / blockers</span>
              <textarea style={{ ...inputStyle, minHeight: 80, lineHeight: 1.6 }}
                        value={open.blockers || ""}
                        onChange={(e) => patch(open.id, { blockers: e.target.value })} />
            </label>

            {board === "intake" && (
              <>
                <label className="block mt-4">
                  <span className="block text-sm mb-2" style={{ color: C.mute }}>Teams impacted</span>
                  <input style={inputStyle} value={open.teams || ""}
                         onChange={(e) => patch(open.id, { teams: e.target.value })} />
                </label>
                <label className="block mt-4">
                  <span className="block text-sm mb-2" style={{ color: C.mute }}>Business impact</span>
                  <textarea style={{ ...inputStyle, minHeight: 80, lineHeight: 1.6 }}
                            value={open.impact || ""}
                            onChange={(e) => patch(open.id, { impact: e.target.value })} />
                </label>
              </>
            )}

            {board === "prd" && (
              <label className="block mt-4">
                <span className="block text-sm mb-2" style={{ color: C.mute }}>Analysis document</span>
                <input style={inputStyle} value={open.analysisDoc || ""}
                       onChange={(e) => patch(open.id, { analysisDoc: e.target.value })} />
              </label>
            )}

            <label className="block mt-4">
              <span className="block text-sm mb-2" style={{ color: C.mute }}>Notes</span>
              <textarea style={{ ...inputStyle, minHeight: 90, lineHeight: 1.6 }}
                        value={open.notes || ""}
                        onChange={(e) => patch(open.id, { notes: e.target.value })} />
            </label>

            {/* attachments — drop, paste or browse; as many as needed */}
            <div className="mt-6">
              <span className="block text-sm mb-2" style={{ color: C.mute }}>
                Images {open.images && open.images.length ? `(${open.images.length})` : ""}
              </span>

              <div
                onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
                onDragLeave={() => setDropping(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropping(false);
                  addImages(open.id, e.dataTransfer.files);
                }}
                onPaste={(e) => {
                  const f = e.clipboardData && e.clipboardData.files;
                  if (f && f.length) { e.preventDefault(); addImages(open.id, f); }
                }}
                className="rounded-lg px-4 py-6 text-center"
                style={{
                  border: `2px dashed ${dropping ? C.accent : C.rule}`,
                  background: dropping ? "#F4F8FD" : "#FCFCFD",
                }}>
                <p className="text-base mb-2" style={{ color: C.body }}>
                  {imgBusy ? "Adding…" : "Drop images here, paste a screenshot, or"}
                </p>
                <label className="text-base px-3.5 py-2 rounded inline-block"
                       style={{ border: `1px solid ${C.rule}`, background: "#fff",
                                color: C.accent, cursor: "pointer" }}>
                  Choose files
                  <input type="file" accept="image/*" multiple style={{ display: "none" }}
                         onChange={(e) => { addImages(open.id, e.target.files); e.target.value = ""; }} />
                </label>
                <p className="text-sm mt-2" style={{ color: C.faint }}>
                  Resized to 1600px and stored separately from the board
                </p>
                {imgError && (
                  <p className="text-sm mt-2" style={{ color: DUE_TONE.late.fg }}>{imgError}</p>
                )}
              </div>

              {open.images && open.images.length > 0 && (
                <div className="flex flex-wrap gap-3 mt-3">
                  {open.images.map((img) => (
                    <div key={img.id} className="rounded-lg overflow-hidden"
                         style={{ border: `1px solid ${C.rule}`, width: 148 }}>
                      {imgCache[img.id] ? (
                        <button onClick={() => setLightbox({ ...img, field: "images" })}
                                title="Click to view full size"
                                style={{ display: "block", width: "100%", padding: 0,
                                         border: "none", background: "none", cursor: "zoom-in" }}>
                          <img src={imgCache[img.id]} alt={img.name}
                               style={{ width: "100%", height: 96, objectFit: "cover", display: "block" }} />
                        </button>
                      ) : (
                        <div className="flex items-center justify-center text-sm"
                             style={{ height: 96, background: C.shell, color: C.faint }}>
                          loading…
                        </div>
                      )}
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <span className="text-sm truncate" style={{ color: C.body, flex: 1 }}
                              title={img.name}>
                          {img.name}
                        </span>
                        {armedDelete === img.id ? (
                          <button
                            onClick={() => { removeImage(open.id, img.id); setArmedDelete(null); }}
                            className="text-sm px-2 rounded shrink-0"
                            style={{ background: STATUS.Blocked.bg, color: STATUS.Blocked.fg,
                                     border: "none", cursor: "pointer" }}>
                            Sure?
                          </button>
                        ) : (
                          <button
                            onClick={() => setArmedDelete(img.id)}
                            title="Delete this image"
                            className="text-base px-1.5 rounded shrink-0"
                            style={{ color: C.mute, border: `1px solid ${C.rule}`,
                                     background: "#fff", cursor: "pointer" }}>
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-5 pb-10">
              <button onClick={() => setOpenId(null)}
                      className="px-3.5 py-2 text-sm rounded font-medium"
                      style={{ background: C.ink, color: "#fff" }}>Done</button>

              {/* an intake request that gets picked up becomes a roadmap item.
                  Intake-only fields stay on the record, so moving it back
                  restores them rather than losing them. */}
              <button
                onClick={() => moveBoard(open.id, board === "intake" ? "prd" : "intake")}
                className="px-3.5 py-2 text-sm rounded"
                style={{ border: `1px solid ${C.accent}`, background: "#F4F8FD", color: C.accent }}>
                {board === "intake" ? "Move to roadmap →" : "← Move back to intake"}
              </button>

              <button
                onClick={() => {
                  setRemovedIds((prev) => new Set(prev).add(open.id));
                  setItems((p) => p.filter((x) => x.id !== open.id));
                  setOpenId(null);
                }}
                className="px-3 py-2 text-sm rounded ml-auto"
                style={{ background: STATUS.Blocked.bg, color: STATUS.Blocked.fg }}>
                Delete
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


ReactDOM.createRoot(document.getElementById("root")).render(<Roadmap />);
