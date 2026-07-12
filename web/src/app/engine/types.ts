// Field Engine v3 — Core Data Types

export const DEFAULT_GRID_SIZE = 512

/** The world state — three NxN textures */
export interface FieldWorld {
  size: number
  /** Texture 0: cell color (background layer) — GRID*GRID*4 RGBA */
  colorData: Float32Array
  /** Texture 1: shared data bus — GRID*GRID*4 RGBA
   *  All 4 channels available for field-to-field data exchange */
  stateData: Float32Array
  /** Texture 2: lightweight effects layer — GRID*GRID*4 RGBA
   *  Per-pixel independent — shape is defined by which pixels have data.
   *  R=effectType (0=none, 1+=active type), G=hue (0-1), B=brightness (0-1), A=intensity (fades toward 0)
   *  Step hooks write directly to any pixel for arbitrary shapes. */
  effectData: Float32Array
}

/** Lightweight projectile — managed by simulation, rendered via effectData */
export interface Projectile {
  x: number
  y: number
  vx: number
  vy: number
  effectType: number
  color: number
  size: number
  intensity: number
  age: number
  lifetime: number
}

/** Transform state for field movement/rotation/interaction */
export interface FieldTransform {
  /** Position in grid coordinates */
  x: number
  y: number
  /** Z position for 3D mode (default 0) */
  z?: number
  /** Rotation around Z axis in radians */
  rotation: number
  /** Rotation around X axis in radians (3D mode) */
  rotX?: number
  /** Rotation around Y axis in radians (3D mode) */
  rotY?: number
  /** Scale factor (1.0 = original size) */
  scale: number
  /** Velocity for physics-driven movement (grid units/sec) */
  vx: number
  vy: number
  /** Z velocity (3D mode) */
  vz?: number
  /** Angular velocity (radians/sec) */
  vr: number
}

/** A single shader effect in a field's effect stack */
export interface FieldEffect {
  id: string
  /** Which agent/entity authored this effect */
  author: string
  wgsl: string
  description: string
  /** How this effect composites with layers below */
  blend: 'alpha' | 'additive' | 'multiply'
  /** Render order within the stack (lower = first) */
  order: number
  /** Enable per-effect feedback buffer (shader reads previous frame via u_feedbackTex) */
  feedback?: boolean
}

/** A field = position + color + shader stack. The shader output IS the field body. */
export interface Field {
  id: string
  name: string
  /** RGBA color — components in [0,1] */
  color: [number, number, number, number]
  /** Transform state for position/movement/rotation */
  transform: FieldTransform
  /** Composited shader effect stack (renders in order) */
  effects: FieldEffect[]
  /** Arbitrary key-value properties — step hooks can read/write these for per-field state */
  properties: Map<string, unknown>
  /** Optional parent field ID — child fields move/rotate with their parent */
  parentFieldId?: string
  /** Shape type — determines bounding region and visual form. 'screen' = pixel-perfect (no SDF bounding, shader alpha defines shape) */
  shapeType?: 'circle' | 'rect' | 'screen'
  /** Circle radius in grid pixels (used when shapeType === 'circle') */
  radius?: number
  /** Rect width in grid pixels (used when shapeType === 'rect') */
  w?: number
  /** Rect height in grid pixels (used when shapeType === 'rect') */
  h?: number
  /** Tags for group-based queries and collision callbacks */
  tags?: string[]
  /** Visual type ID for superimposed rendering (undefined = use per-field WGSL effects) */
  visualType?: number
  /** Visual type name (used for cross-renderer ID resolution) */
  visualTypeName?: string
  /** Parameters for the visual type function [p0, p1, p2, p3] */
  visualParams?: [number, number, number, number]
  /** Render order for layer stacking — lower values render first (behind). Default 0. */
  renderOrder?: number
  /** If true, field renders but doesn't capture mouse clicks (click passes through to fields below) */
  noHit?: boolean
  /** If true, field is exempt from field-field collision forces (world-sized backdrops) */
  noCollide?: boolean
}

/** Drawing tool state */
export interface BrushState {
  tool: 'select' | 'brush' | 'line' | 'circle' | 'rect' | 'freeform'
  size: number
  activeFieldId: string | null
}

/** Info about a single cell (for hover inspector) */
export interface CellInfo {
  x: number
  y: number
  index: number
  color: [number, number, number, number]
  state: [number, number, number, number]
  fieldIds: string[]
}

/** Selection state for click-to-select */
export interface SelectionState {
  selectedFieldId: string | null
  selectionMask: Uint8Array
}

/** State for AI WGSL generation — UI-only loading tracker */
export interface GenerationState {
  loading: boolean
  error: string | null
  targetFieldId: string | null
}

/** Camera state */
export interface Camera {
  x: number
  y: number
  zoom: number
}

/** World-level physics parameters — global forces that affect all fields */
export interface WorldParams {
  /** Downward force applied to all fields (grid units/sec^2). 0 = no gravity. */
  gravity: number
  /** Velocity damping per second (0 = no friction, 1 = full stop each second) */
  friction: number
  /** Force between overlapping fields: positive = repel, negative = attract (grid units/sec^2) */
  collisionForce: number
  /** Whether grid edges are solid walls (fields bounce) or open (fields wrap/clip) */
  boundaryMode: 'solid' | 'wrap' | 'open'
  /** Coefficient of restitution for wall bounces (0 = absorb, 1 = perfect bounce) */
  bounciness: number
  /** Gravitational constant for n-body attraction between fields (0 = off, positive = attract, negative = repel) */
  gravitationalConstant: number
}

/** Memory entry types for field agent history */
export type FieldMemoryType =
  | 'created' | 'effect_added' | 'effect_removed'
  | 'message_received' | 'message_sent'
  | 'collision' | 'proximity_changed' | 'world_params_changed'
  | 'force_applied'

/** A single memory entry in a field's history log */
export interface FieldMemoryEntry {
  timestamp: string          // ISO
  type: FieldMemoryType
  content: string            // human-readable
  sourceFieldId: string | null
  data?: Record<string, unknown>
}

/** Proximity info about a neighboring field */
export interface FieldProximity {
  fieldId: string
  fieldName: string
  distance: number             // grid cells between bounds edges (-N = overlap by N)
  direction: [number, number]  // normalized (dx, dy) toward the other field's center
  overlapping: boolean
}

/** Serialized snapshot of a field for server-side state store */
export interface FieldSnapshot {
  id: string
  name: string
  color: [number, number, number, number]
  effects: Array<{
    id: string
    author: string
    wgsl: string
    description: string
    blend: 'alpha' | 'additive' | 'multiply'
    order: number
    feedback?: boolean
  }>
  transform: FieldTransform
  memory: FieldMemoryEntry[]
  proximity: FieldProximity[]
  /** Sampled state texture data at field center (for agent data exchange) */
  stateAtCenter?: { r: number; g: number; b: number; a: number }
  /** Serialized properties map */
  properties?: Record<string, unknown>
  /** Parent field ID for hierarchy (child moves with parent) */
  parentFieldId?: string
  /** Shape type */
  shapeType?: 'circle' | 'rect' | 'screen'
  /** Circle radius in grid pixels */
  radius?: number
  /** Rect width in grid pixels */
  w?: number
  /** Rect height in grid pixels */
  h?: number
  /** Tags for group-based queries */
  tags?: string[]
  /** Visual type for superimposed rendering */
  visualType?: number
  /** Visual type name (for cross-renderer ID resolution) */
  visualTypeName?: string
  /** Visual params for superimposed rendering */
  visualParams?: [number, number, number, number]
  /** If true, field doesn't capture mouse clicks */
  noHit?: boolean
  /** If true, field is exempt from field-field collision forces */
  noCollide?: boolean
}

/** Full world state snapshot (sent via bridge to agents) */
export interface WorldSnapshot {
  worldParams: WorldParams
}

/** A message sent between fields */
export interface FieldMessage {
  fromFieldId: string
  toFieldId: string
  content: string
  data?: Record<string, unknown>
}

/** Agent-defined interaction rule — executed each physics tick */
export interface InteractionRule {
  id: string
  /** Which field defined this rule */
  definedBy: string
  /** When to trigger */
  trigger: 'overlap' | 'proximity' | 'always'
  /** For proximity trigger: max distance in grid cells */
  triggerDistance?: number
  /** Specific field (null = any) */
  fieldA?: string
  /** Specific field (null = any) */
  fieldB?: string
  /** What happens when triggered */
  effect: 'transfer_property' | 'apply_force' | 'modify_property' | 'exchange_wgsl' | 'send_event' | 'damage' | 'destroy_field'
  /** Effect-specific parameters */
  effectParams: Record<string, unknown>
  /** Human-readable description */
  description?: string
}

/** Agent-defined custom command — macro of existing commands */
export interface CustomCommand {
  name: string
  definedBy: string
  description: string
  /** Sequence of existing commands to execute */
  macro: Array<Record<string, unknown>>
}


/** Agent-defined interaction effect — GLSL shader rendered at field overlap pixels */
/** Behavioral hook triggered when an interaction is active */
export interface InteractionHook {
  type: 'memory' | 'modify_property' | 'apply_force' | 'webhook'
  /** Which field to affect: 'A', 'B', or 'both' (default 'both') */
  target?: 'A' | 'B' | 'both'
  /** Memory message (for type='memory') */
  message?: string
  /** Property key (for type='modify_property') */
  property?: string
  /** Property value (for type='modify_property') */
  value?: unknown
  /** Force components (for type='apply_force') */
  fx?: number
  fy?: number
  /** URL to call (for type='webhook') */
  url?: string
  /** Minimum seconds between triggers (default 1.0) */
  cooldown?: number
}

export interface InteractionEffect {
  id: string
  /** Which agent authored this effect */
  author: string
  /** Specific field A (null = any field) */
  fieldA: string | null
  /** Specific field B (null = any field) */
  fieldB: string | null
  /** WGSL code providing interactionEffect() function */
  wgsl: string
  description: string
  /** How this effect composites */
  blend: 'alpha' | 'additive' | 'multiply'
  /** Pixel dilation beyond exact overlap zone (0 = overlap only) */
  spread: number
  /** Render order (lower = first) */
  order: number
  /** If true, clears underlying field pixels before rendering — interaction takes visual precedence */
  precedence?: boolean
  /** Behavioral hooks triggered each frame while this interaction is active */
  hooks?: InteractionHook[]
}

// ─── Superimposed Rendering Types ───

/** Visual type IDs for superimposed rendering — parameterized function IDs */
export const VISUAL_TYPES = {
  solid: 0,
  circle: 1,
  glow: 2,
  ring: 3,
  eyes: 4,
  coin: 5,
  platform: 6,
  stripe: 7,
  pulse: 8,
  gradient: 9,
  lava: 10,
  crystal: 11,
  plasma: 12,
  nebula: 13,
  water: 14,
  fire: 15,
  electric: 16,
  terrain: 17,
  portal: 18,
  organic: 19,
} as const

export type VisualTypeName = keyof typeof VISUAL_TYPES

/** GPU-side field data for superimposed rendering (6 vec4f = 96 bytes) */
export interface SuperFieldGPU {
  /** vec4f 0: x, y, scale, rotation (Z-axis) */
  posScaleRot: [number, number, number, number]
  /** vec4f 1: shapeType (0=circle, 1=rect), dim1, dim2, renderTargetId (-1=screen, 0-5=target index) */
  shapeDims: [number, number, number, number]
  /** vec4f 2: r, g, b, a */
  color: [number, number, number, number]
  /** vec4f 3: visualType, param0, param1, param2 */
  visualAndParams: [number, number, number, number]
  /** vec4f 4: param3, bidirectionalBehind (1=temporal behind from prev frame), lighting, specular */
  extraParams: [number, number, number, number]
  /** vec4f 5: z position, rotX, rotY, reserved (3D mode — all 0 in 2D) */
  pos3D: [number, number, number, number]
}

// ─── Game Engine Types ───

/** HUD element — rendered as DOM overlay on top of the canvas */
export interface HudElement {
  id: string
  type: 'text' | 'bar' | 'image'
  /** CSS positioning — use px or % values */
  x?: string
  y?: string
  right?: string
  bottom?: string
  /** Text content (for type='text') */
  text?: string
  /** Font size in CSS units (default '16px') */
  fontSize?: string
  /** CSS color string */
  color?: string
  /** Current value (for type='bar') */
  value?: number
  /** Max value (for type='bar') */
  max?: number
  /** Bar width in CSS units (default '100px') */
  width?: string
  /** Bar background color */
  barColor?: string
  /** Image URL (for type='image') */
  src?: string
  /** Image width in CSS units */
  imgWidth?: string
  /** Image height in CSS units */
  imgHeight?: string
  /** Whether element is visible (default true) */
  visible?: boolean
}

/** Scene snapshot — stores complete engine state for save/load */
export interface SceneSnapshot {
  name: string
  fields: FieldSnapshot[]
  worldParams: WorldParams
  worldData: Record<string, unknown>
  stepHooks: Array<{ id: string; author: string; description: string; code: string }>
  interactionRules: InteractionRule[]
  interactionEffects: InteractionEffect[]
  visualTypes?: Array<{ name: string; wgsl: string }>
  modules?: Array<{ name: string; wgsl: string }>
  timestamp: number
}

/** Camera follow configuration */
export interface CameraFollow {
  targetFieldId: string
  smoothing: number
  offsetX: number
  offsetY: number
  deadZone: number
}

/** Tween definition for property animation */
export interface TweenDef {
  id: string
  fieldId: string
  property: string
  from: number
  to: number
  duration: number
  elapsed: number
  easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
  onComplete?: string
}

/** Timer definition */
export interface TimerDef {
  id: string
  hookId: string
  delay: number
  elapsed: number
  repeat: boolean
}

/** Collision callback registration */
export interface CollisionCallback {
  id: string
  /** Match by fieldId or tag */
  matchA: { fieldId?: string; tag?: string }
  matchB: { fieldId?: string; tag?: string }
  onEnter?: string
  onExit?: string
  onStay?: string
}

/** Game state definition */
export interface GameStateDef {
  name: string
  onEnter?: string
  onExit?: string
  pausePhysics?: boolean
}

/** GPU compute step hook — WGSL function that runs per-field each frame on the GPU.
 *  Fully sandboxed: no JS, DOM, network, or filesystem access. */
export interface GpuStepHook {
  id: string
  author: string
  description: string
  /** WGSL function body — must define fn hook_<id>(idx: u32) { ... } */
  wgsl: string
  /** Execution order (lower = first) */
  order: number
}

