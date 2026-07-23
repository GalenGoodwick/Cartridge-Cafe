#!/usr/bin/env node
// TRANSCRIPT SEARCH — Galen's "index all development transcripts; dig in when
// there is nothing else to do." Every Claude session on this machine leaves a
// .jsonl transcript; this makes that whole development history searchable from
// the terminal (and from any daemon's quiet cycle).
//
//   node tools/transcript-search.mjs index            → build/refresh the catalog
//   node tools/transcript-search.mjs search "query"   → grep all transcripts
//   node tools/transcript-search.mjs sessions         → list sessions (newest first)
//
// PRIVACY IS LOAD-BEARING: transcripts contain live credentials. Every output
// line passes through redact() — bearer keys, api keys, env secrets are masked.
// The catalog stores titles + metadata only, never message bodies.

import { readdirSync, readFileSync, writeFileSync, statSync, createReadStream } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createInterface } from "readline";

const ROOT = join(homedir(), ".claude", "projects");
const CATALOG = join(homedir(), ".cafe-transcript-index.json");

// mask anything credential-shaped — uc_* cafe keys, sk- api keys, bearer
// headers, postgres urls, VAPID-ish base64 blobs in env assignments
const redact = (s) =>
  s.replace(/uc_[a-z]{2}_[0-9a-f]{8,}/gi, "uc_**_[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{8,}/g, "Bearer [redacted]")
    .replace(/postgres(ql)?:\/\/\S+/g, "postgres://[redacted]")
    .replace(/([A-Z_]{4,}=)[^\s"']{12,}/g, "$1[redacted]");

function* transcripts() {
  for (const dir of readdirSync(ROOT, { withFileTypes: true })) {
    const base = dir.isDirectory() ? join(ROOT, dir.name) : ROOT;
    let names = [];
    try { names = readdirSync(base).filter(n => n.endsWith(".jsonl")); } catch { continue; }
    for (const n of names) yield join(base, n);
    if (!dir.isDirectory() && dir.name.endsWith(".jsonl")) yield join(ROOT, dir.name);
  }
}

// pull displayable text out of one transcript line (user/assistant messages)
function textOf(line) {
  try {
    const j = JSON.parse(line);
    const m = j.message;
    if (!m) return null;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) return m.content.filter(c => c.type === "text").map(c => c.text).join(" ");
  } catch { /* non-message line */ }
  return null;
}

async function index() {
  const cat = [];
  for (const path of new Set(transcripts())) {
    let st; try { st = statSync(path); } catch { continue; }
    let title = "";
    const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    for await (const line of rl) {
      const t = textOf(line);
      if (t && t.trim()) { title = redact(t.trim().slice(0, 140)); rl.close(); break; }
    }
    cat.push({ session: path.split("/").pop().replace(".jsonl", ""), path, mtime: st.mtimeMs, mb: +(st.size / 1e6).toFixed(1), title });
  }
  cat.sort((a, b) => b.mtime - a.mtime);
  writeFileSync(CATALOG, JSON.stringify({ at: Date.now(), sessions: cat }, null, 1));
  console.log(`indexed ${cat.length} transcripts → ${CATALOG}`);
}

async function search(query, limit = 25) {
  const q = query.toLowerCase();
  let hits = 0;
  for (const path of new Set(transcripts())) {
    if (hits >= limit) break;
    const session = path.split("/").pop().replace(".jsonl", "");
    const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    let n = 0;
    for await (const line of rl) {
      n++;
      if (hits >= limit) { rl.close(); break; }
      if (!line.toLowerCase().includes(q)) continue;
      const t = textOf(line);
      if (!t || !t.toLowerCase().includes(q)) continue;
      const i = t.toLowerCase().indexOf(q);
      const snip = t.slice(Math.max(0, i - 80), i + q.length + 120).replace(/\s+/g, " ");
      console.log(`\x1b[36m${session.slice(0, 8)}\x1b[0m:${n}  …${redact(snip)}…`);
      hits++;
    }
  }
  console.log(hits ? `\n${hits} hit(s)` : "no hits");
}

function sessions() {
  let cat;
  try { cat = JSON.parse(readFileSync(CATALOG, "utf8")); } catch { console.error("no catalog — run `index` first"); process.exit(1); }
  for (const s of cat.sessions.slice(0, 40)) {
    console.log(`${new Date(s.mtime).toISOString().slice(0, 16)}  ${s.session.slice(0, 8)}  ${String(s.mb).padStart(6)}MB  ${s.title}`);
  }
}

const [, , cmd, ...rest] = process.argv;
if (cmd === "index") await index();
else if (cmd === "search" && rest.length) await search(rest.join(" "), parseInt(process.env.LIMIT || 25));
else if (cmd === "sessions") sessions();
else console.log("usage: transcript-search.mjs index | search <query> | sessions");
