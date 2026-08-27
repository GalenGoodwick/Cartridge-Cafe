'use client'

// THE PLAN EXECUTOR (proof, v2) — draws a WorldPlan as ONE WebGL2 pass and
// makes it OPERABLE:
//  · TEXT IS RIPPED FROM THE REAL FONT (Galen: "we have a system to rip fonts
//    into shaders" — the RIP philosophy applied to type): each label is
//    rasterized ONCE from the page's actual IBM Plex Mono into a texture at 3×
//    and sampled with mips — crisp at any size, no more blocky 5×7.
//  · BUTTONS FUNCTION: pointer events hit-test against THE PLAN'S OWN RECTS
//    (topmost z first) — a region with a declared action is a button. Hover
//    brightens it (uHot), click fires onAction. The hit table IS the plan.
// Still scaffold-WebGL2; every piece (atlas texture, hit table, fit scales)
// ports 1:1 to the WGSL engine at rung 4.
import { useEffect, useRef } from 'react'
import type { WorldPlan, RegionRoute } from '@/app/engine/world-solve'

const MAX_R = 12

const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform int uCount;
uniform vec4 uRect[${MAX_R}];
uniform int uKind[${MAX_R}];     // 0 stage 1 glass 2 glassBright
uniform int uHot;                // hovered actionable region index (-1 none)
uniform float uDpr;
out vec4 o;

vec3 stage(vec2 uv, float t){
  vec3 ro = vec3(0., 0.6, -2.2);
  vec3 rd = normalize(vec3(uv, 1.4));
  float tt = 0.; float d; vec3 p;
  for (int i = 0; i < 48; i++) {
    p = ro + rd * tt;
    float sp = length(p - vec3(0., 0.55 + 0.15*sin(t*1.3), 1.2)) - 0.5;
    float fl = p.y + 0.4 + 0.06*sin(p.x*3.+t)*sin(p.z*3.);
    d = min(sp, fl);
    if (d < 0.002 || tt > 8.) break;
    tt += d * 0.9;
  }
  vec3 col = mix(vec3(0.03,0.04,0.10), vec3(0.10,0.06,0.16), uv.y + 0.5);
  if (tt < 8.) {
    vec3 q = ro + rd*tt;
    float sp = length(q - vec3(0., 0.55 + 0.15*sin(t*1.3), 1.2)) - 0.5;
    float fl = q.y + 0.4 + 0.06*sin(q.x*3.+t)*sin(q.z*3.);
    bool isS = sp < fl;
    vec3 n = isS ? normalize(q - vec3(0., 0.55 + 0.15*sin(t*1.3), 1.2))
                 : normalize(vec3(0.18*cos(q.x*3.+t), 1., 0.18*cos(q.z*3.)));
    float li = max(0., dot(n, normalize(vec3(0.5, 0.8, -0.4))));
    vec3 base = isS ? vec3(1.0, 0.55, 0.25) : vec3(0.16, 0.13, 0.30);
    col = base * (0.25 + 0.85*li) + vec3(0.3,0.15,0.05)*pow(li, 8.);
    col *= exp(-tt*0.16);
  }
  float ring = abs(length(uv) - 0.42);
  col += vec3(0.45,0.8,1.0) * smoothstep(0.010, 0.0, ring) * 0.9;
  return col;
}

void main(){
  vec2 fcCss = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec3 col = vec3(0.016, 0.014, 0.028);
  for (int i = 0; i < ${MAX_R}; i++) {
    if (i >= uCount) break;
    vec4 R = uRect[i];
    vec2 lo = R.xy, hi = R.xy + R.zw;
    if (fcCss.x < lo.x || fcCss.x > hi.x || fcCss.y < lo.y || fcCss.y > hi.y) continue;
    vec2 local = fcCss - lo;
    if (uKind[i] == 0) {
      vec2 uv = (local - 0.5 * R.zw) / min(R.z, R.w);
      uv.y = -uv.y;
      col = stage(uv, uTime);
      vec2 eB = min(local, R.zw - local);
      if (min(eB.x, eB.y) < 1.5) col = mix(col, vec3(0.31,0.78,1.0), 0.8);
    } else {
      float bright = uKind[i] == 2 ? 1.0 : 0.45;
      if (i == uHot) bright *= 1.9;                       // hover affordance
      vec3 glass = vec3(0.055, 0.05, 0.085) * (1.2 + 0.3 * bright);
      vec2 eB = min(local, R.zw - local);
      float edge = smoothstep(0.0, 3.0, min(eB.x, eB.y));
      col = mix(vec3(0.35, 0.28, 0.14) * bright, glass * (i == uHot ? 1.6 : 1.0), edge);
    }
  }
  o = vec4(col, 1.0);
}`

const LVERT = `#version 300 es
in vec2 p; uniform vec4 uBox; uniform vec2 uRes; out vec2 vUv;
void main(){ vUv = p*0.5+0.5; vec2 px = uBox.xy + (p*0.5+0.5)*uBox.zw;
  vec2 nd = (px/uRes)*2.-1.; gl_Position = vec4(nd.x, -nd.y, 0., 1.); }`
const LFRAG = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform vec3 uCol; out vec4 o;
void main(){ float a = texture(uTex, vUv).a; o = vec4(uCol, a*0.95); }`

/** THE FONT RIP — rasterize a label from the page's REAL font into a texture
 *  (3× oversampled + mips). One draw call per label; monospace metrics make
 *  placement arithmetic. This is the sprite-RIP move applied to type. */
function ripLabel(gl: WebGL2RenderingContext, text: string): { tex: WebGLTexture; w: number; h: number } {
  const scale = 3, px = 16 * scale
  const cv = document.createElement('canvas')
  const c = cv.getContext('2d')!
  const font = `500 ${px}px "IBM Plex Mono", ui-monospace, Menlo, monospace`
  c.font = font
  const m = c.measureText(text)
  cv.width = Math.ceil(m.width) + px; cv.height = Math.ceil(px * 1.5)
  const c2 = cv.getContext('2d')!
  c2.font = font
  c2.textBaseline = 'middle'
  c2.fillStyle = '#fff'
  c2.fillText(text, px / 2, cv.height / 2)
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cv)
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  return { tex, w: cv.width / scale, h: cv.height / scale }
}

export function PlanCanvas({ plan, labels, actions, onAction }: {
  plan: WorldPlan
  labels: Record<string, string>
  /** regionId → action id; a region with an action IS a button */
  actions: Record<string, string>
  onAction: (action: string, regionId: string) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const planRef = useRef(plan); planRef.current = plan
  const labelsRef = useRef(labels); labelsRef.current = labels
  const actionsRef = useRef(actions); actionsRef.current = actions
  const onActionRef = useRef(onAction); onActionRef.current = onAction
  const hotRef = useRef(-1)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const gl = cv.getContext('webgl2', { antialias: true })
    if (!gl) return
    const sh = (t: number, s: string) => { const x = gl.createShader(t)!; gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(x)); return x }
    const mk = (v: string, f: string) => { const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, v)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); return p }
    const prog = mk(VERT, FRAG), lprog = mk(LVERT, LFRAG)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW)
    const bindP = (p: WebGLProgram) => { const l = gl.getAttribLocation(p, 'p'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0) }
    const U = (n: string) => gl.getUniformLocation(prog, n)
    const lU = (n: string) => gl.getUniformLocation(lprog, n)
    const lquad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, lquad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,-1, 1,1, -1,1]), gl.STATIC_DRAW)
    const ripCache = new Map<string, { tex: WebGLTexture; w: number; h: number }>()

    // ── THE HIT TABLE IS THE PLAN — pointer → topmost actionable rect ──
    const routeAt = (x: number, y: number): { r: RegionRoute; i: number } | null => {
      const routes = planRef.current.routes.slice(0, MAX_R)
      for (let i = routes.length - 1; i >= 0; i--) {          // topmost z first
        const r = routes[i]
        if (!actionsRef.current[r.id]) continue
        const { rect } = r
        if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return { r, i }
      }
      return null
    }
    const toCss = (e: PointerEvent) => {
      const b = cv.getBoundingClientRect()
      return { x: e.clientX - b.left, y: e.clientY - b.top }
    }
    const onMove = (e: PointerEvent) => {
      const { x, y } = toCss(e)
      const hit = routeAt(x, y)
      hotRef.current = hit ? hit.i : -1
      cv.style.cursor = hit ? 'pointer' : 'default'
    }
    const onDown = (e: PointerEvent) => {
      const { x, y } = toCss(e)
      const hit = routeAt(x, y)
      if (hit) onActionRef.current(actionsRef.current[hit.r.id], hit.r.id)
    }
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerdown', onDown)

    let raf = 0, stop = false
    const t0 = performance.now()
    const draw = () => {
      if (stop) return
      const plan = planRef.current
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const parent = cv.parentElement!
      const w = Math.max(1, Math.round(parent.clientWidth * dpr)), h = Math.max(1, Math.round(parent.clientHeight * dpr))
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; cv.style.width = parent.clientWidth + 'px'; cv.style.height = parent.clientHeight + 'px' }
      gl.viewport(0, 0, w, h)
      gl.disable(gl.BLEND)
      gl.useProgram(prog)
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); bindP(prog)
      gl.uniform2f(U('uRes'), w, h)
      gl.uniform1f(U('uDpr'), dpr)
      gl.uniform1f(U('uTime'), (performance.now() - t0) / 1000)
      gl.uniform1i(U('uHot'), hotRef.current)
      const routes = plan.routes.slice(0, MAX_R)
      gl.uniform1i(U('uCount'), routes.length)
      const rect = new Float32Array(MAX_R * 4), kind = new Int32Array(MAX_R)
      routes.forEach((r, i) => {
        rect.set([r.rect.x, r.rect.y, r.rect.w, r.rect.h], i * 4)
        kind[i] = r.layer === 'game' ? 0 : (r.backend === 'empty' && !actionsRef.current[r.id] ? 1 : 2)
      })
      gl.uniform4fv(U('uRect'), rect)
      gl.uniform1iv(U('uKind'), kind)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      gl.useProgram(lprog)
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.bindBuffer(gl.ARRAY_BUFFER, lquad); bindP(lprog)
      gl.uniform2f(lU('uRes'), w, h)
      for (const r of routes) {
        const label = labelsRef.current[r.id]
        if (!label) continue
        let g = ripCache.get(label)
        if (!g) { g = ripLabel(gl, label); ripCache.set(label, g) }
        const gw = g.w * dpr, gh = g.h * dpr
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tex)
        gl.uniform1i(lU('uTex'), 0)
        const isGame = r.layer === 'game'
        gl.uniform3f(lU('uCol'), isGame ? 0.35 : 1.0, isGame ? 0.8 : 0.86, isGame ? 1.0 : 0.55)
        const cx = isGame ? (r.rect.x + 10) * dpr : (r.rect.x + (r.rect.w - gw / dpr) / 2) * dpr
        const cy = (r.rect.y + (isGame ? 6 : (r.rect.h - gh / dpr) / 2)) * dpr
        gl.uniform4f(lU('uBox'), cx, cy, gw, gh)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => { stop = true; cancelAnimationFrame(raf); cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerdown', onDown) }
  }, [])
  return <canvas ref={ref} className="absolute inset-0 block" />
}
