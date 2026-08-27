'use client'

// THE PLAN EXECUTOR (proof) — draws a WorldPlan as ONE WebGL2 pass. Every
// region the solve routed is painted by backend: the game stage as a raymarched
// scene, chrome bands as engine-drawn glass + glyph pixels (5x7 font — no DOM
// text), reserved bands as faint glass. The fragment shader receives the SAME
// rects worldSolve produced — what draws IS the plan the eye reads.
//
// Fit is honored per region via the solved scales (fit.ts): the stage's
// composition is isotropic — the ring stays round at ANY viewport split.
import { useEffect, useRef } from 'react'
import type { WorldPlan } from '@/app/engine/world-solve'

const MAX_R = 12

const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`

// 5x7 glyph rows for the tiny label set (A-Z + space) — engine text, no DOM.
const FONT: Record<string, number[]> = {
  A:[0x1F,0x24,0x44,0x24,0x1F], B:[0x7F,0x49,0x49,0x49,0x36], C:[0x3E,0x41,0x41,0x41,0x22],
  D:[0x7F,0x41,0x41,0x22,0x1C], E:[0x7F,0x49,0x49,0x49,0x41], F:[0x7F,0x48,0x48,0x48,0x40],
  G:[0x3E,0x41,0x49,0x49,0x2F], H:[0x7F,0x08,0x08,0x08,0x7F], I:[0x41,0x41,0x7F,0x41,0x41],
  K:[0x7F,0x08,0x14,0x22,0x41], L:[0x7F,0x01,0x01,0x01,0x01], M:[0x7F,0x20,0x18,0x20,0x7F],
  N:[0x7F,0x10,0x08,0x04,0x7F], O:[0x3E,0x41,0x41,0x41,0x3E], P:[0x7F,0x48,0x48,0x48,0x30],
  R:[0x7F,0x48,0x4C,0x4A,0x31], S:[0x32,0x49,0x49,0x49,0x26], T:[0x40,0x40,0x7F,0x40,0x40],
  U:[0x7E,0x01,0x01,0x01,0x7E], W:[0x7E,0x01,0x0E,0x01,0x7E], X:[0x63,0x14,0x08,0x14,0x63],
  Y:[0x60,0x10,0x0F,0x10,0x60], ' ':[0,0,0,0,0], '·':[0,0,0x08,0,0],
}

function glyphTex(gl: WebGL2RenderingContext, text: string): { tex: WebGLTexture; w: number; h: number } {
  const cw = 6, w = text.length * cw, h = 7
  const px = new Uint8Array(w * h)
  text.toUpperCase().split('').forEach((ch, ci) => {
    const cols = FONT[ch] ?? FONT[' ']
    for (let x = 0; x < 5; x++) for (let y = 0; y < 7; y++)
      if ((cols[x] >> (6 - y)) & 1) px[y * w + ci * cw + x] = 255
  })
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, px)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  return { tex, w, h }
}

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform int uCount;
uniform vec4 uRect[${MAX_R}];    // x,y,w,h (css px, y-down from top)
uniform int uKind[${MAX_R}];     // 0 stage(raymarch) 1 glass 2 glassBright
uniform float uDpr;
out vec4 o;

// tiny raymarched scene — floor + pulsing sphere + ring, lit; composed in
// ISOTROPIC region units so it recomposes to any box without squish.
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
    vec2 e = vec2(0.004, 0.);
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
  col += vec3(0.45,0.8,1.0) * smoothstep(0.010, 0.0, ring) * 0.9;   // THE ROUND PROOF
  return col;
}

void main(){
  vec2 fcCss = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;  // css px, y-down
  vec3 col = vec3(0.016, 0.014, 0.028);
  for (int i = 0; i < ${MAX_R}; i++) {
    if (i >= uCount) break;
    vec4 R = uRect[i];
    vec2 lo = R.xy, hi = R.xy + R.zw;
    if (fcCss.x < lo.x || fcCss.x > hi.x || fcCss.y < lo.y || fcCss.y > hi.y) continue;
    vec2 local = fcCss - lo;
    if (uKind[i] == 0) {
      // ISOTROPIC: centered, both axes / min(w,h) — fit.ts, in-shader
      vec2 uv = (local - 0.5 * R.zw) / min(R.z, R.w);
      uv.y = -uv.y;
      col = stage(uv, uTime);
      // hairline frame
      vec2 eB = min(local, R.zw - local);
      if (min(eB.x, eB.y) < 1.5) col = mix(col, vec3(0.31,0.78,1.0), 0.8);
    } else {
      float bright = uKind[i] == 2 ? 1.0 : 0.45;
      vec3 glass = vec3(0.055, 0.05, 0.085) * (1.2 + 0.3 * bright);
      // rounded-feel edge shading
      vec2 eB = min(local, R.zw - local);
      float edge = smoothstep(0.0, 3.0, min(eB.x, eB.y));
      col = mix(vec3(0.35, 0.28, 0.14) * bright, glass, edge);
    }
  }
  o = vec4(col, 1.0);
}`

/** labels drawn AFTER the pass from the same plan rects (glyph textures via a
 *  tiny 2nd program — still engine pixels, still no DOM text). */
const LVERT = `#version 300 es
in vec2 p; uniform vec4 uBox; uniform vec2 uRes; out vec2 vUv;
void main(){ vUv = p*0.5+0.5; vec2 px = uBox.xy + (p*0.5+0.5)*uBox.zw;
  vec2 nd = (px/uRes)*2.-1.; gl_Position = vec4(nd.x, -nd.y, 0., 1.); }`
const LFRAG = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform vec3 uCol; out vec4 o;
void main(){ float a = texture(uTex, vUv).r; o = vec4(uCol, a*0.92); }`

export function PlanCanvas({ plan, labels }: { plan: WorldPlan; labels: Record<string, string> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const planRef = useRef(plan)
  planRef.current = plan
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
    const glyphCache = new Map<string, { tex: WebGLTexture; w: number; h: number }>()

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
      const routes = plan.routes.slice(0, MAX_R)
      gl.uniform1i(U('uCount'), routes.length)
      const rect = new Float32Array(MAX_R * 4), kind = new Int32Array(MAX_R)
      routes.forEach((r, i) => {
        rect.set([r.rect.x, r.rect.y, r.rect.w, r.rect.h], i * 4)
        kind[i] = r.layer === 'game' ? 0 : (r.backend === 'empty' ? 1 : 2)
      })
      gl.uniform4fv(U('uRect'), rect)
      gl.uniform1iv(U('uKind'), kind)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      // labels from the SAME plan rects
      gl.useProgram(lprog)
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.bindBuffer(gl.ARRAY_BUFFER, lquad); bindP(lprog)
      gl.uniform2f(lU('uRes'), w, h)
      for (const r of routes) {
        const label = labels[r.id]
        if (!label) continue
        let g = glyphCache.get(label)
        if (!g) { g = glyphTex(gl, label); glyphCache.set(label, g) }
        const scale = r.layer === 'game' ? 2 : 2
        const gw = g.w * scale * dpr, gh = g.h * scale * dpr
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tex)
        gl.uniform1i(lU('uTex'), 0)
        const isGame = r.layer === 'game'
        gl.uniform3f(lU('uCol'), isGame ? 0.35 : 1.0, isGame ? 0.8 : 0.86, isGame ? 1.0 : 0.55)
        const cx = r.layer === 'game' ? (r.rect.x + 10) * dpr : (r.rect.x + (r.rect.w - gw / dpr) / 2) * dpr
        const cy = (r.rect.y + (r.layer === 'game' ? 8 : (r.rect.h - gh / dpr) / 2)) * dpr
        gl.uniform4f(lU('uBox'), cx, cy, gw, gh)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => { stop = true; cancelAnimationFrame(raf) }
  }, [labels])
  return <canvas ref={ref} className="absolute inset-0 block" />
}
