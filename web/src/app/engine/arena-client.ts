// arena-client — the tab as a WINDOW onto an authoritative room, not a world.
//
// When a world carries worldData.mpManifest, FieldEngine stops running the
// hooks locally: this client ships the player's afferent frame to the arena
// (~24Hz) and hands back the room's broadcast worldData, which the render/audio
// loops consume exactly as if a local hook had written it. The world file stays
// one file; the arena runs its hook as the one authority (arena-service).
export type ArenaJoined = { playerId: string; seat: number; role?: string; manifest?: Record<string, unknown> }
export type ArenaState = { tick: number; worldData: Record<string, unknown>; fieldPatches?: { id: string; transform: unknown }[] }

export class ArenaClient {
  private ws: WebSocket | null = null
  private closed = false
  private lastSent = 0
  seat = -1
  playerId = ''
  latest: ArenaState | null = null

  connect(slug: string, onJoined?: (j: ArenaJoined) => void): void {
    const base = (process.env.NEXT_PUBLIC_ARENA_URL || 'wss://arena-production-b574.up.railway.app').replace(/^http/, 'ws')
    let ws: WebSocket
    try { ws = new WebSocket(base + '/join?world=' + encodeURIComponent(slug)) } catch { return }
    this.ws = ws
    ws.onmessage = (ev) => {
      let m: { type?: string } & ArenaJoined & ArenaState
      try { m = JSON.parse(ev.data as string) } catch { return }
      if (m.type === 'joined') { this.playerId = m.playerId; this.seat = m.seat; onJoined?.(m) }
      else if (m.type === 'state') this.latest = m
    }
    // the room may hiccup (redeploy, idle-kill) — quietly rejoin the same world
    ws.onclose = () => { if (!this.closed) setTimeout(() => { if (!this.closed) this.connect(slug, onJoined) }, 1500) }
  }

  /** ship the afferent frame; internally capped to the server's tick rate */
  sendInput(input: Record<string, unknown>): void {
    const now = Date.now()
    if (now - this.lastSent < 40) return
    this.lastSent = now
    try { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'input', input })) } catch { /* drop the frame */ }
  }

  close(): void { this.closed = true; try { this.ws?.close() } catch { /* noop */ } this.ws = null }
}
