// GPU render-check for cafe visuals — Deno native WebGPU (Metal, headless).
// Compiles a visual shader the way the engine would, renders ONE frame, and
// reports: compile errors, whether the output is blank/uniform, and a PNG.
// This is the "check" the bridge should own: build -> CHECK -> fix -> repeat.
// Usage: deno run --unstable-webgpu --allow-read --allow-write --allow-env \
//   tools/wgsl-render-check.mjs --module mod.wgsl --visual vis.wgsl --name monster --time 1.0 --out out.png
import { encode } from "npm:fast-png@6";

const args = {};
for (let i = 0; i < Deno.args.length; i += 2) args[Deno.args[i].replace(/^--/, "")] = Deno.args[i + 1];
const S = parseInt(args.size || "320");
const T = parseFloat(args.time || "1.0");
const moduleWgsl = args.module ? await Deno.readTextFile(args.module) : "";
const visualWgsl = args.visual ? await Deno.readTextFile(args.visual) : (args.visualInline || "");
const name = args.name || "monster";

const wgsl = `
${moduleWgsl}
${visualWgsl}
fn uni(i: i32) -> f32 { return 0.0; }
fn uni4(i: i32) -> vec4f { return vec4f(0.0); }
struct U { time: f32, sx: f32, sy: f32, pad: f32 };
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f,3>(vec2f(-1.,-3.), vec2f(-1.,1.), vec2f(3.,1.));
  return vec4f(p[vi], 0., 1.);
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv0 = (fc.xy / vec2f(u.sx, u.sy)) * 2.0 - 1.0;
  let uv = vec2f(uv0.x, -uv0.y);
  return visual_${name}(uv, 0.0, vec4f(1.0), u.time, vec4f(0.0), vec4f(0.0));
}`;

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) { console.log(JSON.stringify({ ok:false, errors:[{message:"no GPU adapter"}] })); Deno.exit(2); }
const device = await adapter.requestDevice();
const errors = [];
device.pushErrorScope("validation");
const module = device.createShaderModule({ code: wgsl });
const info = await module.getCompilationInfo();
for (const m of info.messages) if (m.type === "error") errors.push({ line: m.lineNum, message: m.message });

const fmt = "rgba8unorm";
let pipeline = null;
try {
  pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: fmt }] },
    primitive: { topology: "triangle-list" },
  });
} catch (e) { errors.push({ message: "pipeline: " + e.message }); }
const scopeErr = await device.popErrorScope();
if (scopeErr) errors.push({ message: String(scopeErr.message || scopeErr) });

if (!pipeline || errors.length) { console.log(JSON.stringify({ ok:false, errors })); Deno.exit(errors.length?1:2); }

const tex = device.createTexture({ size:[S,S], format:fmt, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
const ubuf = device.createBuffer({ size:16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(ubuf, 0, new Float32Array([T, S, S, 0]));
const bg = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries:[{binding:0, resource:{buffer:ubuf}}] });
const bytesPerRow = Math.ceil(S*4/256)*256;
const rbuf = device.createBuffer({ size: bytesPerRow*S, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
const enc = device.createCommandEncoder();
const pass = enc.beginRenderPass({ colorAttachments:[{ view: tex.createView(), loadOp:"clear", storeOp:"store", clearValue:{r:0,g:0,b:0,a:1} }] });
pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
enc.copyTextureToBuffer({ texture: tex }, { buffer: rbuf, bytesPerRow, rowsPerImage: S }, [S,S,1]);
device.queue.submit([enc.finish()]);
await rbuf.mapAsync(GPUMapMode.READ);
const raw = new Uint8Array(rbuf.getMappedRange());
// tight-pack rows + stats
const data = new Uint8Array(S*S*4);
const hist = {};
let lumSum = 0;
for (let y=0;y<S;y++) for (let x=0;x<S;x++){
  const s = y*bytesPerRow + x*4, d=(y*S+x)*4;
  data[d]=raw[s]; data[d+1]=raw[s+1]; data[d+2]=raw[s+2]; data[d+3]=255;
  lumSum += Math.max(raw[s],raw[s+1],raw[s+2]);
  const key = `${raw[s]>>5},${raw[s+1]>>5},${raw[s+2]>>5}`; hist[key]=(hist[key]||0)+1;
}
const png = encode({ width:S, height:S, data, channels:4 });
const out = args.out || "/tmp/wgsl-check.png";
await Deno.writeFile(out, png);
const distinct = Object.keys(hist).length;
console.log(JSON.stringify({ ok:true, errors:[], out, meanLum:+(lumSum/(S*S)).toFixed(1), distinctColorBuckets:distinct, blank: distinct<=2 }));
