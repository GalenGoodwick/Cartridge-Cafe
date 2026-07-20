// render-probe.mjs — the agent's eyes, WITHOUT a browser.
//
// The cafe engine is a WGSL uber-shader: a world is fields -> visuals composed
// into one shader that draws pixels. So to SEE a world we don't need Chrome +
// the whole Next app — we render that shader directly on Deno's native WebGPU
// (Metal, headless, milliseconds) and read the pixels back.
//
// Emits a PIXEL-STATE STRUCT (brightness, coverage, bbox, dominant colors,
// per-quadrant) that decides the whole dark/blank/off-screen failure class from
// numbers alone — AND a PNG for a vision-capable agent to cross-confirm the look.
// The two are derived from the SAME buffer, so they must agree: numbers can't be
// fooled perceptually, the picture can't be fooled by summary stats.
//
// Deno: deno run -A --unstable-webgpu tools/render-probe.mjs --state bm_state.json --name monster_scene --out probe.png --time 1.0
import { encode } from "npm:fast-png@6";

const A = {}; for (let i = 0; i < Deno.args.length; i += 2) A[Deno.args[i].replace(/^--/, "")] = Deno.args[i + 1];
const S = parseInt(A.size || "400");
const T = parseFloat(A.time || "1.0");
const state = JSON.parse(await Deno.readTextFile(A.state));
const fields = state.fields || [];
const visuals = state.visualTypes || [];
const modules = state.modules || [];

// pick the field to render: the named visual's field, else the first field w/ a visual
let field = null, vname = A.name || null;
for (const f of fields) { const n = f.visualTypeName || (typeof f.visualType === "string" ? f.visualType : null); if (n && (!vname || n === vname)) { field = f; vname = n; break; } }
if (!field && fields.length) { field = fields[0]; vname = field.visualTypeName; }
if (!vname) { console.log(JSON.stringify({ ok:false, errors:[{message:"no field with a visualType to render"}] })); Deno.exit(1); }
const vis = visuals.find(v => v.name === vname);
if (!vis) { console.log(JSON.stringify({ ok:false, errors:[{message:`visual "${vname}" not found`}] })); Deno.exit(1); }

const tr = field.transform || {};
const fx = tr.x ?? field.x ?? 256, fy = tr.y ?? field.y ?? 256;
const fw = field.w ?? 512, fh = field.h ?? 512;
const col = field.color || [1,1,1,1];
const uni = Array.isArray(state.worldData?.gpuUniforms) ? state.worldData.gpuUniforms : [];

// engine ISOLATES each visual for compile (a broken one quarantines alone, doesn't
// poison the rest), so the probe renders ONLY the target visual + shared modules.
const wgsl = `
${modules.map(m => m.wgsl).join("\n")}
${vis.wgsl}
fn uni(i: i32) -> f32 { return 0.0; }
fn uni4(i: i32) -> vec4f { return vec4f(0.0); }
struct U { outSize: f32, time: f32, fx: f32, fy: f32, fw: f32, fh: f32, cr: f32, cg: f32, cb: f32, ca: f32, bgr: f32, bgg: f32, bgb: f32, p0: f32, p1: f32, p2: f32 };
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f,3>(vec2f(-1.,-3.), vec2f(-1.,1.), vec2f(3.,1.));
  return vec4f(p[vi], 0., 1.);
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let grid = (fc.xy / vec2f(u.outSize, u.outSize)) * 512.0;
  let fmin = vec2f(u.fx - u.fw*0.5, u.fy - u.fh*0.5);
  let fmax = vec2f(u.fx + u.fw*0.5, u.fy + u.fh*0.5);
  if (grid.x < fmin.x || grid.y < fmin.y || grid.x > fmax.x || grid.y > fmax.y) { return vec4f(u.bgr,u.bgg,u.bgb,1.0); }
  let uv01 = (grid - fmin) / (fmax - fmin);
  let uv = vec2f(uv01.x*2.0 - 1.0, -(uv01.y*2.0 - 1.0));
  let o = visual_${vname}(uv, 0.0, vec4f(u.cr,u.cg,u.cb,u.ca), u.time, vec4f(0.0), vec4f(0.0));
  return vec4f(mix(vec3f(u.bgr,u.bgg,u.bgb), o.rgb, clamp(o.a,0.0,1.0)), 1.0);
}`;

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) { console.log(JSON.stringify({ ok:false, errors:[{message:"no GPU adapter"}] })); Deno.exit(2); }
const device = await adapter.requestDevice();
const errors = [];
device.pushErrorScope("validation");
const mod = device.createShaderModule({ code: wgsl });
for (const m of (await mod.getCompilationInfo()).messages) if (m.type === "error") errors.push({ line: m.lineNum, message: m.message });
let pipeline = null;
try { pipeline = device.createRenderPipeline({ layout:"auto", vertex:{module:mod,entryPoint:"vs"}, fragment:{module:mod,entryPoint:"fs",targets:[{format:"rgba8unorm"}]}, primitive:{topology:"triangle-list"} }); }
catch(e){ errors.push({message:"pipeline: "+e.message}); }
const se = await device.popErrorScope(); if (se) errors.push({message:String(se.message||se)});
if (!pipeline || errors.length) { console.log(JSON.stringify({ ok:false, errors, visual:vname })); Deno.exit(1); }

const tex = device.createTexture({ size:[S,S], format:"rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC });
const ubuf = device.createBuffer({ size:64, usage: GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });
const bg = [0.03,0.02,0.04];
device.queue.writeBuffer(ubuf, 0, new Float32Array([S,T,fx,fy,fw,fh,col[0],col[1],col[2],col[3]??1,bg[0],bg[1],bg[2],0,0,0]));
const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries:[{binding:0,resource:{buffer:ubuf}}] });
const bpr = Math.ceil(S*4/256)*256;
const rb = device.createBuffer({ size:bpr*S, usage: GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ });
const enc = device.createCommandEncoder();
const pass = enc.beginRenderPass({ colorAttachments:[{view:tex.createView(),loadOp:"clear",storeOp:"store",clearValue:{r:0,g:0,b:0,a:1}}] });
pass.setPipeline(pipeline); pass.setBindGroup(0,bind); pass.draw(3); pass.end();
enc.copyTextureToBuffer({texture:tex},{buffer:rb,bytesPerRow:bpr,rowsPerImage:S},[S,S,1]);
device.queue.submit([enc.finish()]);
await rb.mapAsync(GPUMapMode.READ);
const raw = new Uint8Array(rb.getMappedRange());

// ---- pixel-state struct ----
const data = new Uint8Array(S*S*4);
const bgb = [Math.round(bg[0]*255),Math.round(bg[1]*255),Math.round(bg[2]*255)];
const isBg = (r,g,b) => Math.abs(r-bgb[0])+Math.abs(g-bgb[1])+Math.abs(b-bgb[2]) < 26;
let lumSum=0,lumMax=0,cover=0; let minX=S,minY=S,maxX=0,maxY=0; const hist={}; const quad=[0,0,0,0],quadN=[0,0,0,0];
for (let y=0;y<S;y++) for (let x=0;x<S;x++){
  const s=y*bpr+x*4,d=(y*S+x)*4; const r=raw[s],g=raw[s+1],b=raw[s+2];
  data[d]=r;data[d+1]=g;data[d+2]=b;data[d+3]=255;
  const l=Math.max(r,g,b); lumSum+=l; if(l>lumMax)lumMax=l;
  const q=(y<S/2?0:2)+(x<S/2?0:1); quad[q]+=l; quadN[q]++;
  if(!isBg(r,g,b)){ cover++; if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y;
    hist[`${r>>6},${g>>6},${b>>6}`]=(hist[`${r>>6},${g>>6},${b>>6}`]||0)+1; }
}
const N=S*S;
const dom=Object.entries(hist).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,v])=>({rgb:k.split(",").map(n=>+n*64+32),pct:+(100*v/N).toFixed(1)}));
const out = A.out || "/tmp/render-probe.png";
await Deno.writeFile(out, encode({width:S,height:S,data,channels:4}));
const struct = {
  ok:true, visual:vname, errors:[],
  meanLum:+(lumSum/N).toFixed(1), maxLum:lumMax,
  coveragePct:+(100*cover/N).toFixed(1),
  visible: cover/N > 0.005,
  bbox: cover? {x:minX,y:minY,w:maxX-minX,h:maxY-minY, centeredX:+((minX+maxX)/2/S).toFixed(2), centeredY:+((minY+maxY)/2/S).toFixed(2)} : null,
  offscreenHint: cover && (maxX-minX < S*0.15 || maxY-minY < S*0.15 || minX>S*0.7 || maxX<S*0.3) ? "content tiny or hugging an edge — likely mis-placed" : null,
  quadrantLum: quad.map((q,i)=>+(q/quadN[i]).toFixed(0)),
  dominantColors: dom,
  png: out,
};
console.log(JSON.stringify(struct));
