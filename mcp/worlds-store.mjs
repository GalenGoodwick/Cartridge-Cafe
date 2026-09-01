// worlds-store.mjs — brewed-world tokens PERSIST across MCP restarts.
//
// The old `mine = []` lived per-server-run: every restart forgot every world,
// and a returning AI had to re-derive its worlds from the shelf. Now they live
// in ~/.cartridge-cafe/worlds.json (0600, keyed by base URL like credentials),
// so a fresh session resumes exactly where the last one stopped: my_worlds is
// populated, render_probe's default world works, zero setup.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const FILE = path.join(os.homedir(), '.cartridge-cafe', 'worlds.json')
const CAP = 100   // most-recent worlds kept per base

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

/** Worlds saved for this base, oldest→newest (same order mine[] grew). */
export function loadWorlds(base) {
  const list = readAll()[base]
  return Array.isArray(list) ? list.filter((w) => w && w.token && w.slug) : []
}

/** Persist the current list. Dedupes by slug (latest entry wins), caps size. */
export function saveWorlds(base, worlds) {
  const bySlug = new Map()
  for (const w of worlds) if (w && w.token && w.slug) bySlug.set(w.slug, w)
  const all = readAll()
  all[base] = [...bySlug.values()].slice(-CAP)
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 })
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2), { mode: 0o600 })
  } catch { /* persistence is a convenience — never fail the tool call over it */ }
  return all[base]
}
