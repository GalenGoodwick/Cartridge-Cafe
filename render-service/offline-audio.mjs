// offline-audio — render a world's synthesized audio to PCM, offline.
//
// The engine's audio (web/src/app/engine/audio.ts) is Web Audio: oscillators +
// envelopes + a biquad the world sweeps live. There is no AudioContext in the
// headless render loop, so we can't TAP it — instead we CAPTURE the same events
// the browser consumes (`worldData.__play_sound`, `__play_music`, `music_mod`,
// stamped with the frame's time) and re-synthesize them here into a Float32
// buffer, then a 16-bit WAV. Same oscillator math, same ADSR, same score
// scheduler as audio.ts — so the clip sounds like the world does.
//
// Deterministic and pure: no browser, no GPU, no network. Hosted audio
// (`{url}`) is skipped — only the synthesized layer is reproduced (the cafe's
// default, and all a headless renderer can honor).

const SR = 44100

// ── note name → frequency (audio.ts noteFreq) ──
const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
function noteFreq(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(name).trim())
  if (!m) return 0
  let semi = NOTE_BASE[m[1].toUpperCase()]
  if (m[2] === '#') semi += 1
  if (m[2] === 'b') semi -= 1
  const midi = (parseInt(m[3], 10) + 1) * 12 + semi
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function oscSample(type, phase) {
  // phase in [0,1)
  switch (type) {
    case 'square': return phase < 0.5 ? 1 : -1
    case 'sawtooth': return 2 * phase - 1
    case 'triangle': return 4 * Math.abs(phase - 0.5) - 1
    case 'sine':
    default: return Math.sin(phase * 2 * Math.PI)
  }
}

// A mono mixdown buffer we add voices into.
class Mix {
  constructor(seconds) {
    this.n = Math.ceil(seconds * SR) + SR // pad a second for tails
    this.buf = new Float32Array(this.n)
  }
  // one oscillator voice with a linear-attack / exponential-decay envelope,
  // matching audio.ts voice(): gain ramps 0→g over `a`, then exp→~0 over `dec`.
  voice(freq, type, tStart, g, a, dec, cutoffState) {
    if (!freq || g <= 0) return
    const start = Math.floor(tStart * SR)
    const total = a + dec + 0.05
    const end = Math.min(this.n, start + Math.ceil(total * SR))
    let phase = 0
    const dphase = freq / SR
    for (let i = Math.max(0, start); i < end; i++) {
      const t = (i - start) / SR
      let env
      if (t < a) env = (t / Math.max(a, 1e-6)) * g
      else {
        const td = t - a
        env = g * Math.pow(0.0001 / Math.max(g, 1e-6), td / Math.max(dec, 1e-6))
      }
      this.buf[i] += oscSample(type, phase) * env
      phase += dphase; if (phase >= 1) phase -= 1
    }
  }
  // a simple "beep" one-shot (audio.ts beep): constant→exp decay over duration.
  beep(freq, dur, vol, type, tStart) {
    if (!freq || vol <= 0) return
    const start = Math.floor(tStart * SR)
    const end = Math.min(this.n, start + Math.ceil((dur + 0.05) * SR))
    let phase = 0
    const dphase = freq / SR
    for (let i = Math.max(0, start); i < end; i++) {
      const t = (i - start) / SR
      const env = vol * Math.pow(0.001 / Math.max(vol, 1e-6), Math.min(1, t / Math.max(dur, 1e-6)))
      this.buf[i] += oscSample(type, phase) * env
      phase += dphase; if (phase >= 1) phase -= 1
    }
  }
  // percussion (audio.ts voice() drum branch), simplified but tonally matched.
  drum(inst, tStart, g) {
    const start = Math.floor(tStart * SR)
    if (inst === 'kick') {
      const dur = 0.14, end = Math.min(this.n, start + Math.ceil(dur * SR))
      let phase = 0
      for (let i = Math.max(0, start); i < end; i++) {
        const t = (i - start) / SR
        const f = 150 * Math.pow(50 / 150, Math.min(1, t / 0.11))
        const env = g * Math.pow(0.001 / Math.max(g, 1e-6), Math.min(1, t / dur))
        this.buf[i] += Math.sin(phase * 2 * Math.PI) * env
        phase += f / SR; if (phase >= 1) phase -= 1
      }
      return
    }
    const dur = inst === 'hat' ? 0.03 : inst === 'clap' ? 0.09 : 0.12
    const end = Math.min(this.n, start + Math.ceil((dur + 0.02) * SR))
    // white noise through a crude one-pole (highpass-ish for hat, band for others)
    let prev = 0
    for (let i = Math.max(0, start); i < end; i++) {
      const t = (i - start) / SR
      const white = Math.sin(i * 12.9898) * 43758.5453
      const noise = (white - Math.floor(white)) * 2 - 1
      let s = noise
      if (inst === 'hat') { s = noise - prev; prev = noise }          // highpass
      else { s = 0.5 * (noise + prev); prev = noise }                  // lowpass-ish body
      const env = g * Math.pow(0.001 / Math.max(g, 1e-6), Math.min(1, t / dur))
      this.buf[i] += s * env
      if (inst === 'snare') this.buf[i] += Math.sin((i * 180 / SR) * 2 * Math.PI) * env * 0.4
    }
  }
}

// ── the score scheduler (audio.ts playScore), rendered offline across [t0, tEnd] ──
function renderScore(mix, score, t0, tEnd, master) {
  const DRUMS = new Set(['kick', 'snare', 'hat', 'clap'])
  const tracks = (score.tracks || []).map(tr => ({
    inst: String(tr.inst || 'sine'),
    drum: DRUMS.has(String(tr.inst)),
    steps: String(tr.notes || '').trim().split(/\s+/).filter(Boolean),
    gain: tr.gain ?? 0.3, cutoff: tr.cutoff, a: tr.a ?? 0.005, d: tr.d ?? 0.25,
  })).filter(tr => tr.steps.length)
  if (!tracks.length) return
  const div = Math.max(1, Math.min(8, score.div ?? 4))
  const bpm = Math.max(20, Math.min(300, score.bpm ?? 100))
  const stepDur = 60 / bpm / div
  const len = Math.max(...tracks.map(t => t.steps.length))
  const loop = score.loop !== false
  const swing = Math.max(0, Math.min(0.6, score.swing ?? 0))
  const gain = (score.gain ?? 0.5) * master

  let step = 0
  let t = t0 + 0.02
  while (t < tEnd) {
    const tt = t + ((step % 2 === 1) ? swing * stepDur : 0)
    for (const tr of tracks) {
      const cell = tr.steps[step % tr.steps.length]
      if (cell && cell !== '.' && cell !== '-') {
        if (tr.drum) mix.drum(tr.inst, tt, tr.gain * gain)
        else for (const nn of String(cell).split('+')) mix.voice(noteFreq(nn), tr.inst, tt, tr.gain * gain, tr.a, tr.d)
      }
    }
    step++
    if (step >= len) { if (loop) step = 0; else break }
    t += stepDur
  }
}

/**
 * Render captured audio events to PCM Float32.
 * @param events  [{ t, sound?, music? }]  — t seconds; sound = __play_sound value
 *                (obj or array of {frequency,duration,volume,type}); music =
 *                __play_music value ({score} | {stop:true}).
 * @param duration  total seconds of the clip.
 * @returns Float32Array (mono, 44.1k), peak-normalized with soft headroom.
 */
export function renderAudio(events, duration) {
  const mix = new Mix(duration)
  // one-shots
  for (const ev of events) {
    if (!ev.sound) continue
    const list = Array.isArray(ev.sound) ? ev.sound : [ev.sound]
    for (const s of list) {
      if (!s || typeof s !== 'object' || s.url) continue // skip hosted samples
      mix.beep(+s.frequency || 440, +s.duration || 0.2, s.volume == null ? 0.5 : +s.volume,
        s.type || 'sine', ev.t)
    }
  }
  // music: a score plays from its event time until the next music event (or end)
  const musicEvents = events.filter(e => e.music).sort((a, b) => a.t - b.t)
  for (let i = 0; i < musicEvents.length; i++) {
    const m = musicEvents[i].music
    const t0 = musicEvents[i].t
    const tEnd = i + 1 < musicEvents.length ? musicEvents[i + 1].t : duration
    if (m.stop || !m.score) continue
    renderScore(mix, m.score, t0, tEnd, 0.9)
  }
  // soft-normalize: find peak, scale to 0.89, then tanh-limit stray transients
  let peak = 0
  for (let i = 0; i < mix.buf.length; i++) { const a = Math.abs(mix.buf[i]); if (a > peak) peak = a }
  const k = peak > 0.001 ? 0.89 / peak : 1
  const out = mix.buf.subarray(0, Math.ceil(duration * SR))
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * k)
  return out
}

/** Float32 mono PCM → 16-bit mono WAV bytes (Uint8Array). */
export function pcmToWav(pcm, sampleRate = SR) {
  const n = pcm.length
  const buf = new ArrayBuffer(44 + n * 2)
  const dv = new DataView(buf)
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) }
  wr(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE')
  wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true)
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
  wr(36, 'data'); dv.setUint32(40, n * 2, true)
  let o = 44
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); dv.setInt16(o, s * 32767, true); o += 2 }
  return new Uint8Array(buf)
}

export const SAMPLE_RATE = SR
