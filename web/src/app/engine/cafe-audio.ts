// cafe-audio — the cafe's ears. Everything is synthesized; no files, so worlds
// stay single-file. Two layers:
//
//   AMBIENT: a drone that listens to the screen. FieldEngine samples the
//   rendered frame (~2Hz) and dispatches `cafe:mood` {bright, warm, busy};
//   brightness opens the filter, warmth picks the third, busy-ness feeds the
//   noise bed. Each world seeds its own root note (preset or name-hash).
//
//   INTERACTION: pointer, keys, portals, captions, pause — every meaningful
//   event the shell already speaks becomes a small sound. Worlds get audio
//   for free; they never have to know it exists.
//
// Mute persists (localStorage cc-mute). The context resumes on first gesture,
// per autoplay policy.

let ctx: AudioContext | null = null
let master: GainNode | null = null       // the SHELL sfx bus (clicks/hover/portal), kept quiet
let worldGain: GainNode | null = null    // the WORLD music/sfx bus (GameAudio routes into this)
let ambGain: GainNode | null = null
let oscRoot: OscillatorNode | null = null
let oscFifth: OscillatorNode | null = null
let oscThird: OscillatorNode | null = null
let thirdGain: GainNode | null = null
let lowpass: BiquadFilterNode | null = null
let noiseGain: GainNode | null = null
let noiseBand: BiquadFilterNode | null = null
let muted = false
let started = false
let currentScene = ''
let pointerDownAt = 0
let lastKeyAt = 0
let ambDuck = 0   // starts silent; entering a world raises it

// worlds with a voice of their own; anything else hashes to a pentatonic root
const ROOTS: Record<string, number> = {
  CAFE: 110.0, HELIOS: 130.8, SELENE: 73.4, SIGNAL: 98.0, 'ONE DAY': 87.3,
  SAIL: 116.5, ORRERY: 65.4, GARNET: 146.8, FABRIC: 82.4, SOLSTICE: 123.5,
}
const PENTA = [65.4, 73.4, 82.4, 98.0, 110.0, 130.8, 146.8]

function rootFor(scene: string): number {
  if (ROOTS[scene]) return ROOTS[scene]
  let h = 2166136261
  for (const c of scene) { h ^= c.charCodeAt(0); h = (h * 16777619) >>> 0 }
  return PENTA[h % PENTA.length]
}

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = muted ? 0 : 0.14
    master.connect(ctx.destination)
    // the ONE world bus: every world's GameAudio connects its own master into
    // this, so shell sfx and world music share a single AudioContext and a
    // single mute. Unity gain — worlds set their own levels; mute lives here.
    worldGain = ctx.createGain()
    worldGain.gain.value = muted ? 0 : 1
    worldGain.connect(ctx.destination)
    buildAmbient()
  }
  return ctx
}

/** The single shared context + the node world audio should connect into.
 *  GameAudio.attach() uses this so there is only ever ONE AudioContext. */
export function worldBus(): { ctx: AudioContext; dest: AudioNode } | null {
  const c = ensureCtx()
  if (!c || !worldGain) return null
  return { ctx: c, dest: worldGain }
}

/** RECORD TAP — a MediaStream carrying EVERYTHING that plays (world music +
 *  shell sfx), for muxing into a canvas recording. Taps both top-level buses
 *  (master, worldGain) that feed ctx.destination, so nothing audible is missed.
 *  Non-destructive: the tap runs in parallel with the speakers; call stop() to
 *  detach. Returns null if there's no audio device/context yet. */
export function recordTap(): { stream: MediaStream; stop: () => void } | null {
  const c = ensureCtx()
  if (!c || !master || !worldGain) return null
  if (c.state === 'suspended') { c.resume().catch(() => {}) }
  const dest = c.createMediaStreamDestination()
  master.connect(dest)
  worldGain.connect(dest)
  return {
    stream: dest.stream,
    stop: () => { try { master?.disconnect(dest) } catch { /* noop */ } try { worldGain?.disconnect(dest) } catch { /* noop */ } },
  }
}

// ── WORLD VOICE — sound AS the physics. An organic WATER voice any world's hook
//    can drive per-frame: wd.tone = { flow, cutoff, bubble, dripRate, pitch, gain }.
//    Modelled on real water (spectrograms of a waterfall + dripping): a brown-noise
//    body + wandering resonant peaks (burble) + a granular swarm of tiny bubble
//    chirps (the organic texture) + big droplet accents. Additive & isolated from
//    the music path (feeds worldGain → captured by recordTap, muted with the world),
//    so no other world can break. NOT a theremin. ──
export type WorldTone = { flow?: number; cutoff?: number; bubble?: number; dripRate?: number; pitch?: number; gain?: number }
let vInit = false
let vCtx: AudioContext | null = null
let vOut: GainNode | null = null, vFlowG: GainNode | null = null, vLp: BiquadFilterNode | null = null
let vRes: { bp: BiquadFilterNode; g: GainNode; f: number }[] = []
let vBrown: AudioBuffer | null = null, vClick: AudioBuffer | null = null
const vBase = { flow: 0, cutoff: 1600, bubble: 0, dripRate: 0, pitch: 820, gain: 0 }
const vClamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

function brownNoise(c: AudioContext, sec: number): AudioBuffer {
  const n = (c.sampleRate * sec) | 0, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0)
  let l = 0, mx = 1e-6
  for (let i = 0; i < n; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l; if (Math.abs(l) > mx) mx = Math.abs(l) }
  for (let i = 0; i < n; i++) d[i] = d[i] / mx * 0.9
  return b
}
function vBubble(c: AudioContext) {   // one tiny organic bubble chirp
  if (!vOut) return
  const f = 500 + Math.random() * 1500, t0 = c.currentTime
  const o = c.createOscillator(); o.type = 'sine'
  o.frequency.setValueAtTime(f * 0.82, t0); o.frequency.exponentialRampToValueAtTime(f * 1.22, t0 + 0.015 + Math.random() * 0.025)
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.02 + Math.random() * 0.03, t0 + 0.003); g.gain.exponentialRampToValueAtTime(0.0003, t0 + 0.02 + Math.random() * 0.03)
  o.connect(g); g.connect(vOut); o.start(t0); o.stop(t0 + 0.08)
}
function vDrip(c: AudioContext) {     // a big droplet accent
  if (!vOut) return
  const f = vBase.pitch * (0.7 + Math.random() * 0.7), t0 = c.currentTime
  const o = c.createOscillator(); o.type = 'sine'
  o.frequency.setValueAtTime(f * 0.6, t0); o.frequency.exponentialRampToValueAtTime(f * 1.7, t0 + 0.05 + Math.random() * 0.04)
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 1.3; bp.Q.value = 5
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0004, t0 + 0.14 + Math.random() * 0.08)
  o.connect(bp); bp.connect(g); g.connect(vOut); o.start(t0); o.stop(t0 + 0.26)
}
function vTurb() {                     // slow turbulent wander of the flow body
  const c = vCtx; if (!c || !vFlowG || !vLp) return
  const t = c.currentTime, j = () => 0.7 + Math.random() * 0.6
  vFlowG.gain.setTargetAtTime(vBase.flow * 0.13 * j(), t, 0.15)
  vLp.frequency.setTargetAtTime(vClamp(vBase.cutoff * (0.85 + Math.random() * 0.3), 120, 12000), t, 0.18)
  vRes.forEach(r => { r.g.gain.setTargetAtTime(vBase.flow * 0.05 * j(), t, 0.2); r.bp.frequency.setTargetAtTime(r.f * (0.8 + Math.random() * 0.4), t, 0.25) })
  setTimeout(vTurb, 90 + Math.random() * 90)
}
function vBubbleTick() {
  const c = vCtx; if (!c) return
  if (vBase.bubble > 0 && !muted) vBubble(c)
  const r = Math.max(0.5, vBase.bubble * 55)
  setTimeout(vBubbleTick, (1 / r) * (0.4 + Math.random() * 1.2) * 1000)
}
function vDripTick() {
  const c = vCtx; if (!c) return
  if (vBase.dripRate > 0 && !muted) vDrip(c)
  const r = Math.max(0.05, vBase.dripRate)
  setTimeout(vDripTick, (1 / r) * (0.6 + Math.random() * 0.9) * 1000)
}
function initVoice(c: AudioContext, dest: AudioNode) {
  vCtx = c; vBrown = brownNoise(c, 3); vClick = brownNoise(c, 0.05); void vClick
  vOut = c.createGain(); vOut.gain.value = 0.9; vOut.connect(dest)
  const flow = c.createBufferSource(); flow.buffer = vBrown; flow.loop = true
  vLp = c.createBiquadFilter(); vLp.type = 'lowpass'; vLp.frequency.value = 1600; vLp.Q.value = 0.4
  vFlowG = c.createGain(); vFlowG.gain.value = 0; flow.connect(vLp); vLp.connect(vFlowG); vFlowG.connect(vOut)
  vRes = [420, 760, 1300].map(f => { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6; const g = c.createGain(); g.gain.value = 0; flow.connect(bp); bp.connect(g); g.connect(vOut!); return { bp, g, f } })
  flow.start()
  vInit = true
  vTurb(); vBubbleTick(); vDripTick()
}
/** Drive the world voice. Pass the per-frame params, or null to fade it out.
 *  null before the voice is ever used is a no-op (never builds nodes). */
export function setWorldVoice(p: WorldTone | null): void {
  const c = ensureCtx(); if (!c || !worldGain) return
  if (!vInit) { if (p == null) return; if (c.state === 'suspended') c.resume().catch(() => {}); initVoice(c, worldGain) }
  if (p == null || muted) { vBase.flow = 0; vBase.bubble = 0; vBase.dripRate = 0; vOut?.gain.setTargetAtTime(0, c.currentTime, 0.12); return }
  vBase.flow = vClamp(p.flow ?? 0, 0, 1)
  vBase.cutoff = vClamp(p.cutoff ?? 1600, 120, 12000)
  vBase.bubble = vClamp(p.bubble ?? 0, 0, 1)
  vBase.dripRate = vClamp(p.dripRate ?? 0, 0, 30)
  vBase.pitch = vClamp(p.pitch ?? 820, 40, 4000)
  vBase.gain = vClamp(p.gain ?? 0.9, 0, 1)
  vOut?.gain.setTargetAtTime(vBase.gain * 0.9, c.currentTime, 0.05)
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  const len = c.sampleRate * 2
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {           // pink-ish: integrated white
    last = last * 0.98 + (Math.random() * 2 - 1) * 0.05
    d[i] = last * 3
  }
  return buf
}

function buildAmbient() {
  // AMBIENT REMOVED (Jul 13): the cafe is quiet, and a world's own audio is
  // the only audio — no drone or noise bed under the main screen or inside
  // worlds. Interaction sfx (plucks, whooshes) still play through `master`.
  // The drone/noise graph used to be built here; oscRoot/ambGain/noiseGain
  // stay null and every consumer already guards for that.
}

// ── one-shot voices ──────────────────────────────────────────────────────────

function pluck(freq: number, dur = 0.18, gain = 0.06, type: OscillatorType = 'sine', when = 0) {
  const c = ensureCtx()
  if (!c || !master || muted) return
  const t0 = c.currentTime + when
  const o = c.createOscillator()
  o.type = type
  o.frequency.value = freq
  const g = c.createGain()
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0004, t0 + dur)
  o.connect(g)
  g.connect(master)
  o.start(t0)
  o.stop(t0 + dur + 0.02)
}

function whoosh(up = true, dur = 0.7, gain = 0.09) {
  const c = ensureCtx()
  if (!c || !master || muted) return
  const t0 = c.currentTime
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 1.4
  bp.frequency.setValueAtTime(up ? 260 : 2200, t0)
  bp.frequency.exponentialRampToValueAtTime(up ? 2400 : 220, t0 + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.35)
  g.gain.exponentialRampToValueAtTime(0.0004, t0 + dur)
  src.connect(bp); bp.connect(g); g.connect(master)
  src.start(t0)
  src.stop(t0 + dur + 0.05)
}

export const sfx = {
  /** portal travel: rising shimmer + arpeggio on the destination's root */
  launch(scene?: string) {
    whoosh(true, 0.8, 0.10)
    const r = rootFor(scene || currentScene) * 2
    pluck(r, 0.4, 0.05, 'triangle', 0.10)
    pluck(r * 1.5, 0.4, 0.045, 'triangle', 0.22)
    pluck(r * 2, 0.55, 0.05, 'triangle', 0.34)
  },
  /** returning home / leaving: the same door, downward */
  leave() {
    whoosh(false, 0.6, 0.07)
    const r = rootFor(currentScene) * 2
    pluck(r * 2, 0.3, 0.04, 'triangle', 0.05)
    pluck(r * 1.5, 0.3, 0.04, 'triangle', 0.15)
    pluck(r, 0.5, 0.045, 'triangle', 0.25)
  },
  achievement() {   // caption kind 'tuned' — something meaningful happened
    const r = rootFor(currentScene) * 4
    pluck(r, 0.5, 0.07, 'sine')
    pluck(r * 1.5, 0.7, 0.06, 'sine', 0.09)
  },
  hint() { pluck(660, 0.12, 0.028, 'sine') },
  hoverTink() { pluck(1320, 0.09, 0.022, 'triangle') },
  pauseIn() { pluck(110, 0.35, 0.07, 'sine'); ambDuck = 0.25; applyDuck() },
  pauseOut() { pluck(220, 0.25, 0.05, 'sine'); ambDuck = 1; applyDuck() },
}

function applyDuck() {
  if (ctx && ambGain) ambGain.gain.setTargetAtTime(0.16 * ambDuck, ctx.currentTime, 0.3)
  if (ctx && noiseGain) noiseGain.gain.setTargetAtTime(currentNoise * ambDuck, ctx.currentTime, 0.3)
}

let currentNoise = 0.008

// ── the shell calls these ────────────────────────────────────────────────────

export function setScene(scene: string) {
  currentScene = scene
  const c = ensureCtx()
  if (!c || !oscRoot || !oscFifth || !oscThird) return
  const r = rootFor(scene)
  const t = c.currentTime
  oscRoot.frequency.setTargetAtTime(r, t, 0.8)
  oscFifth.frequency.setTargetAtTime(r * 1.4983, t, 0.8)
  oscThird.frequency.setTargetAtTime(r * 2.52, t, 0.8)
  // the main page stays quiet — the drone belongs inside worlds
  ambDuck = scene === 'CAFE' ? 0 : 1
  applyDuck()
  // airlock: crossing between worlds, the hum falls near-silent and breathes
  // back in — no sudden ambience appearing the moment you step out
  if (master && !muted) {
    master.gain.setTargetAtTime(0.015, t, 0.15)
    master.gain.setTargetAtTime(0.14, t + 1.4, 1.6)
  }
}

export function isMuted() { return muted }

export function setMuted(m: boolean) {
  muted = m
  try { localStorage.setItem('cc-mute', m ? '1' : '') } catch { /* private mode */ }
  if (ctx && master) master.gain.setTargetAtTime(m ? 0 : 0.14, ctx.currentTime, 0.2)
  // one switch, one context: mute the world bus in the same place as the sfx bus
  if (ctx && worldGain) worldGain.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.2)
  // still emit for any listener that tracks mute UI state (GameAudio no longer
  // needs it for sound — the shared worldGain above already governs its volume)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cafe:muted', { detail: m }))
  }
}

/** Wire every listener once. Safe to call repeatedly. */
export function startCafeAudio(initialScene: string) {
  if (typeof window === 'undefined' || started) { setScene(initialScene); return }
  started = true
  try { muted = !!localStorage.getItem('cc-mute') } catch { /* fine */ }
  currentScene = initialScene

  const resume = () => {
    const c = ensureCtx()
    if (c && c.state === 'suspended') c.resume()
    setScene(currentScene)
  }

  // interactions — each one speaks, softly
  window.addEventListener('pointerdown', e => {
    resume()
    pointerDownAt = performance.now()
    const y = e.clientY / Math.max(window.innerHeight, 1)
    pluck(300 + (1 - y) * 300 + Math.random() * 24, 0.16, 0.045, 'sine')   // waterdrop
  }, { capture: true })
  window.addEventListener('pointerup', () => {
    if (performance.now() - pointerDownAt > 250) pluck(880, 0.07, 0.02, 'sine')  // drag release
  }, { capture: true })
  window.addEventListener('keydown', e => {
    if (e.repeat) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    resume()
    const now = performance.now()
    if (now - lastKeyAt < 40) return
    lastKeyAt = now
    if (e.key === 'Enter') { sfx.achievement(); return }                    // committing something
    pluck(140 + Math.random() * 40, 0.05, 0.022, 'triangle')                // felt tap
  }, { capture: true })

  // the shell's own event language becomes sound
  // hover is a HEARTBEAT (the world re-affirms ~2×/s; there is no "hover
  // ended" event — tooltips expire instead). The tink fires on a NEW name, or
  // on the same name after the affirmation went quiet — mirroring the
  // tooltip's own 1.4s expiry, so leaving and returning tinks again.
  let lastHoverName: string | null = null
  let lastHoverAt = 0
  window.addEventListener('cafe:hover', e => {
    const d = (e as CustomEvent).detail as string | null
    const now = performance.now()
    if (d && (d !== lastHoverName || now - lastHoverAt > 1400)) sfx.hoverTink()
    if (d) lastHoverAt = now
    lastHoverName = d
  })
  window.addEventListener('cafe:caption', e => {
    const d = (e as CustomEvent).detail as { text?: string; kind?: string } | null
    if (!d || !d.text) return
    if (d.kind === 'tuned') sfx.achievement()
    else if (d.kind === 'hint') sfx.hint()
  })
  window.addEventListener('cafe:pause', e => {
    if ((e as CustomEvent).detail) sfx.pauseIn(); else sfx.pauseOut()
  })

  // the screen itself, heard: FieldEngine samples the frame and reports
  window.addEventListener('cafe:mood', e => {
    const c = ctx
    if (!c || !lowpass || !noiseGain || !noiseBand || !thirdGain) return
    const { bright, warm, busy } = (e as CustomEvent).detail as { bright: number; warm: number; busy: number }
    const t = c.currentTime
    lowpass.frequency.setTargetAtTime(220 + bright * 2200, t, 0.6)
    currentNoise = 0.004 + busy * 0.045
    noiseGain.gain.setTargetAtTime(currentNoise * ambDuck, t, 0.6)
    noiseBand.frequency.setTargetAtTime(400 + busy * 1800 + bright * 600, t, 0.8)
    // warm scenes sing a wide major tenth; cold ones a close minor
    const r = rootFor(currentScene)
    if (oscThird) oscThird.frequency.setTargetAtTime(r * (warm > 0.5 ? 2.52 : 2.38), t, 1.2)
    thirdGain.gain.setTargetAtTime(0.05 + warm * 0.12, t, 0.8)
  })
}
