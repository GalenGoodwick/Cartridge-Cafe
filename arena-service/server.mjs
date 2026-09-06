// arena-service — authoritative multiplayer, as a cloud service (Deno, on Railway).
//
// THE BET (why this is game-type-agnostic): every cartridge.cafe game is already
// input(afferents) → step-hook(logic) → state(whiteboard) → render. So the server
// doesn't need to know the game TYPE — it runs the game's OWN step-hook as the
// authority, feeds it every player's inputs, and broadcasts the resulting
// whiteboard. Any game that runs client-side runs here unchanged. New game type =
// a new MANIFEST (declarative config), never new engine.
//
//   WS  /join?world=<slug>&role=<role>   — a player docks; server assigns a room
//   msg {type:'input', input:{...}}       — the player's afferent frame, per tick
//   msg {type:'state', tick, worldData}   — server → all players, the authority
//
// The hook is UNTRUSTED code (players author it) running authoritatively, so it
// runs in a sealed Worker — no DOM, no network, no fs — exactly the sandbox the
// client uses (web/src/app/engine/world-sandbox.ts). Server-side isolation is
// the harder half of that same security story.
//
//   GET /health -> "ok"    ·    deploy: railway.json (Dockerfile, Deno)

const SECRET = Deno.env.get('ARENA_SECRET') || ''
const BRIDGE = Deno.env.get('BRIDGE_URL') || 'https://cartridge.cafe/api/engine/bridge'
const TICK_HZ = 24
const TICK_MS = 1000 / TICK_HZ

// ─────────────────────────────────────────────── the authoritative hook Worker
// Minimal sim shim — MUST stay in lockstep with world-sandbox.ts (that file is
// canonical). Sealed globals: no fetch/net/storage reach even on a globalThis
// escape. Runs the game's real step-hooks against the shared worldData.
const WORKER_SRC = `
for (const k of ['fetch','XMLHttpRequest','WebSocket','importScripts','Deno','indexedDB','caches','Worker']) {
  try { Object.defineProperty(self, k, { value: undefined, configurable: false }); } catch (e) {}
}
let hooks = [];
self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === 'load') {
    hooks = [];
    for (const h of m.hooks) { try { hooks.push({ id: h.id, fn: new Function('sim','dt', h.code) }); } catch (e) {} }
    self.postMessage({ type: 'ready' }); return;
  }
  if (m.type === 'tick') {
    const wd = m.worldData;
    const fields = new Map();
    for (const f of m.fields) fields.set(f.id, { id: f.id, name: f.name, transform: f.transform });
    const sim = {
      worldData: wd, fields,
      getFieldByName(n){ for (const f of fields.values()) if (f.name===n) return f; return null; },
      rand: Math.random,
      trigger(id,c){ const L=wd.__trig||(wd.__trig={}); if(c&&!L[id]){L[id]=true;return true;} return false; },
      edge(id,c){ const L=wd.__edge||(wd.__edge={}); const was=!!L[id]; L[id]=!!c; return !!c&&!was; },
      _ch(){ return wd.__chapters||(wd.__chapters={names:[''],unlocked:[1],cur:1}); },
      defineChapters(n){ const c=this._ch(); c.names=['',...n]; if(!c.unlocked?.length)c.unlocked=[1]; if(!c.cur)c.cur=1; },
      get act(){ return this._ch().cur; },
      completeChapter(){ const c=this._ch(); const nx=c.cur+1; if(nx<=c.names.length-1){ if(!c.unlocked.includes(nx))c.unlocked.push(nx); c.cur=nx; return true;} return false; },
    };
    for (const h of hooks) { try { h.fn(sim, m.dt); } catch (e) {} }
    const patches = [];
    for (const f of fields.values()) patches.push({ id: f.id, transform: f.transform });
    self.postMessage({ type: 'result', worldData: wd, fieldPatches: patches });
  }
};
`

// ─────────────────────────────────────────────────────────────────── the Room
class Room {
  constructor(world, snapshot, roomName) {
    this.world = world
    this.roomName = roomName || 'main'
    this.snapshot = snapshot                       // { fields, stepHooks, worldData, ... }
    this.worldData = { ...(snapshot.worldData || {}) }
    // MANIFEST: the game declares its multiplayer type here. Phase-1 defaults.
    this.manifest = this.worldData.mpManifest || { type: 'shared', capacity: 8, roles: ['player'] }
    this.players = new Map()                        // playerId -> { socket, role, input, seat }
    this.tick = 0
    this.worker = new Worker(new URL('data:application/javascript,' + encodeURIComponent(WORKER_SRC)), { type: 'module' })
    this.ready = false
    this.worker.onmessage = (e) => {
      if (e.data.type === 'ready') this.ready = true
      else if (e.data.type === 'result') { this.busy = false; this._broadcastState(e.data) }
    }
    this.worker.postMessage({ type: 'load', hooks: (snapshot.stepHooks || []).map(h => ({ id: h.id, code: h.code })) })
    // MULTIPLAYER HOT-EDIT (Galen: "people play as the game world expands"):
    // the room re-reads the world every few seconds; when the HOOKS changed
    // (a builder pushed), they hot-swap into the running worker — the room's
    // live worldData (scores, positions, __trig latches) is UNTOUCHED, so the
    // crew keeps playing while the world's code grows around them. Visuals
    // hot-swap client-side already (the tabs' own rev watcher).
    this._hooksSig = JSON.stringify((snapshot.stepHooks || []).map(h => [h.id, h.code]))
    this._hotPoll = setInterval(async () => {
      try {
        const fresh = await loadWorld(this.world)
        const sig = JSON.stringify((fresh.stepHooks || []).map(h => [h.id, h.code]))
        if (sig !== this._hooksSig) {
          this._hooksSig = sig
          this.snapshot.stepHooks = fresh.stepHooks
          // fields too: a new field (a new layer/body) should exist server-side
          if (Array.isArray(fresh.fields)) {
            const have = new Set((this.snapshot.fields || []).map(f => f.id))
            for (const f of fresh.fields) if (!have.has(f.id)) (this.snapshot.fields ||= []).push(f)
          }
          this.worker.postMessage({ type: 'load', hooks: (fresh.stepHooks || []).map(h => ({ id: h.id, code: h.code })) })
          console.log('[arena] hot-swapped hooks into live room', this.world + '/' + this.roomName)
        }
      } catch (e) { /* transient read failures never kill a room */ }
    }, 4000)
    // drift-corrected tick: setInterval drifts under load (measured ~16Hz vs the
    // 24 target) — a deadline chain re-anchors every tick. busy-guard: never
    // queue a second tick while the worker still owes a result (no pile-up).
    this.dead = false
    this.busy = false
    this.nextAt = performance.now() + TICK_MS
    const loop = () => {
      if (this.dead) return
      this._tick()
      this.nextAt += TICK_MS
      if (this.nextAt < performance.now() - TICK_MS * 4) this.nextAt = performance.now() + TICK_MS   // fell far behind — re-anchor
      this.loop = setTimeout(loop, Math.max(0, this.nextAt - performance.now()))
    }
    this.loop = setTimeout(loop, TICK_MS)
  }

  full() { return this.players.size >= (this.manifest.capacity || 8) }

  join(socket, role) {
    const id = 'p' + (crypto.randomUUID().slice(0, 8))
    const seat = this.players.size                  // seat index → the manifest maps input→slots by seat
    this.players.set(id, { socket, role: role || this.manifest.roles?.[0] || 'player', input: {}, seat })
    socket.send(JSON.stringify({ type: 'joined', playerId: id, seat, role, snapshot: this.snapshot, manifest: this.manifest }))
    return id
  }

  leave(id) {
    this.players.delete(id)
    if (this.players.size === 0) { clearInterval(this.loop); clearInterval(this._hotPoll); this.worker.terminate(); rooms.delete(this.world + '\u0000' + this.roomName) }
  }

  setInput(id, input) { const p = this.players.get(id); if (p) p.input = input }

  _tick() {
    if (!this.ready) return
    this.tick++
    // BRIDGE: place every player's afferent frame into the shared whiteboard.
    // wd.players extends the existing presence model (positions) to full input
    // frames. The manifest's input→slot map (Phase 2) can also fan specific
    // inputs to specific uniform slots for asymmetric/versus layouts.
    this.worldData.players = [...this.players.values()].map(p => ({ seat: p.seat, role: p.role, ...p.input }))
    this.worldData.playerCount = this.players.size
    this.worker.postMessage({ type: 'tick', dt: TICK_MS / 1000, worldData: this.worldData, fields: this.snapshot.fields || [] })
  }

  _broadcastState(result) {
    this.worldData = result.worldData
    // apply moved transforms back onto the snapshot so they persist across ticks
    if (result.fieldPatches) for (const patch of result.fieldPatches) {
      const f = (this.snapshot.fields || []).find(x => x.id === patch.id); if (f) f.transform = patch.transform
    }
    // FAN-OUT: Phase-1 sends the full whiteboard to everyone. Phase-2 filters
    // per player from manifest.fanout (cull distant entities for .io, hide the
    // opponent's hand for hidden-info games, etc.).
    const msg = JSON.stringify({ type: 'state', tick: this.tick, worldData: this.worldData, fieldPatches: result.fieldPatches })
    for (const p of this.players.values()) { try { p.socket.send(msg) } catch (e) {} }
    // one-shots are CONSUMED here: locally the client deletes __play_sound after
    // playing, but the authoritative worldData would rebroadcast it forever —
    // every client would re-fire the same gloop every tick. Sent once, then gone.
    delete this.worldData.__play_sound
    delete this.worldData.__play_music
  }
}

const rooms = new Map()      // Phase-1 matchmaking: one room per world slug. Phase-2: N rooms + capacity spawn.
const creating = new Map()   // slug -> in-flight creation promise (race guard: two simultaneous first-joiners share ONE room)

async function loadWorld(slug) {
  // pull the world's authoritative snapshot from the bridge (fields+hooks+worldData):
  // ADMIN + ?slug= path — ARENA_SECRET is an admin token on the cafe side.
  const r = await fetch(BRIDGE + '?slug=' + encodeURIComponent(slug), { headers: { Authorization: `Bearer ${SECRET}` }, method: 'GET' })
  if (!r.ok) throw new Error('world load ' + r.status)
  const snap = await r.json()
  if (!Array.isArray(snap.stepHooks)) throw new Error('world "' + slug + '" has no hooks — nothing to be authoritative about')
  return snap
}

async function getRoom(slug, roomName) {
  const rk = slug + '\u0000' + (roomName || 'main')
  const existing = rooms.get(rk)
  if (existing && !existing.full()) return existing   // Phase-2: if full, spawn slug#2…
  if (!creating.has(rk)) {
    // reserve the slot SYNCHRONOUSLY before awaiting loadWorld, so a second
    // joiner arriving mid-load finds this promise instead of making a rival room
    creating.set(rk, (async () => {
      try { const snapshot = await loadWorld(slug); const room = new Room(slug, snapshot, roomName); rooms.set(rk, room); return room }
      finally { creating.delete(rk) }
    })())
  }
  return await creating.get(rk)
}

async function matchmake(slug, socket, role, roomName) {
  const room = await getRoom(slug, roomName)
  return { room, id: room.join(socket, role) }
}

Deno.serve({ port: Number(Deno.env.get('PORT')) || 8080 }, (req) => {
  const url = new URL(req.url)
  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) return new Response('ok')
  if (req.method === 'GET' && url.pathname === '/rooms') {
    const w = url.searchParams.get('world')
    const list = []
    for (const r of rooms.values()) {
      if (w && r.world !== w) continue
      list.push({ world: r.world, room: r.roomName, players: r.players.size, capacity: r.manifest.capacity || 8, started: !!(r.worldData && r.worldData.__started) })
    }
    return new Response(JSON.stringify({ rooms: list }), { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } })
  }
  if (url.pathname !== '/join') return new Response('not found', { status: 404 })
  if (req.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })

  const slug = url.searchParams.get('world')
  const role = url.searchParams.get('role') || undefined
  const roomName = (url.searchParams.get('room') || 'main').slice(0, 32)
  if (!slug) return new Response('world required', { status: 400 })

  const { socket, response } = Deno.upgradeWebSocket(req)
  let playerId = null, room = null
  socket.onopen = async () => {
    try { const m = await matchmake(slug, socket, role, roomName); room = m.room; playerId = m.id }
    catch (e) { socket.send(JSON.stringify({ type: 'error', error: String(e?.message || e) })); socket.close() }
  }
  socket.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data) } catch { return }
    if (m.type === 'input' && room && playerId) room.setInput(playerId, m.input || {})
  }
  socket.onclose = () => { if (room && playerId) room.leave(playerId) }
  return response
})

console.log('[arena] authoritative multiplayer up on :' + (Deno.env.get('PORT') || 8080) + ' @ ' + TICK_HZ + 'Hz')
