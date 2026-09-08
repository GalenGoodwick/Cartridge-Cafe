// InputRuntime — the engine's single ordered source of truth for discrete input.
//
// THE BUG THIS EXISTS TO KILL ("missed tap"): input used to be sampled as LEVEL
// state (a held boolean) at tick time, so a press+release that completed entirely
// between two simulation ticks read `false` and produced no edge — the action was
// lost. Here, every key/button transition is pushed onto an ORDERED QUEUE the
// instant it happens; the queue is drained once per delivered tick, so a full tap
// between ticks still yields exactly one press (and its release). Held/pressed/
// released/action are all derived from the queue + a held set, never from a
// stale level sample.
//
// Discrete transitions (key down/up, pointer-button down/up, touch buttons) flow
// through push()/drain(). Analog/sampled state (pointer x/y, look deltas) is NOT
// events — capture sites still write those straight to worldData and drain() reads
// them there.
//
// Legacy `key_<x>` (held boolean) and `key_<x>_n` (monotonic pulse count) remain
// on worldData as COMPATIBILITY ADAPTERS — push() writes them exactly as the old
// scattered capture code did, so every hook that reads raw `key_*`/`_n` (and the
// main-thread hook path, and cloneable's cross-thread copy) keeps working
// unchanged. The queue is the new primary; the legacy fields are derived from it.

export type InputPhase = 'down' | 'up'

/** The per-tick input object handed to hooks as `wd.input`. Shape is byte-compatible
 *  with the previous WorldSandbox.buildInput output — do not reorder/rename. */
export interface InputFrame {
  held: Record<string, boolean>
  pressed: Record<string, boolean>
  released: Record<string, boolean>
  moveX: number
  moveY: number
  action: boolean
  actionHeld: boolean
  pointer: { x: number; y: number; down: boolean; pressed: boolean; released: boolean }
  lookX: number
  lookY: number
}

type WD = Record<string, unknown>

/** The pointer-button codes live in the same namespace as keys but are surfaced
 *  through `input.pointer`, not `input.held`. */
const POINTER_CODE = 'mouse_down'

export class InputRuntime {
  /** Ordered transitions since the last drain — the lossless record of what happened. */
  private queue: { code: string; phase: InputPhase }[] = []
  /** Codes currently held (full worldData field names, e.g. 'key_left', 'mouse_down').
   *  A LATCH per code: down adds, up removes. This matches the legacy engine exactly
   *  — a mouse button is a single latch cleared by any up (it had three force-clear
   *  paths), and even a touch `key:` control released on the first pointer's up. Two
   *  DIFFERENT controls (two flippers = two codes) stay independent, which is what
   *  multi-touch actually needs. Idempotent delete also survives the force-clears. */
  private held = new Set<string>()
  /** Monotonic per-code down-count = the legacy `_n` pulse value. */
  private counts: Record<string, number> = {}

  /** A key/button transition. `code` is the full worldData field name ('key_left',
   *  'mouse_down', 'mouse_down_right', or a declared touch `key:<x>` → 'key_<x>').
   *  `opts.repeat` marks an OS auto-repeat keydown: it keeps the key held and bumps
   *  the legacy pulse (old behavior) but emits NO new press edge. Writes the legacy
   *  `wd[code]` / `wd[code+'_n']` adapters so raw readers stay correct between drains. */
  push(wd: WD, code: string, phase: InputPhase, opts?: { repeat?: boolean }): void {
    if (phase === 'down') {
      this.counts[code] = (this.counts[code] || 0) + 1
      wd[code] = true
      wd[code + '_n'] = this.counts[code]
      this.held.add(code)
      if (opts?.repeat) return // auto-repeat: held stays, but no new press edge
      this.queue.push({ code, phase: 'down' })
    } else {
      this.held.delete(code)
      wd[code] = false
      this.queue.push({ code, phase: 'up' })
    }
  }

  /** Release everything currently held (window blur / pointer cancel / disconnect):
   *  enqueue an up for each held code so `released` still fires, then clear held so
   *  no flipper can stick. Counts (legacy `_n`) stay monotonic — this is not a reset. */
  clearHeld(wd: WD): void {
    for (const code of this.held) {
      this.queue.push({ code, phase: 'up' })
      wd[code] = false
    }
    this.held.clear()
  }

  /** Full reset on world switch/restore — queue, held, AND the monotonic counts (a
   *  new world starts its pulse counters from zero). Callers already wipe the
   *  `key_*`/`mouse_*` fields off worldData separately. */
  reset(): void {
    this.queue.length = 0
    this.held.clear()
    this.counts = {}
  }

  /** Drain the queue into one InputFrame. Edges come from the ordered events (a full
   *  tap in one drain yields BOTH pressed and released); held/analog from live state.
   *  `wd` supplies sampled pointer position, look deltas (consumed→zeroed), and the
   *  reset-armed flag (R belongs to the reset system while armed). */
  drain(wd: WD): InputFrame {
    const rArmed = !!wd['rResetKey']
    const pressed: Record<string, boolean> = {}
    const released: Record<string, boolean> = {}
    let ptrPressed = false
    let ptrReleased = false
    for (const e of this.queue) {
      if (e.code === POINTER_CODE) {
        if (e.phase === 'down') ptrPressed = true
        else ptrReleased = true
        continue
      }
      if (!e.code.startsWith('key_')) continue
      const name = e.code.slice(4)
      if (name === 'r' && rArmed) continue // reset owns R while armed
      if (e.phase === 'down') pressed[name] = true
      else released[name] = true
    }
    this.queue.length = 0

    const held: Record<string, boolean> = {}
    for (const code of this.held) {
      if (!code.startsWith('key_')) continue
      const name = code.slice(4)
      if (name === 'r' && rArmed) continue
      held[name] = true
    }
    const on = (n: string) => !!held[n]
    const moveX = (on('d') || on('right') ? 1 : 0) - (on('a') || on('left') ? 1 : 0)
    const moveY = (on('w') || on('up') ? 1 : 0) - (on('s') || on('down') ? 1 : 0)
    // Pointer `.down` is the live LEVEL (the move handler re-asserts wd.mouse_down
    // every frame — a still press stays visible), matching the legacy buildInput.
    // `.pressed`/`.released` are the lossless EDGES from the queue above.
    const pdown = !!wd[POINTER_CODE]
    const pointer = {
      x: (wd['mouse_x'] as number) ?? 0,
      y: (wd['mouse_y'] as number) ?? 0,
      down: pdown,
      pressed: ptrPressed,
      released: ptrReleased,
    }
    const lookX = (wd['mouse_dx'] as number) || 0
    const lookY = (wd['mouse_dy'] as number) || 0
    wd['mouse_dx'] = 0
    wd['mouse_dy'] = 0
    return {
      held,
      pressed,
      released,
      moveX,
      moveY,
      action: !!pressed['space'] || !!pressed['enter'],
      actionHeld: on('space') || on('enter'),
      pointer,
      lookX,
      lookY,
    }
  }
}
