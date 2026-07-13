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
let master: GainNode | null = null
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
  TIDERUNNER: 103.8,
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
    buildAmbient()
  }
  return ctx
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
  // one switch rules ALL sound: world audio (GameAudio) listens for this
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
    resume()
    const now = performance.now()
    if (now - lastKeyAt < 40) return
    lastKeyAt = now
    if (e.key === 'Enter') { sfx.achievement(); return }                    // committing something
    pluck(140 + Math.random() * 40, 0.05, 0.022, 'triangle')                // felt tap
  }, { capture: true })

  // the shell's own event language becomes sound
  window.addEventListener('cafe:hover', e => {
    if ((e as CustomEvent).detail) sfx.hoverTink()
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
