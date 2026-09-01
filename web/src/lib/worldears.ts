// THE EARS — the sonic sibling of the imagination brain (worldbrain.ts).
// The cafe gave the AI eyes (render_probe) but never ears. This gives a world
// a VOICE: describe its sound as a feeling, and it returns the PHYSICS of that
// sound (the realism you'd never invent cold — the deep muffles highs; stone
// holds a seconds-long reverb; the tide bends pitch), a sound grammar that
// makes any palette cohere, a build directive, and a synth recipe the panel
// plays so you actually HEAR it. A chosen helper, never a gate.

export type EarRecipe = {
  bed: 'brown' | 'pink' | 'white' | 'drone'   // the single continuous layer
  cutoff: number          // low-pass Hz on the bed (the deep = low; air = high)
  cutoffLFO: number       // Hz of slow filter sway (the swell/breath); 0 = still
  drone: number | null    // sustained tone Hz under it all, or none
  reverb: number          // reverb tail seconds (room size: crypt = long, ruin = dead)
  transient: 'drip' | 'crackle' | 'bell' | 'click' | 'boom' | 'gust' | null
  rate: number            // transients per second (sparse!) — the events
  gain: number            // overall level
}

export type EarRead = {
  themes: string[]
  physics: string[]       // the sonic realism the world's themes imply
  grammar: string[]       // the coherence law for sound
  recipe: EarRecipe       // for the live WebAudio preview
  directive: string       // paste-follow build directive for an AI
}

const THEME_KEYS: Record<string, string[]> = {
  water:   ['water', 'sea', 'drown', 'tide', 'ocean', 'flood', 'submerg', 'wet', 'river', 'rain', 'abyss', 'deep'],
  fire:    ['fire', 'flame', 'ember', 'burn', 'molten', 'lava', 'ash', 'forge', 'heat', 'coal', 'infern'],
  cold:    ['cold', 'ice', 'frost', 'snow', 'frozen', 'glacier', 'winter', 'chill', 'pale'],
  sacred:  ['cathedral', 'chapel', 'choir', 'temple', 'shrine', 'altar', 'sacred', 'holy', 'vault', 'nave', 'dome', 'bell'],
  ruin:    ['ruin', 'decay', 'rust', 'broken', 'crumbl', 'ancient', 'grave', 'tomb', 'bone', 'dust', 'wither', 'wreck'],
  storm:   ['storm', 'wind', 'gale', 'tempest', 'thunder', 'wave', 'surge', 'squall', 'rain'],
  machine: ['machine', 'gear', 'engine', 'metal', 'iron', 'steel', 'rivet', 'circuit', 'clockwork', 'motor'],
  organic: ['grow', 'vine', 'root', 'flesh', 'coral', 'bloom', 'forest', 'branch', 'leaf', 'living', 'moss', 'garden'],
  void:    ['void', 'dark', 'shadow', 'night', 'black', 'nothing', 'empty', 'silence', 'hollow', 'space'],
}

const PHYSICS: Record<string, string[]> = {
  water:   ['low-pass everything — the deep swallows the highs', 'a long slow reverb (a flooded stone room)', 'pitch bends on a slow swell, riding the tide', 'sparse bright droplets over the dark bed', 'a sub-bass pressure that breathes in and out'],
  fire:    ['a brown-noise roar as the bed', 'irregular crackle transients, never on a grid', 'filtered upward sweeps when it flares', 'a low room rumble under everything'],
  cold:    ['thin, high air with almost no low end', 'sparse glassy pings with long decay', 'a distant wind bed, barely there', 'brittle little clicks (frost settling)'],
  sacred:  ['a cathedral reverb — seconds of tail', 'a low sustained drone (the room hums)', 'distant choral formants — vowel-filtered noise', 'sparse high bell partials, ringing out'],
  ruin:    ['a dry, dead acoustic — almost no reverb', 'sparse settling creaks and shifts', 'a quiet dust-floor of noise', 'a low mournful drone, fading'],
  storm:   ['wide noise gusts that swell and ebb', 'distant thunder as low booms, irregular', 'rain as a dense high-noise sheet', 'wind whistling through the gaps'],
  machine: ['a rhythmic mechanical pulse as the bed', 'metallic resonant clanks', 'a droning motor under it all', 'filtered steam hiss between beats'],
  organic: ['soft irregular rustles and breath', 'a warm mid-focused bed', 'gentle ticks and chirps, sparse', 'nothing metallic — everything soft-edged'],
  void:    ['near silence with a deep sub drone', 'very long gaps between very sparse events', 'a low pressure hum you feel more than hear'],
}

const GRAMMAR = [
  'ONE bed — a single continuous noise/drone layer everything sits in (the sonic "one light")',
  'ONE space — a single reverb; every sound shares it, so nothing sounds pasted on',
  'sparse transients over the bed — events, not a wall of sound',
  'mood is PARAMETERS — filter cutoff, reverb size, event rate; interpolate them, do not switch tracks',
  'leave silence — the quiet is what makes each event land',
]

const RECIPE: Record<string, EarRecipe> = {
  water:   { bed: 'brown', cutoff: 420, cutoffLFO: 0.08, drone: 46, reverb: 3.4, transient: 'drip', rate: 0.5, gain: 0.5 },
  fire:    { bed: 'brown', cutoff: 1600, cutoffLFO: 0.4, drone: 60, reverb: 1.2, transient: 'crackle', rate: 6, gain: 0.45 },
  cold:    { bed: 'white', cutoff: 6000, cutoffLFO: 0.05, drone: null, reverb: 2.6, transient: 'bell', rate: 0.5, gain: 0.35 },
  sacred:  { bed: 'drone', cutoff: 1200, cutoffLFO: 0.03, drone: 55, reverb: 5.0, transient: 'bell', rate: 0.35, gain: 0.5 },
  ruin:    { bed: 'pink', cutoff: 900, cutoffLFO: 0.02, drone: 41, reverb: 0.5, transient: 'click', rate: 0.7, gain: 0.4 },
  storm:   { bed: 'white', cutoff: 3000, cutoffLFO: 0.5, drone: null, reverb: 2.0, transient: 'boom', rate: 0.6, gain: 0.5 },
  machine: { bed: 'brown', cutoff: 800, cutoffLFO: 0.0, drone: 50, reverb: 1.0, transient: 'click', rate: 3, gain: 0.45 },
  organic: { bed: 'pink', cutoff: 2400, cutoffLFO: 0.15, drone: null, reverb: 1.4, transient: 'click', rate: 1.2, gain: 0.4 },
  void:    { bed: 'drone', cutoff: 500, cutoffLFO: 0.02, drone: 34, reverb: 4.0, transient: null, rate: 0.1, gain: 0.5 },
}

const DEFAULT_RECIPE: EarRecipe = { bed: 'pink', cutoff: 1500, cutoffLFO: 0.1, drone: 48, reverb: 1.8, transient: 'click', rate: 0.8, gain: 0.4 }

/** blend two recipes (first theme dominant) so a multi-theme world gets one coherent voice */
function blend(a: EarRecipe, b: EarRecipe): EarRecipe {
  const m = (x: number, y: number) => x * 0.62 + y * 0.38
  return {
    bed: a.bed, transient: a.transient,
    cutoff: m(a.cutoff, b.cutoff), cutoffLFO: m(a.cutoffLFO, b.cutoffLFO),
    drone: a.drone ?? b.drone, reverb: m(a.reverb, b.reverb),
    rate: m(a.rate, b.rate), gain: m(a.gain, b.gain),
  }
}

export function hearConcept(concept: string): EarRead {
  const t = (concept || '').toLowerCase()
  const themes = Object.keys(THEME_KEYS).filter(th => THEME_KEYS[th].some(k => t.includes(k)))
  const seen = new Set<string>(); const physics: string[] = []
  for (const th of themes) for (const h of (PHYSICS[th] || [])) if (!seen.has(h)) { seen.add(h); physics.push(h) }
  let recipe = DEFAULT_RECIPE
  if (themes.length === 1) recipe = RECIPE[themes[0]]
  else if (themes.length >= 2) recipe = blend(RECIPE[themes[0]], RECIPE[themes[1]])
  return { themes, physics, grammar: GRAMMAR, recipe, directive: earDirective(themes, physics, recipe) }
}

function earDirective(themes: string[], physics: string[], r: EarRecipe): string {
  return [
    'GIVE THIS WORLD A VOICE (chosen guidance — one coherent soundscape):',
    themes.length ? `— sonic themes: ${themes.join(', ')}` : '',
    '— SOUND PHYSICS:', ...physics.map(p => '   • ' + p),
    '— SOUND GRAMMAR (obey all):', ...GRAMMAR.map(g => '   • ' + g),
    `— STARTING RECIPE: ${r.bed} bed · low-pass ${Math.round(r.cutoff)}Hz (sway ${r.cutoffLFO}Hz) · ${r.drone ? 'drone ' + r.drone + 'Hz' : 'no drone'} · reverb ${r.reverb}s · ${r.transient ? r.transient + ' transients @ ' + r.rate + '/s' : 'no transients'}`,
  ].filter(Boolean).join('\n')
}
