import { describe, it, expect } from 'vitest'
import { InputRuntime } from '@/app/engine/input-runtime'

// Item 1 of the reliability program — the ordered input queue that makes every
// press/release reach the simulation exactly once, including taps entirely between
// ticks. The plan's four acceptance tests are here, plus the cases the queue (vs.
// the old level-sampling) exists to get right: release-pairing, multi-touch,
// auto-repeat, and legacy-adapter compatibility.

const wd = () => ({} as Record<string, unknown>)

describe('InputRuntime — acceptance tests', () => {
  it('(a) a press+release entirely between two ticks produces exactly one action', () => {
    const ir = new InputRuntime()
    const w = wd()
    ir.drain(w) // tick 0
    // between ticks: tap space (down then up, no drain in between)
    ir.push(w, 'key_space', 'down')
    ir.push(w, 'key_space', 'up')
    const f1 = ir.drain(w) // tick 1
    expect(f1.pressed.space).toBe(true)
    expect(f1.released.space).toBe(true) // the full tap: both edges land
    expect(f1.action).toBe(true)
    const f2 = ir.drain(w) // tick 2 — the tap does not linger
    expect(f2.pressed.space ?? false).toBe(false)
    expect(f2.action).toBe(false)
  })

  it('(b) holding a flipper stays held without repeated press events', () => {
    const ir = new InputRuntime()
    const w = wd()
    ir.push(w, 'key_left', 'down')
    const f1 = ir.drain(w)
    expect(f1.pressed.left).toBe(true)
    expect(f1.held.left).toBe(true)
    // held across many ticks, with OS auto-repeat keydowns arriving:
    ir.push(w, 'key_left', 'down', { repeat: true })
    const f2 = ir.drain(w)
    expect(f2.held.left).toBe(true)
    expect(f2.pressed.left ?? false).toBe(false) // no re-fire while held
    const f3 = ir.drain(w)
    expect(f3.held.left).toBe(true)
    expect(f3.pressed.left ?? false).toBe(false)
  })

  it('(c) two touch pointers operate both flippers independently', () => {
    const ir = new InputRuntime()
    const w = wd()
    ir.push(w, 'key_left', 'down')  // left thumb → left flipper
    ir.push(w, 'key_right', 'down') // right thumb → right flipper
    const f1 = ir.drain(w)
    expect(f1.held.left).toBe(true)
    expect(f1.held.right).toBe(true)
    ir.push(w, 'key_left', 'up')    // release left only
    const f2 = ir.drain(w)
    expect(f2.held.left ?? false).toBe(false)
    expect(f2.released.left).toBe(true)
    expect(f2.held.right).toBe(true) // right stays held
  })

  it('(d) focus loss cannot leave a flipper stuck', () => {
    const ir = new InputRuntime()
    const w = wd()
    ir.push(w, 'key_left', 'down')
    ir.drain(w)
    ir.clearHeld(w) // window blur
    const f = ir.drain(w)
    expect(f.held.left ?? false).toBe(false)
    expect(f.released.left).toBe(true)
    expect(w['key_left']).toBe(false) // legacy adapter cleared too
  })
})

describe('InputRuntime — queue correctness the old level-sampling lost', () => {
  it('two taps in one tick gap both register (pressed once per drain, count == 2)', () => {
    const ir = new InputRuntime()
    const w = wd()
    ir.push(w, 'key_space', 'down'); ir.push(w, 'key_space', 'up')
    ir.push(w, 'key_space', 'down'); ir.push(w, 'key_space', 'up')
    const f = ir.drain(w)
    expect(f.pressed.space).toBe(true)
    expect(w['key_space_n']).toBe(2) // both taps counted in the legacy pulse
  })

  it('pointer tap between ticks fires pointer.pressed once', () => {
    const ir = new InputRuntime()
    const w = wd()
    ir.drain(w)
    ir.push(w, 'mouse_down', 'down')
    ir.push(w, 'mouse_down', 'up')
    const f = ir.drain(w)
    expect(f.pointer.pressed).toBe(true)
    expect(f.pointer.released).toBe(true)
    expect(f.pointer.down).toBe(false)
  })

  it('a code is a latch — any up releases it (matches the legacy engine)', () => {
    // Two DIFFERENT controls stay independent (that is what two flippers need);
    // the same code is a single latch, released by the first up — exactly the old
    // behavior (mouse_down had three force-clear paths; a touch key: released on
    // the first pointer up). This is what keeps the queue in sync with the
    // force-clear code paths in FieldEngine.
    const ir = new InputRuntime()
    const w = wd()
    ir.push(w, 'mouse_down', 'down')
    ir.push(w, 'mouse_down', 'down') // second finger, same latch
    ir.drain(w)
    ir.push(w, 'mouse_down', 'up')   // any up clears the latch
    expect(ir.drain(w).pointer.down).toBe(false)
    expect(w['mouse_down']).toBe(false)
  })

  it('moveX/moveY and action derive from held/edges like the legacy input object', () => {
    const ir = new InputRuntime()
    const w = wd()
    ir.push(w, 'key_right', 'down')
    ir.push(w, 'key_up', 'down')
    const f = ir.drain(w)
    expect(f.moveX).toBe(1)
    expect(f.moveY).toBe(1)
    expect(f.actionHeld).toBe(false)
  })

  it('R is withheld from held/pressed while the reset system is armed', () => {
    const ir = new InputRuntime()
    const w = wd()
    w['rResetKey'] = true
    ir.push(w, 'key_r', 'down')
    const f = ir.drain(w)
    expect(f.held.r ?? false).toBe(false)
    expect(f.pressed.r ?? false).toBe(false)
  })

  it('legacy adapters: push writes wd.key_x boolean and monotonic wd.key_x_n', () => {
    const ir = new InputRuntime()
    const w = wd()
    ir.push(w, 'key_space', 'down')
    expect(w['key_space']).toBe(true)
    expect(w['key_space_n']).toBe(1)
    ir.push(w, 'key_space', 'up')
    expect(w['key_space']).toBe(false)
    expect(w['key_space_n']).toBe(1) // count doesn't change on release
  })

  it('look deltas are consumed (zeroed) each drain', () => {
    const ir = new InputRuntime()
    const w = wd()
    w['mouse_dx'] = 12; w['mouse_dy'] = -3
    const f = ir.drain(w)
    expect(f.lookX).toBe(12)
    expect(f.lookY).toBe(-3)
    expect(w['mouse_dx']).toBe(0)
    expect(w['mouse_dy']).toBe(0)
  })
})
