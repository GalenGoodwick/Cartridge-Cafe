// server.mjs — the eyes as a cloud service (Deno, on Railway).
//
// The only GPU-capable place a user's own AI can reach without installing
// anything. It renders the cafe uber-shader in SOFTWARE (Mesa lavapipe — see
// Dockerfile), so it needs no real GPU. The Vercel bridge calls this
// server-to-server on `render_probe` and hands the picture straight back.
//
//   POST /render   { state, name?, ticks?, samples?, size? }  ->  { ...struct, image }
//   POST /clip     { state, name?, frames?, fps?, size? }     ->  { ...struct, video }
//   GET  /health   -> "ok"
//
// /clip renders a sequence of frames across the loop and stitches them into an
// h264 mp4 with ffmpeg (see Dockerfile) — the video a world's own AI can post
// to Bluesky. Same auth as /render.
//
// AUTH: a shared secret (RENDER_SECRET). Only the bridge holds it, so this
// endpoint can't be used as a free render farm. If unset, the server refuses
// to start — an open renderer is a DoS foothold.
import { renderProbe } from "./render-core.mjs";
import { encodeBase64 } from "jsr:@std/encoding/base64";

const PORT = parseInt(Deno.env.get("PORT") || "8080");
const SECRET = Deno.env.get("RENDER_SECRET") || "";
if (!SECRET) { console.error("RENDER_SECRET is required — refusing to start an open renderer"); Deno.exit(1); }

// Warm the adapter once at boot so the first real request isn't paying for
// software-Vulkan init (and so a broken GPU stack fails loudly on deploy).
try {
  const warm = await renderProbe(
    { fields: [{ id: "w", name: "w", visualTypeName: "warm", transform: { x: 256, y: 256 }, w: 512, h: 512, color: [1, 1, 1, 1] }],
      visualTypes: [{ name: "warm", wgsl: "fn visual_warm(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f { return vec4f(0.5, 0.2, 0.1, 1.0 - length(uv)); }" }],
      modules: [], worldData: {}, stepHooks: [] },
    { ticks: 0, size: 64 },
  );
  console.log(warm.ok ? "render backend warm — adapter OK" : `render backend WARN — ${JSON.stringify(warm.errors)}`);
} catch (e) { console.error("render backend FAILED to warm:", e?.message || e); }

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    return new Response("ok", { status: 200 });
  }
  const isClip = url.pathname === "/clip";
  if (req.method !== "POST" || (url.pathname !== "/render" && !isClip)) {
    return new Response("not found", { status: 404 });
  }
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${SECRET}`) return new Response("unauthorized", { status: 401 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const state = body.state || body;   // accept {state:{...}} or the bare state
  if (!state || !Array.isArray(state.fields)) {
    return Response.json({ ok: false, error: "expected { state: { fields, visualTypes, worldData, stepHooks } }" }, { status: 400 });
  }

  if (isClip) {
    const frames = Math.max(2, Math.min(240, parseInt(body.frames ?? 150)));
    const fps = Math.max(6, Math.min(60, parseInt(body.fps ?? 30)));
    const size = Math.max(64, Math.min(512, parseInt(body.size ?? 400)));
    // the HANDS — a showcase clip should show the world being PLAYED, not sitting
    // still. Default to 'auto' (holds right + sweeps the cursor across the grid)
    // and drive input from frame 1 (no baseline third). Pass input:null for a
    // hands-off ambient clip.
    const input = body.input === null ? null : (body.input ?? "auto");
    try {
      // one tick per frame so motion advances smoothly across the loop
      const r = await renderProbe(state, { name: body.name, ticks: frames, frames, size, ...(input ? { input, inputStart: 1 } : {}) });
      if (!r.ok || !Array.isArray(r.frames) || !r.frames.length) {
        return Response.json({ ok: false, error: "no frames rendered", errors: r.errors }, { status: 500 });
      }
      const { frames: pngs, png: _png, ...struct } = r;
      const mp4 = await encodeMp4(pngs, fps);
      return Response.json({ ...struct, video: encodeBase64(mp4), videoMime: "video/mp4", frameCount: pngs.length, fps });
    } catch (e) {
      return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
    }
  }

  try {
    const r = await renderProbe(state, { name: body.name, ticks: body.ticks, samples: body.samples, size: body.size, time: body.time, input: body.input });
    const { png, frames: _frames, ...struct } = r;
    return Response.json({ ...struct, image: r.ok && png ? encodeBase64(png) : null, imageMime: "image/png" });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
});

// Stitch a PNG sequence into an h264 mp4 via ffmpeg. mp4 needs a seekable
// output for the moov atom (+faststart), so we write to a temp file and read it
// back rather than piping stdout.
async function encodeMp4(pngs, fps) {
  const tmp = await Deno.makeTempFile({ suffix: ".mp4" });
  try {
    const cmd = new Deno.Command("ffmpeg", {
      args: [
        "-y", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-an", tmp,
      ],
      stdin: "piped", stdout: "null", stderr: "piped",
    });
    const child = cmd.spawn();
    const w = child.stdin.getWriter();
    for (const f of pngs) await w.write(f);
    await w.close();
    const { code, stderr } = await child.output();
    if (code !== 0) throw new Error("ffmpeg failed: " + new TextDecoder().decode(stderr).split("\n").slice(-6).join(" "));
    return await Deno.readFile(tmp);
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
}

console.log(`render-service listening on :${PORT}`);
