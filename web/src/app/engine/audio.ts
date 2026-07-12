// Game Audio — Web Audio API wrapper for sound effects and synthesized tones

export class GameAudio {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private sounds: Map<string, AudioBuffer> = new Map()
  private masterVolume: number = 1.0

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

  /** Destroy the audio context */
  destroy(): void {
    if (this.ctx) {
      this.ctx.close().catch(() => {})
      this.ctx = null
      this.masterGain = null
    }
    this.sounds.clear()
  }
}
