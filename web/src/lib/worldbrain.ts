// THE IMAGINATION BRAIN — as a stateless read for the create flow.
// A CHOSEN helper (never a gate): give it your world's concept and it threads
// in descriptions from excellent authors, then hands back the PHYSICS those
// descriptions encode (the realism you'd never invent alone), the node plan,
// and the coherence grammar. Born from a live result: the same drowned-crypt
// shader went flat -> photographic only after reading Coleridge & Hopkins into
// it. Bypass is always allowed; this just makes the better path the easy one.

export type BrainRead = {
  themes: string[]
  authors: string[]     // whose descriptions were threaded in
  physics: string[]     // the concrete techniques their words encode
  nodePlan: string[]    // capabilities this world needs, ordered
  grammar: string[]     // the unbiased coherence law
  motifs: string[]      // content words the concept is holding
}

// public-domain descriptions, tagged by theme
const CORPUS: { tags: string[]; who: string; text: string }[] = [
  { tags: ['water', 'ruin', 'sacred'], who: 'Shakespeare', text: 'of his bones are coral made; those are pearls that were his eyes; nothing of him that doth fade, but doth suffer a sea-change into something rich and strange' },
  { tags: ['water', 'ruin', 'void'], who: 'Eliot', text: 'a current under sea picked his bones in whispers as he rose and fell and passed the stages of his age and youth' },
  { tags: ['water', 'light'], who: 'Coleridge', text: 'the water, like a witch’s oils, burnt green, and blue and white; the elfish light fell off in hoary flakes, a flash of golden fire' },
  { tags: ['light', 'sacred'], who: 'Hopkins', text: 'the world is charged with grandeur; it will flame out, like shining from shook foil; it gathers to a greatness, like the ooze of oil crushed' },
  { tags: ['fire', 'void'], who: 'Milton', text: 'a dungeon horrible, on all sides round, as one great furnace flamed; yet from those flames no light, but rather darkness visible' },
  { tags: ['sacred', 'cold', 'light'], who: 'Coleridge', text: 'a stately pleasure-dome, through caverns measureless to man, down to a sunless sea; a sunny pleasure-dome with caves of ice' },
  { tags: ['ruin', 'void'], who: 'Shelley', text: 'nothing beside remains; round the decay of that colossal wreck, boundless and bare, the lone and level sands stretch far away' },
  { tags: ['organic', 'light'], who: 'Whitman', text: 'a leaf of grass is no less than the journey-work of the stars, and the running blackberry would adorn the parlors of heaven' },
  { tags: ['machine', 'ruin'], who: 'Blake', text: 'these dark Satanic Mills; bring me my bow of burning gold, my arrows of desire, my spear' },
  { tags: ['storm', 'water'], who: 'Noyes', text: 'the wind a torrent of darkness among the gusty trees; the moon a ghostly galleon tossed upon cloudy seas' },
  { tags: ['cold', 'void'], who: 'Coleridge', text: 'the frost performs its secret ministry, unhelped by any wind; the icicles quietly shining to the quiet moon' },
  { tags: ['fire', 'machine'], who: 'the forge', text: 'the metal ran white and unmerciful; sparks climbed like a swarm of stars into the black roof of the shed' },
]

const THEME_KEYS: Record<string, string[]> = {
  water: ['water', 'sea', 'drown', 'tide', 'ocean', 'flood', 'submerg', 'wet', 'river', 'rain', 'abyss', 'deep'],
  light: ['light', 'glow', 'radian', 'shine', 'lumin', 'sun', 'star', 'flame', 'beacon', 'dawn', 'gold'],
  fire: ['fire', 'flame', 'ember', 'burn', 'molten', 'lava', 'ash', 'forge', 'heat', 'coal', 'infern'],
  cold: ['cold', 'ice', 'frost', 'snow', 'frozen', 'glacier', 'winter', 'chill', 'pale'],
  ruin: ['ruin', 'decay', 'rust', 'broken', 'crumbl', 'ancient', 'grave', 'tomb', 'bone', 'dust', 'wither', 'wreck'],
  organic: ['grow', 'vine', 'root', 'flesh', 'coral', 'bloom', 'forest', 'branch', 'leaf', 'living', 'moss'],
  sacred: ['cathedral', 'chapel', 'choir', 'temple', 'shrine', 'altar', 'sacred', 'holy', 'vault', 'nave', 'dome'],
  void: ['void', 'dark', 'shadow', 'night', 'black', 'nothing', 'empty', 'silence', 'hollow'],
  machine: ['machine', 'gear', 'engine', 'metal', 'iron', 'steel', 'rivet', 'circuit', 'clockwork', 'forge'],
  storm: ['storm', 'wind', 'gale', 'tempest', 'thunder', 'wave', 'surge', 'squall'],
}

const PHYSICS: Record<string, string[]> = {
  water: ['absorption: red dies first — warm light greens then blues with distance', 'network caustics on lit upward faces', 'wet Fresnel specular (the shook-foil flash)', 'suspended silt inscatter inside the light shafts', 'sea-change encrustation: coral/pearl via noise-perturbed normal + albedo', 'depth fog toward a green-black water color'],
  light: ['HDR emissive well above 1.0 over near-black', 'ONE shared light — everything shades to it', 'volumetric god-rays / shafts', 'bloom = genuinely bright emission, not a post blur'],
  fire: ['blackbody ramp: deep red → orange → white-hot', 'additive HDR emission over near-black', 'domain-warped fbm for turbulent flame & smoke', 'heat shimmer: refract the view ray by noise', 'embers as bright rising motes'],
  cold: ['subsurface glow through thin ice', 'rim light on cold edges', 'desaturated pale palette', 'crystalline SDF facets', 'frost as high-frequency sparkle'],
  ruin: ['erosion noise breaking clean edges', 'dust motes drifting in the light', 'weathering: grime in cavities, wear on ridges', 'muted low-contrast grade'],
  organic: ['smin skeleton joins — limbs grown from a base form', 'translucency / subsurface for flesh & leaf', 'branching SDF via domain-repeat + rotation', 'green-biased albedo with variation'],
  sacred: ['CSG carve the interior from a solid block', 'vaulting via smin arches', 'one dramatic shaft of light', 'tall proportion, deep shadow'],
  void: ['near-black participating haze', 'reveal by emission only', 'heavy distance fog swallowing geometry'],
  machine: ['hard-edged CSG, chamfered boxes', 'metallic specular', 'domain-repeat for mass-produced structure', 'cold steel-blue palette, oil sheen'],
  storm: ['advected domain-warp for motion', 'high-contrast key light through cloud breaks', 'spray / particulate density', 'blue-shifted, desaturated shadows'],
}

const LEX: [string, string[]][] = [
  ['one shared light', ['light', 'shade', 'diff', 'sun', 'star', 'shine', 'glow', 'flame']],
  ['one terminal grade', ['grade', 'lum', 'gold', 'green', 'tint', 'color', 'hue']],
  ['volumetric atmosphere', ['fog', 'haze', 'shaft', 'ray', 'vol', 'mist', 'scatter', 'deep']],
  ['water optics (absorb + caustics)', ['water', 'sea', 'caust', 'wet', 'tide', 'drown', 'silt', 'coral']],
  ['fire / emissive HDR', ['fire', 'flame', 'ember', 'forge', 'molten', 'burn', 'spark']],
  ['sdf-csg (carve from solid)', ['carve', 'wall', 'vault', 'nave', 'stone', 'block', 'hollow', 'tomb']],
  ['smin skeleton join', ['smin', 'join', 'branch', 'limb', 'grow', 'arch', 'weld']],
  ['noise basis (fbm / wave)', ['noise', 'fbm', 'wave', 'turbul', 'crust', 'dust', 'frost', 'cloud']],
  ['tide / uniform clock', ['tide', 'clock', 'breath', 'pulse', 'cycle']],
]

export const GRAMMAR = [
  'ONE light source of truth — everything shades against it (you choose what it is)',
  'ONE terminal grade keyed to luminance — every pixel passes through it (you choose the tint)',
  'composite entities INTO the field — they share its light & fog, never drawn onto it',
  'mood is PARAMETERS not branches — the whole space of looks lives in interpolation',
  'emissive over near-black — contrast by bright emission, not bright ambient',
]

const STOP = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'with', 'from', 'this', 'that', 'you', 'your', 'into', 'onto', 'out', 'all', 'one', 'its', 'a', 'an', 'of', 'in', 'on', 'is', 'it', 'as', 'to'])

export function think(concept: string): BrainRead {
  const t = concept.toLowerCase()
  const themes = Object.keys(THEME_KEYS).filter(th => THEME_KEYS[th].some(k => t.includes(k)))
  const lit = CORPUS.filter(c => c.tags.some(tag => themes.includes(tag)))
  const authors = Array.from(new Set(lit.map(c => c.who)))
  const substrate = (concept + ' ' + lit.map(c => c.text).join(' ')).toLowerCase()

  const seenP = new Set<string>(); const physics: string[] = []
  for (const th of themes) for (const h of (PHYSICS[th] || [])) if (!seenP.has(h)) { seenP.add(h); physics.push(h) }

  const nodePlan = LEX
    .map(([name, keys]) => [name, keys.reduce((s, k) => s + (substrate.split(k).length - 1), 0)] as [string, number])
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)

  const words = (concept.toLowerCase().match(/[a-z]{3,}/g) || []).filter(w => !STOP.has(w))
  const freq = new Map<string, number>()
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1)
  const motifs = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w)

  return { themes, authors, physics, nodePlan, grammar: GRAMMAR, motifs }
}

/** Format a brain read as a build directive an AI can paste-follow. */
export function brainDirective(r: BrainRead): string {
  return [
    'BUILD UNDER THE IMAGINATION BRAIN (chosen guidance for a coherent, real-looking world):',
    r.authors.length ? `— realism threaded from: ${r.authors.join(', ')}` : '',
    '— PHYSICS to apply:', ...r.physics.map(p => '   • ' + p),
    '— NODE PLAN (build these, in order):', ...r.nodePlan.map((n, i) => `   ${i + 1}. ${n}`),
    '— COHERENCE GRAMMAR (obey all):', ...r.grammar.map(g => '   • ' + g),
  ].filter(Boolean).join('\n')
}
