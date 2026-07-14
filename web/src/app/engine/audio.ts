// Game Audio — Web Audio API wrapper for sound effects, synthesized tones, and music

export class GameAudio {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private sounds: Map<string, AudioBuffer> = new Map()
  private masterVolume: number = 1.0
  private music: { source: AudioBufferSourceNode; gain: GainNode; url: string } | null = null

  /** Lazily initialize AudioContext (must be called from user gesture or after first interaction) */
  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.masterGain = this.ctx.createGain()
      this.masterGain.gain.value = this.masterVolume
      this.masterGain.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
    return this.ctx
  }

  /** Load a sound from a URL */
  async loadSound(id: string, url: string): Promise<boolean> {
    try {
      const ctx = this.ensureContext()
      const response = await fetch(url)
      const arrayBuffer = await response.arrayBuffer()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      this.sounds.set(id, audioBuffer)
      return true
    } catch (e) {
      console.warn(`[GameAudio] Failed to load sound "${id}" from ${url}:`, e)
      return false
    }
  }

  /** Play a loaded sound by ID */
  play(id: string, volume: number = 1.0, pitch: number = 1.0): void {
    const buffer = this.sounds.get(id)
    if (!buffer) {
      console.warn(`[GameAudio] Sound "${id}" not loaded`)
      return
    }
    const ctx = this.ensureContext()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = pitch

    const gain = ctx.createGain()
    gain.gain.value = volume
    source.connect(gain)
    gain.connect(this.masterGain!)

    source.start(0)
  }

  /** Play a synthesized beep/tone */
  beep(frequency: number = 440, duration: number = 0.2, volume: number = 0.5, type: OscillatorType = 'sine'): void {
    const ctx = this.ensureContext()
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = frequency

    const gain = ctx.createGain()
    gain.gain.value = volume
    // Fade out to avoid click
    gain.gain.setValueAtTime(volume, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

    osc.connect(gain)
    gain.connect(this.masterGain!)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration + 0.05)
  }

  /** Play a looping music track from a URL (fades in; replaces any current track).
   *  Buffers are cached per URL, so re-triggering the same track is a no-op. */
  async playMusic(url: string, opts: { volume?: number; loop?: boolean; fadeSec?: number } = {}): Promise<void> {
    if (this.music?.url === url) return
    const ctx = this.ensureContext()
    const cacheKey = '__music:' + url
    let buffer = this.sounds.get(cacheKey)
    if (!buffer) {
      try {
        const response = await fetch(url)
        buffer = await ctx.decodeAudioData(await response.arrayBuffer())
        this.sounds.set(cacheKey, buffer)
      } catch (e) {
        console.warn(`[GameAudio] Failed to load music from ${url}:`, e)
        return
      }
    }
    this.stopMusic(0.3)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = opts.loop !== false
    const gain = ctx.createGain()
    const vol = Math.max(opts.volume ?? 0.6, 0.001)
    const fade = opts.fadeSec ?? 0.8
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + fade)
    source.connect(gain)
    gain.connect(this.masterGain!)
    source.start(0)
    this.music = { source, gain, url }
  }

  /** Fade out and stop the current music track */
  stopMusic(fadeSec: number = 0.5): void {
    if (!this.music || !this.ctx) return
    const { source, gain } = this.music
    this.music = null
    try {
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.001), this.ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + fadeSec)
      source.stop(this.ctx.currentTime + fadeSec + 0.05)
    } catch {
      try { source.stop() } catch { /* already stopped */ }
    }
  }

  /** Call from inside a real user-gesture handler: browsers refuse to start
   *  an AudioContext born in a rAF loop, so the first click must adopt it. */
  unlock(): void {
    try { this.ensureContext() } catch { /* no audio device */ }
  }

  /** Set master volume (0-1) */
  setVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume))
    if (this.masterGain) {
      this.masterGain.gain.value = this.masterVolume
    }
  }

  /** Get master volume */
  getVolume(): number {
    return this.masterVolume
  }

  /** Check if a sound is loaded */
  hasSound(id: string): boolean {
    return this.sounds.has(id)
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  SCORE — the audio equivalent of the shader framework. The AI composes
  //  music as DATA (tracks of named synth voices + step patterns); the engine
  //  synthesizes and loops it live. Nothing is hosted — it's a score, not a file.
  //
  //  wd.__play_music = { score: {
  //    bpm: 100, loop: true,
  //    tracks: [
  //      { inst: 'triangle', gain: 0.4, cutoff: 500, notes: 'C2 . G2 . F2 . G2 .' },
  //      { inst: 'square', gain: 0.25, cutoff: 2000, notes: 'C4 E4 G4 . E4 . C4 .' },
  //      { inst: 'kick', notes: 'x . . . x . . .' },
  //      { inst: 'hat',  notes: '. x . x . x . x' },
  //    ] } }
  //  inst: a wave (sine|square|sawtooth|triangle) OR a drum (kick|snare|hat|clap).
  //  notes: space-separated steps — note names (C4, F#3, chords 'C4+E4+G4'),
  //         'x' for a drum hit, '.'/'-' for a rest. Loop = longest track.
  // ═══════════════════════════════════════════════════════════════════════
  private score: { stop: () => void } | null = null

  private noteFreq(name: string): number {
    const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name.trim())
    if (!m) return 0
    const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
    let semi = base[m[1].toUpperCase()]
    if (m[2] === '#') semi += 1
    if (m[2] === 'b') semi -= 1
    const midi = (parseInt(m[3], 10) + 1) * 12 + semi   // C4 = 60
    return 440 * Math.pow(2, (midi - 69) / 12)
  }

  private noiseBuf(ctx: AudioContext, dur: number): AudioBuffer {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
    const b = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    return b
  }

  private voice(ctx: AudioContext, inst: string, note: string, t: number, g: number, cutoff?: number, a = 0.005, dec = 0.25): void {
    const out = this.masterGain!
    if (inst === 'kick' || inst === 'snare' || inst === 'hat' || inst === 'clap') {
      const env = ctx.createGain(); env.connect(out)
      if (inst === 'kick') {
        const o = ctx.createOscillator(); o.type = 'sine'
        o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.11)
        env.gain.setValueAtTime(g, t); env.gain.exponentialRampToValueAtTime(0.001, t + 0.13)
        o.connect(env); o.start(t); o.stop(t + 0.15)
      } else {
        const dur = inst === 'hat' ? 0.03 : inst === 'clap' ? 0.09 : 0.12
        const src = ctx.createBufferSource(); src.buffer = this.noiseBuf(ctx, dur)
        const f = ctx.createBiquadFilter()
        f.type = inst === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = inst === 'hat' ? 8000 : 1600
        env.gain.setValueAtTime(g, t); env.gain.exponentialRampToValueAtTime(0.001, t + dur)
        src.connect(f); f.connect(env); src.start(t); src.stop(t + dur + 0.02)
        if (inst === 'snare') {
          const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 180
          const g2 = ctx.createGain(); g2.gain.setValueAtTime(g * 0.4, t); g2.gain.exponentialRampToValueAtTime(0.001, t + dur)
          o.connect(g2); g2.connect(out); o.start(t); o.stop(t + dur + 0.02)
        }
      }
      return
    }
    for (const nn of note.split('+')) {   // chords via '+'
      const freq = this.noteFreq(nn); if (!freq) continue
      const o = ctx.createOscillator(); o.type = (inst as OscillatorType) || 'sine'; o.frequency.value = freq
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.0001, t)
      env.gain.linearRampToValueAtTime(g, t + a)
      env.gain.exponentialRampToValueAtTime(0.0001, t + a + dec)
      let last: AudioNode = o
      if (cutoff) { const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = cutoff; o.connect(flt); last = flt }
      last.connect(env); env.connect(out)
      o.start(t); o.stop(t + a + dec + 0.05)
    }
  }

  /** Play a composed score (data, not a file). Replaces any current score. */
  playScore(score: {
    bpm?: number; div?: number; loop?: boolean; gain?: number; swing?: number
    tracks?: Array<{ inst: string; notes: string; gain?: number; cutoff?: number; a?: number; d?: number }>
  }): void {
    this.stopScore()
    const ctx = this.ensureContext()
    const drums = new Set(['kick', 'snare', 'hat', 'clap'])
    const tracks = (score.tracks || []).map(tr => ({
      inst: String(tr.inst || 'sine'), drum: drums.has(String(tr.inst)),
      steps: String(tr.notes || '').trim().split(/\s+/).filter(Boolean),
      gain: tr.gain ?? 0.3, cutoff: tr.cutoff, a: tr.a, d: tr.d,
    })).filter(tr => tr.steps.length)
    if (!tracks.length) return
    const div = Math.max(1, Math.min(8, score.div ?? 4))
    const bpm = Math.max(20, Math.min(300, score.bpm ?? 100))
    const stepDur = 60 / bpm / div
    const len = Math.max(...tracks.map(t => t.steps.length))
    const loop = score.loop !== false
    const swing = Math.max(0, Math.min(0.6, score.swing ?? 0))
    const master = score.gain ?? 0.5

    let step = 0
    let nextT = ctx.currentTime + 0.06
    let stopped = false
    const schedule = () => {
      if (stopped) return
      const ahead = ctx.currentTime + 0.12
      while (nextT < ahead && !stopped) {
        const t = nextT + ((step % 2 === 1) ? swing * stepDur : 0)
        for (const tr of tracks) {
          const cell = tr.steps[step % tr.steps.length]
          if (cell && cell !== '.' && cell !== '-') {
            this.voice(ctx, tr.inst, tr.drum ? '' : cell, t, tr.gain * master, tr.cutoff, tr.a, tr.d)
          }
        }
        step++
        if (step >= len) { if (loop) step = 0; else { stopped = true; break } }
        nextT += stepDur
      }
    }
    const iv = setInterval(schedule, 25)
    schedule()
    this.score = { stop: () => { stopped = true; clearInterval(iv) } }
  }

  /** Stop the composed score. */
  stopScore(): void {
    if (this.score) { this.score.stop(); this.score = null }
  }

  /** Destroy the audio context */
  destroy(): void {
    this.stopScore()
    this.stopMusic(0.05)
    if (this.ctx) {
      this.ctx.close().catch(() => {})
      this.ctx = null
      this.masterGain = null
    }
    this.sounds.clear()
  }
}
