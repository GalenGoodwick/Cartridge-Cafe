#!/usr/bin/env node
// bsky-post — post to Bluesky as @cartridge-cafe (Galen's account).
//
//   node tools/bsky-post.mjs "text of the post"
//   node tools/bsky-post.mjs "with a link https://cartridge.cafe/space/tideglass"
//   node tools/bsky-post.mjs "look at this" --image /path/to.png --alt "a sunset shore"
//   node tools/bsky-post.mjs "watch it run" --video /path/to.mp4 --alt "gameplay"
//
// Credentials come from cartridge-cafe/web/.env.local (gitignored):
//   BLUESKY_HANDLE=cartridge-cafe.bsky.social
//   BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx   (revocable, Settings → App Passwords)
//
// No SDK — raw atproto XRPC. Auto-detects links + #hashtags into richtext facets
// so they're clickable. Images/video upload as blobs first, then embed.
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const PDS = 'https://bsky.social'

function loadEnv() {
  const env = {}
  try {
    const txt = readFileSync(join(here, '../web/.env.local'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* fall through to process.env */ }
  return {
    handle: process.env.BLUESKY_HANDLE || env.BLUESKY_HANDLE,
    password: process.env.BLUESKY_APP_PASSWORD || env.BLUESKY_APP_PASSWORD,
  }
}

async function xrpc(method, endpoint, { token, body, contentType } = {}) {
  const headers = {}
  if (token) headers.authorization = 'Bearer ' + token
  if (contentType) headers['content-type'] = contentType
  else if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${PDS}/xrpc/${endpoint}`, {
    method,
    headers,
    body: contentType ? body : (body !== undefined ? JSON.stringify(body) : undefined),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${text.slice(0, 400)}`)
  return json
}

// UTF-8 byte-indexed facets for links and hashtags (Bluesky measures in bytes)
function detectFacets(text) {
  const enc = new TextEncoder()
  const facets = []
  const urlRe = /https?:\/\/[^\s]+[^\s.,;:!?)]/g
  let m
  while ((m = urlRe.exec(text))) {
    const byteStart = enc.encode(text.slice(0, m.index)).length
    const byteEnd = byteStart + enc.encode(m[0]).length
    facets.push({ index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }] })
  }
  const tagRe = /(^|\s)(#[A-Za-z0-9_]+)/g
  while ((m = tagRe.exec(text))) {
    const tag = m[2]
    const at = m.index + m[1].length
    const byteStart = enc.encode(text.slice(0, at)).length
    const byteEnd = byteStart + enc.encode(tag).length
    facets.push({ index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tag.slice(1) }] })
  }
  return facets
}

async function uploadBlob(token, path, mime) {
  const bytes = readFileSync(path)
  const out = await xrpc('POST', 'com.atproto.repo.uploadBlob', { token, body: bytes, contentType: mime })
  return out.blob
}

function mimeOf(path) {
  const p = path.toLowerCase()
  if (p.endsWith('.png')) return 'image/png'
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg'
  if (p.endsWith('.gif')) return 'image/gif'
  if (p.endsWith('.webp')) return 'image/webp'
  if (p.endsWith('.mp4')) return 'video/mp4'
  if (p.endsWith('.mov')) return 'video/quicktime'
  return 'application/octet-stream'
}

async function main() {
  const argv = process.argv.slice(2)
  const flags = { image: null, video: null, alt: '' }
  const parts = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--image') flags.image = argv[++i]
    else if (argv[i] === '--video') flags.video = argv[++i]
    else if (argv[i] === '--alt') flags.alt = argv[++i]
    else parts.push(argv[i])
  }
  const text = parts.join(' ').trim()
  if (!text && !flags.image && !flags.video) {
    console.error('usage: node tools/bsky-post.mjs "text" [--image f.png|--video f.mp4] [--alt "…"]')
    process.exit(1)
  }
  if ([...text].length > 300) {
    console.error(`post is ${[...text].length} chars — Bluesky max is 300. Trim it.`)
    process.exit(1)
  }

  const { handle, password } = loadEnv()
  if (!handle || !password) { console.error('missing BLUESKY_HANDLE / BLUESKY_APP_PASSWORD in web/.env.local'); process.exit(1) }

  const session = await xrpc('POST', 'com.atproto.server.createSession', { body: { identifier: handle, password } })
  const token = session.accessJwt

  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    facets: detectFacets(text),
  }

  if (flags.image) {
    const blob = await uploadBlob(token, flags.image, mimeOf(flags.image))
    record.embed = { $type: 'app.bsky.embed.images', images: [{ image: blob, alt: flags.alt || '' }] }
  } else if (flags.video) {
    const blob = await uploadBlob(token, flags.video, mimeOf(flags.video))
    record.embed = { $type: 'app.bsky.embed.video', video: blob, alt: flags.alt || '' }
  }

  const out = await xrpc('POST', 'com.atproto.repo.createRecord', {
    token,
    body: { repo: session.did, collection: 'app.bsky.feed.post', record },
  })
  const rkey = out.uri.split('/').pop()
  console.log(`POSTED · https://bsky.app/profile/${handle}/post/${rkey}`)
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
