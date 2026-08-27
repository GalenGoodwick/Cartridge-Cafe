'use client'

// FIT SHADER — a shader that KNOWS ITS OWN SHAPE and recomposes (Galen: the
// hard-right path I dodged with a crop hack). No LiveArt, no square-and-crop:
// the canvas' drawing buffer matches its container's REAL pixel size (via
// ResizeObserver + devicePixelRatio), and the fragment shader reads that size
// to lay out its composition ISOTROPICALLY — so circles stay circles at any
// aspect (no squish), the composition FILLS the box (no letterbox), and the
// content it draws reflows to the shape instead of being chopped (no crop).
//
// THE PROOF is deliberately unforgiving: a big centered RING + a grid of round
// DOTS. If the box distorts them, they become ellipses (squish). If it samples
// a fixed square, the ring's top/bottom vanish (crop). Correct = round
// everywhere, grid reflows to fill whatever shape it's handed.
import { useEffect, useRef } from 'react'

const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;      // the REAL box size in device pixels — the shader's shape sense
uniform float uTime;
out vec4 o;
void main(){
  vec2 fc = gl_FragCoord.xy;
  float shortSide = min(uRes.x, uRes.y);
  // ISOTROPIC coords: divide BOTH axes by the SAME scalar → 1 unit is the same
  // length horizontally and vertically. This is the whole trick: a circle is a
  // circle at any aspect. The LONG axis simply spans more units (you see MORE of
  // the world, not a stretched world — the cover-camera, honestly).
  vec2 uv = (fc - 0.5 * uRes) / shortSide;

  // backdrop
  vec3 col = mix(vec3(0.03,0.04,0.09), vec3(0.10,0.09,0.22), 0.5 + 0.5*sin(uv.y*3.0 + uTime*0.3));

  // GRID OF PERFECT DOTS — reflows to fill the actual box (more columns when
  // wide, more rows when tall). Round because the space is isotropic.
  float cell = 0.2;
  vec2 f = fract(uv/cell) - 0.5;
  float dot = smoothstep(0.02, -0.02, length(f) - 0.16);
  float hue = 0.5 + 0.5*sin(floor(uv.x/cell)*1.3 + floor(uv.y/cell)*0.7 + uTime);
  col = mix(col, vec3(0.35 + 0.5*hue, 0.28, 0.72), dot*0.55);

  // THE CENTERED RING — a perfect circle at ANY box shape. Kept inside the
  // short axis (radius 0.4 < 0.5) so it is never cropped — the "safe zone".
  float ring = abs(length(uv) - 0.4);
  col += vec3(0.45,0.8,1.0) * smoothstep(0.012, 0.0, ring) * 1.4;
  // a smaller pulsing core proves the center is truly center at any aspect
  col += vec3(1.0,0.7,0.35) * smoothstep(0.09, 0.0, length(uv)) * (0.6 + 0.4*sin(uTime*2.0));

  // CORNER BRACKETS pinned to the REAL corners (screen-space, fixed 22px) —
  // proves the shader uses the true box, not a normalized square.
  vec2 e = min(fc, uRes - fc);            // px distance to nearest edges
  float armLen = 34.0, armThick = 3.0;
  float bx = step(e.x, armThick) * step(e.y, armLen);
  float by = step(e.y, armThick) * step(e.x, armLen);
  col = mix(col, vec3(1.0,0.85,0.4), clamp(bx + by, 0.0, 1.0));

  o = vec4(col, 1.0);
}`

export function FitShader() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const gl = cv.getContext('webgl2', { antialias: true })
    if (!gl) return
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn('shader', gl.getShaderInfoLog(s))
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog); gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const uRes = gl.getUniformLocation(prog, 'uRes')
    const uTime = gl.getUniformLocation(prog, 'uTime')

    let raf = 0, stop = false
    const parent = cv.parentElement!
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(parent.clientWidth * dpr))
      const h = Math.max(1, Math.round(parent.clientHeight * dpr))
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
    }
    const ro = new ResizeObserver(fit); ro.observe(parent); fit()
    const t0 = performance.now()
    const draw = () => {
      if (stop) return
      fit()
      gl.viewport(0, 0, cv.width, cv.height)
      gl.uniform2f(uRes, cv.width, cv.height)
      gl.uniform1f(uTime, (performance.now() - t0) / 1000)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => { stop = true; cancelAnimationFrame(raf); ro.disconnect() }
  }, [])
  return <canvas ref={ref} className="absolute inset-0 w-full h-full block" />
}
