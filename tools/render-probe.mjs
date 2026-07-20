// render-probe.mjs — the agent's eyes, WITHOUT a browser (CLI wrapper).
//
// All the rendering lives in ../render-service/render-core.mjs (one source,
// shared with the Railway HTTP service). This wrapper just does file I/O:
// read the --state json, render, write the PNG, print the struct as one JSON
// line. cafe_probe (the co-located MCP) spawns this and reads that line + PNG.
//
// Deno: deno run -A --unstable-webgpu tools/render-probe.mjs --state s.json [--name v] [--out o.png] [--ticks 45] [--samples 6] [--input auto]
import { renderProbe } from "../render-service/render-core.mjs";

const A = {}; for (let i = 0; i < Deno.args.length; i += 2) A[Deno.args[i].replace(/^--/, "")] = Deno.args[i + 1];
const state = JSON.parse(await Deno.readTextFile(A.state));
const out = A.out || "/tmp/render-probe.png";

const r = await renderProbe(state, { name: A.name, ticks: A.ticks, samples: A.samples, size: A.size, time: A.time, input: A.input });

if (r.ok && r.png) await Deno.writeFile(out, r.png);
// the struct line must not carry the raw PNG bytes — hand back the file path instead
const { png, ...struct } = r;
console.log(JSON.stringify({ ...struct, png: r.ok ? out : null }));
if (!r.ok) Deno.exit(1);
