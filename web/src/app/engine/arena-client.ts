// arena-client — the tab as a WINDOW onto an authoritative room, not a world.
//
// When a world carries worldData.mpManifest, FieldEngine stops running the
// hooks locally: this client ships the player's afferent frame to the arena
// (~24Hz) and hands back the room's broadcast worldData, which the render/audio
// loops consume exactly as if a local hook had written it.
//
// SMOOTHNESS: raw server states at ~20Hz rendered directly look like a slide
// show (positions freeze for frames, then jump). So the client renders ~80ms in
// the PAST and lerps gpuPopulation/gpuUniforms between the last two states —
// continuous motion at any tick rate. Non-numeric state (hud, sounds, __io)
// snaps on arrival. When array lengths differ (an eat/split changed the entity
// set) we snap that boundary — a few frames a second at worst.
//
// FAIRNESS: every input frame carries {seq, t}. Discrete actions must never be
// lost to sampling ("latest input wins" drops a tap under lag) — so taps are
// LATCHED into counters (see FieldEngine: split_n) and the server acts on the
// counter change whenever it arrives. Late ≠ lost.
export type ArenaJoined = { playerId: string; seat: number; role?: string; manifest?: Record<string, unknown> }
export type ArenaState = { tick: number; worldData: Record<string, unknown>; fieldPatches?: { id: string; transform: unknown }[] }
type Keyframe = { t: number; pop: number[] | null; uni: number[] | null }

const INTERP_MS = 80

export class ArenaClient {
  private ws: WebSocket | null = null
  private closed = false
  private lastSent = 0
  private seq = 0
  private prev: Keyframe | null = null
  private next: Keyframe | null = null
  seat = -1
  playerId = ''
  latest: ArenaState | null = null
  /** client-side action latches (FieldEngine increments on key edges) */
  splitN = 0
  prevSpace = false

  urlOverride?: string
  connect(slug: string, room = 'main', onJoined?: (j: ArenaJoined) => void, urlOverride?: string): void {
    // a world may name its OWN arena (worldData.arenaUrl → dev/local/self-hosted
    // rooms); otherwise the platform's Railway service is the house arena.
    // The override PERSISTS on the instance — a reconnect after a room hiccup
    // must rejoin the SAME arena, not fall back to the house one.
    if (urlOverride) this.urlOverride = urlOverride
    const base = (this.urlOverride || process.env.NEXT_PUBLIC_ARENA_URL || 'wss://arena-production-b574.up.railway.app').replace(/^http/, 'ws')
    let ws: WebSocket
    try { ws = new WebSocket(base + '/join?world=' + encodeURIComponent(slug) + '&room=' + encodeURIComponent(room)) } catch { return }
    this.ws = ws
    ws.onmessage = (ev) => {
      let m: { type?: string } & ArenaJoined & ArenaState
      try { m = JSON.parse(ev.data as string) } catch { return }
      if (m.type === 'joined') { this.playerId = m.playerId; this.seat = m.seat; onJoined?.(m) }
      else if (m.type === 'state') {
        this.latest = m
        const wd = (m.worldData || {}) as Record<string, unknown>
        this.prev = this.next
        this.next = {
          t: performance.now(),
          pop: Array.isArray(wd['gpuPopulation']) ? (wd['gpuPopulation'] as number[]) : null,
          uni: Array.isArray(wd['gpuUniforms']) ? (wd['gpuUniforms'] as number[]) : null,
        }
      }
    }
    // the room may hiccup (redeploy, idle-kill) — quietly rejoin the same world
    ws.onclose = () => { if (!this.closed) setTimeout(() => { if (!this.closed) this.connect(slug, room, onJoined) }, 1500) }
  }

  /** the interpolated view for THIS render frame (null until two states exist) */
  frame(now: number): { pop: number[] | null; uni: number[] | null } | null {
    const nx = this.next
    if (!nx) return null
    const pv = this.prev
    const lerpable = (a: number[] | null, b: number[] | null) => !!a && !!b && a.length === b.length
    if (!pv || (!lerpable(pv.pop, nx.pop) && !lerpable(pv.uni, nx.uni))) return { pop: nx.pop, uni: nx.uni }
    const span = Math.max(1, nx.t - pv.t)
    const k = Math.min(1.15, Math.max(0, (now - INTERP_MS - pv.t) / span))   // slight extrapolation allowed
    const mix = (a: number[] | null, b: number[] | null): number[] | null => {
      if (!a || !b || a.length !== b.length) return b
      const out = new Array<number>(b.length)
      for (let i = 0; i < b.length; i++) out[i] = a[i] + (b[i] - a[i]) * k
      return out
    }
    return { pop: mix(pv.pop, nx.pop), uni: mix(pv.uni, nx.uni) }
  }

  /** ship the afferent frame; sequenced + timestamped, capped to server rate */
  sendInput(input: Record<string, unknown>): void {
    const now = Date.now()
    if (now - this.lastSent < 40) return
    this.lastSent = now
    this.seq++
    try { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'input', input: { ...input, seq: this.seq, t: now } })) } catch { /* drop the frame */ }
  }

  close(): void { this.closed = true; try { this.ws?.close() } catch { /* noop */ } this.ws = null }
}

/** the SERVER FINDER's data: live rooms for a world (lobby screens poll this) */
export async function fetchArenaRooms(slug: string): Promise<{ room: string; players: number; capacity: number; started: boolean }[]> {
  const base = (process.env.NEXT_PUBLIC_ARENA_URL || 'wss://arena-production-b574.up.railway.app').replace(/^ws/, 'http')
  try {
    const r = await fetch(base + '/rooms?world=' + encodeURIComponent(slug))
    const j = await r.json()
    return Array.isArray(j.rooms) ? j.rooms : []
  } catch { return [] }
}
