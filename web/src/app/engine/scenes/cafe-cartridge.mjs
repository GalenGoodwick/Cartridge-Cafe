// CAFE — the front door is a world. Seven cartridges float in the dark, each a
// living miniature of its game. Your cursor is a lens; hover blooms a portal;
// click steps through it. No webpage. Save+load: node cafe-cartridge.mjs

const WORLD = /* wgsl */`
fn cf_stars(p: vec2f, t: f32) -> vec3f {
  var c = vec3f(0.008, 0.007, 0.016);
  c += vec3f(0.05, 0.025, 0.09) * smoothstep(0.4, 0.9, fbm(p * 1.5 + vec2f(t * 0.004, 0.0), 4));
  for (var l = 0; l < 2; l++) {
    let fl = f32(l);
    let sp = p * (16.0 + fl * 26.0) + fl * 31.0;
    let cell = floor(sp);
    let h = hash21(cell);
    let fp = fract(sp) - 0.5;
    let tw = 0.5 + 0.5 * sin(t * (0.5 + h * 1.4) + h * 40.0);
    c += vec3f(0.8, 0.75, 0.95) * step(0.985, h) * smoothstep(0.24, 0.03, length(fp)) * tw * (1.1 - fl * 0.4);
  }
  return c;
}

// bit (c,r) of the SYMMETRIC pixel-art arrow. Columns are centered (c=0 is the
// middle column), so the shape is mirror-symmetric: bit(c,r) == bit(-c,r). Rows
// run downward from the tip. It's a triangular head (rows 0-5) over a straight
// stem (rows 6-12); hw[r] is each row's half-width in pixels.
fn cf_curbit(c: i32, r: i32) -> f32 {
  if (r < 0 || r > 12) { return 0.0; }
  var hw = array<i32, 13>(0, 1, 2, 3, 4, 5, 1, 1, 1, 1, 1, 1, 1);
  if (abs(c) <= hw[r]) { return 1.0; }
  return 0.0;
}

// DEFAULT CURSOR (fx 5) — the un-brewed look: a crisp 8-BIT arrow, rendered
// nearest-neighbor from a bitmap so it reads as intentional pixel art (fits the
// retro cafe). SYMMETRIC: points straight up, mirror-symmetric about its
// vertical axis. White fill, a 1-pixel black outline. The TIP is the top-center
// pixel at the local origin = the real selection point. No strobe, no wobble.
// Returns (rgb, coverage); the caller mixes it over the scene. Screen +y is down.
fn cf_defcursor(local0: vec2f, phase: f32) -> vec4f {
  let cell = 0.11;                             // size of one art-pixel in local units
  let c = i32(floor(local0.x / cell + 0.5));   // centered columns (c=0 straddles x=0)
  let r = i32(floor(local0.y / cell));         // rows down from the tip
  let solid = cf_curbit(c, r);
  // outline = an empty cell touching the silhouette (8-neighbourhood)
  var nb = max(max(cf_curbit(c - 1, r), cf_curbit(c + 1, r)), max(cf_curbit(c, r - 1), cf_curbit(c, r + 1)));
  nb = max(nb, max(max(cf_curbit(c - 1, r - 1), cf_curbit(c + 1, r - 1)), max(cf_curbit(c - 1, r + 1), cf_curbit(c + 1, r + 1))));
  let outline = (1.0 - solid) * step(0.5, nb);
  if (solid > 0.5) { return vec4f(0.97, 0.97, 1.0, 1.0); }         // white body
  if (outline > 0.5) { return vec4f(0.05, 0.05, 0.08, 1.0); }      // black outline
  return vec4f(0.0);
}

// A PLAYER — a bounded, directional glow. Meant to become programmable (an
// effect id + params + facing, brewed per person); for now a hardcoded Glow with
// a nose + pupil so its direction reads. local: offset from the player center,
// ~1.0 at the edge. dir: unit facing. Returns additive rgb.
fn cf_player(local0: vec2f, dir: vec2f, phase: f32, fx: i32, tint: vec3f) -> vec3f {
  // DANCE — bob, sway, squash-and-stretch on this player's own beat. A groove
  // in place, never a spin. dir is the base facing (the groove leans around it).
  let bob = sin(phase * 3.1) * 0.16;                 // up-down
  let sway = sin(phase * 2.2 + 0.6) * 0.17;          // side-to-side
  let squash = 1.0 + 0.17 * sin(phase * 6.0);        // pulse
  let fdir = normalize(dir + vec2f(0.0, 0.0001));    // guard the zero vector
  let side = vec2f(-fdir.y, fdir.x);
  var local = local0 - fdir * bob - side * sway;     // move the body as it dances
  local = vec2f(local.x * squash, local.y / squash); // squash & stretch
  let d2 = dot(local, local);
  let fwd = max(0.0, dot(local, fdir));              // ahead of center, along the facing
  let body = exp(-d2 * 5.0);                         // round glow body
  let nose = fwd * exp(-d2 * 2.2);                   // stretches the glow toward the facing
  // LOOK — brewed per player. 0 comet · 1 ring · 2 eyes · 3 spark.
  if (fx == 1) {
    let r = abs(sqrt(d2) - 0.5);                     // a dancing ring
    return tint * exp(-r * r * 45.0) * 1.7;
  }
  if (fx == 2) {
    let el = local - side * 0.30 - fdir * 0.10;      // two eyes, looking along the facing
    let er = local + side * 0.30 - fdir * 0.10;
    let eyes = exp(-dot(el, el) * 55.0) + exp(-dot(er, er) * 55.0);
    return tint * body * 1.2 + vec3f(1.0, 0.98, 0.9) * eyes * 0.8;
  }
  if (fx == 3) {
    let ang = atan2(local.y, local.x);               // a five-point spark, spinning on its beat
    let star = pow(max(0.0, cos(ang * 5.0 + phase * 2.0)), 6.0);
    return tint * exp(-d2 * 3.0) * (0.5 + star * 1.4) * 1.5;
  }
  if (fx == 4) {
    // THE WALKING CUP — a cream cup with a handle, striding on stub legs.
    // Drawn solid over the glow layer; tint only warms the steam. All motion
    // rides the same slow dance phase — no strobe, no flash.
    let wt = phase * 0.9;
    let lean = 0.07 * sin(wt);
    var q = local0;
    q = vec2f(q.x * cos(lean) + q.y * sin(lean), -q.x * sin(lean) + q.y * cos(lean));
    q.y = q.y + 0.05 * abs(sin(wt)) - 0.06;
    var cup = vec3f(0.0);
    var cov = 0.0;
    // two stub legs, half a phase apart (screen +y is down)
    for (var li: i32 = 0; li < 2; li++) {
      let lph = wt + f32(li) * 3.14159;
      let hip = vec2f(-0.11 + 0.22 * f32(li), 0.34);
      let foot = vec2f(hip.x + 0.11 * sin(lph), 0.56 - 0.07 * max(0.0, sin(lph + 1.5708)));
      let pa = q - hip; let ba = foot - hip;
      let hseg = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
      let dleg = length(pa - ba * hseg) - 0.055;
      let mleg = smoothstep(0.02, -0.02, dleg);
      cup = mix(cup, vec3f(0.93, 0.88, 0.80), mleg); cov = max(cov, mleg);
      let dboot = length(q - foot - vec2f(0.02, 0.02)) - 0.07;
      let mboot = smoothstep(0.02, -0.02, dboot);
      cup = mix(cup, vec3f(0.42, 0.27, 0.16), mboot); cov = max(cov, mboot);
    }
    // body — rounded box; handle — a ring on the right
    let bq = abs(q - vec2f(0.0, 0.0)) - vec2f(0.30, 0.32) + vec2f(0.12);
    let dbody = length(max(bq, vec2f(0.0))) + min(max(bq.x, bq.y), 0.0) - 0.12;
    let dring = abs(length(q - vec2f(0.40, 0.02)) - 0.13) - 0.05;
    let dcup = min(dbody, dring);
    let mcup = smoothstep(0.02, -0.02, dcup);
    cup = mix(cup, vec3f(0.95, 0.91, 0.84), mcup); cov = max(cov, mcup);
    // rim band + coffee at the top (up is -y)
    let rq = abs(q - vec2f(0.0, -0.30)) - vec2f(0.295, 0.055);
    let drim = max(rq.x, rq.y);
    let mrim = smoothstep(0.015, -0.015, drim) * mcup;
    cup = mix(cup, vec3f(0.34, 0.20, 0.11), mrim);
    // sleepy face — two happy-closed eyes and a small smile, inked into the cream
    let deL = length((q - vec2f(-0.12, -0.06)) * vec2f(1.0, 1.8)) - 0.045;
    let deR = length((q - vec2f(0.12, -0.06)) * vec2f(1.0, 1.8)) - 0.045;
    let dsm = length((q - vec2f(0.0, 0.10)) * vec2f(1.0, 1.6)) - 0.06;
    let dsm2 = length((q - vec2f(0.0, 0.06)) * vec2f(1.0, 1.6)) - 0.075;
    let face = max(smoothstep(0.012, -0.012, deL), max(smoothstep(0.012, -0.012, deR),
               smoothstep(0.012, -0.012, dsm) * smoothstep(-0.012, 0.012, dsm2)));
    cup = mix(cup, vec3f(0.30, 0.19, 0.12), face * mcup);
    // steam — two faint wisps rising on the slow beat, tinted by the brew
    var steam = vec3f(0.0);
    for (var si: i32 = 0; si < 2; si++) {
      let fsi = f32(si);
      let rise = fract(phase * 0.05 + fsi * 0.5);
      let wp = vec2f((fsi - 0.5) * 0.16 + 0.05 * sin(phase * 0.4 + fsi * 2.0 + rise * 5.0), -0.45 - rise * 0.42);
      let ds = dot(q - wp, q - wp);
      steam += (vec3f(0.75, 0.72, 0.68) + tint * 0.25) * exp(-ds * 70.0) * (1.0 - rise) * rise * 3.2 * 0.35;
    }
    // solid cup over a soft warm halo; additive-safe (bounded, calm)
    let halo = tint * exp(-d2 * 2.4) * 0.22;
    return cup * 1.9 + steam + halo * (1.0 - cov);
  }
  // 0: comet glow (default)
  let g = body * 1.3 + nose * 1.6;
  let eye = local - fdir * 0.30;                     // a pupil pushed forward — a clear aim
  let pupil = exp(-dot(eye, eye) * 55.0) * body;
  return tint * g + vec3f(1.0, 0.98, 0.9) * pupil * 0.8;
}

// author-caption char: each bubble's maker handle is packed 16 chars (4 vec4f)
// in the population buffer; return the c-th char code (0..15) of bubble i. 0 = end.
fn cf_popc(i: i32, c: i32) -> i32 {
  let pv = pop(i * 4 + c / 4);
  let m = c % 4;
  var v = pv.x;
  if (m == 1) { v = pv.y; } else if (m == 2) { v = pv.z; } else if (m == 3) { v = pv.w; }
  return i32(v + 0.5);
}

fn visual_cf_world(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = time;
  let mp = vec2f(uni(4), uni(5));     // cursor (uv coords)
  let cam = vec2f(uni(0), uni(1));
  let zm = uni(2);

  // ── the room: stars seen through curved space (your cursor is a lens) ──
  var p = uv;
  let md = uv - mp;
  let mr2 = max(dot(md, md), 0.002);
  p -= md * (0.010 / mr2) * smoothstep(0.9, 0.2, length(md));
  var col = cf_stars(p, t);

  // warm hearth-light from below — this is a cafe, not a void
  col += vec3f(0.10, 0.055, 0.02) * pow(max(0.0, uv.y + 0.2), 2.0) * (0.8 + 0.2 * sin(t * 0.7));

  // ── the bubble universe: live positions, pressure-ranked, explorable ──
  for (var i = 0; i < i32(uni(3) + 0.5); i++) {
    let sv = uni(8 + i * 4);
    let stRaw = i32(floor(sv));
    let bigBand = stRaw / 400;          // 0 normal · 1 champion (big + its OWN icon) · 2 sub-mains · 3 player-worlds
    let big = select(0, 1, bigBand > 0);
    let ab = stRaw % 400;
    let st = ab % 200;
    let hue = fract(sv);
    let rawHead00 = uni(9 + i * 4);
    let isDocked = rawHead00 > 7999.5;               // +8000 flags THE DOCK — where the player is moored
    let rawHead0 = select(rawHead00, rawHead00 - 8000.0, isDocked);
    let isPlayerWorld = rawHead0 > 3999.5;           // +4000 flags a PLAYER WORLD (a space) → green rim
    let r1 = select(rawHead0, rawHead0 - 4000.0, isPlayerWorld);
    let isBranch = r1 > 1999.5;                       // +2000 flags a BRANCH → blue rim
    let rawHead = select(r1, r1 - 2000.0, isBranch);
    let unvisited = rawHead > 900.5;                 // +1000 offset flags a world this browser hasn't entered
    let headCount = i32(select(rawHead, rawHead - 1000.0, unvisited) + 0.5);
    let ctr = vec2f((uni(6 + i * 4) - cam.x) * zm / 256.0, (uni(7 + i * 4) - cam.y) * zm / 256.0);
    let d = length(uv - ctr);
    let R = 0.098 * zm * select(1.0, 1.25, big > 0);
    let hov = smoothstep(R * 1.9, R * 1.1, length(mp - ctr));
    let rr = R * (1.0 + hov * 0.12);
    if (d < rr) {
      let q = (uv - ctr) / rr;                     // -1..1 inside the disc
      var g = vec3f(0.0);
      if (bigBand == 2) {
        // SUB-MAINS — five gatherings around one hearth, threads of light between
        let cA = 0.5 + 0.5 * cos(6.2831 * (hue + vec3f(0.0, 0.33, 0.67)));
        g = vec3f(0.015, 0.02, 0.045);
        g += cA * exp(-dot(q, q) * 9.0) * 0.9;
        for (var k = 0; k < 5; k++) {
          let ak = f32(k) * 1.2566 + t * 0.15;
          let dirk = vec2f(cos(ak), sin(ak));
          let tt = clamp(dot(q, dirk), 0.0, 0.52);
          let sd2 = length(q - dirk * tt);
          g += cA * exp(-sd2 * sd2 * 900.0) * 0.3;
          let hk = 0.5 + 0.5 * cos(6.2831 * (f32(k) * 0.2 + 0.05 + vec3f(0.0, 0.33, 0.67)));
          let nd = length(q - dirk * 0.52);
          g += hk * exp(-nd * nd * 260.0) * 1.5;
          g += hk * exp(-nd * nd * 55.0) * 0.25;
        }
      } else if (bigBand == 3) {
        // PLAYER WORLDS — a hand-made planet, its makers orbiting on a tilted ring
        let cA = 0.5 + 0.5 * cos(6.2831 * (hue + vec3f(0.0, 0.33, 0.67)));
        let pd = length(q);
        let surf = fbm3(q * 4.0 + vec2f(t * 0.05, 0.0));
        let bands = 0.6 + 0.4 * sin(q.y * 9.0 + surf * 3.0);
        var pc = cA * (0.35 + 0.6 * bands * (0.45 + surf * 0.6));
        pc *= smoothstep(0.47, 0.43, pd);
        pc *= 0.8 + 0.4 * clamp(1.0 - length(q - vec2f(-0.2, -0.2)), 0.0, 1.0);
        g = pc;
        let rq = vec2f(q.x, q.y * 2.6 + q.x * 0.4);
        g += cA * smoothstep(0.05, 0.0, abs(length(rq) - 0.74)) * 0.4;
        for (var k = 0; k < 3; k++) {
          let ak = t * 0.6 + f32(k) * 2.094;
          let op = vec2f(cos(ak) * 0.74, sin(ak) * 0.285 - cos(ak) * 0.11);
          let hk = 0.5 + 0.5 * cos(6.2831 * (f32(k) * 0.3 + 0.55 + vec3f(0.0, 0.33, 0.67)));
          let od = length(q - op);
          g += hk * exp(-od * od * 300.0) * 1.6;
        }
      } else if (bigBand == 4) {
        // THE HOUSE — a warm little cottage with a lit window (unclaimed worlds)
        let cA = 0.5 + 0.5 * cos(6.2831 * (hue + vec3f(0.0, 0.33, 0.67)));
        g = vec3f(0.02, 0.02, 0.03);
        // body: a square below, roof: a triangle above
        let body = step(abs(q.x), 0.42) * step(-0.05, q.y) * step(q.y, 0.5);
        let roof = step(abs(q.x) + (q.y + 0.05) * 0.95, 0.5) * step(q.y, -0.05) * step(-0.6, q.y);
        let house = clamp(body + roof, 0.0, 1.0);
        g = mix(g, vec3f(0.55, 0.3, 0.14) * (0.8 + 0.3 * cA), house);
        // the lit window — a warm hearth glow
        let win = step(abs(q.x - 0.0), 0.13) * step(0.08, q.y) * step(q.y, 0.34);
        g += vec3f(1.0, 0.78, 0.35) * win * (0.9 + 0.2 * sin(t * 1.8));
        g += vec3f(1.0, 0.7, 0.3) * exp(-dot(q - vec2f(0.0, 0.2), q - vec2f(0.0, 0.2)) * 8.0) * 0.25;
      } else if (st >= 30 && st <= 34) {
        // a MAKER bubble wearing the player's BREWED avatar (preset fx 0-4)
        let cA = 0.5 + 0.5 * cos(6.2831 * (hue + vec3f(0.0, 0.33, 0.67)));
        g = cA * 0.10 + vec3f(0.02);
        g += cf_player(q * 2.4, vec2f(0.0, 1.0), t * 1.4, st - 30, cA * 1.5) * 1.6;
        g += cA * exp(-dot(q, q) * 3.5) * 0.35;   // a soft aura in their hue
      } else if (st == 0) {
        // FABRIC — a lens wandering through stars
        var pp = q * 2.0;
        let lc = vec2f(sin(t * 0.6) * 0.5, cos(t * 0.47) * 0.4);
        let ld = pp - lc;
        pp -= ld * (0.16 / max(dot(ld, ld), 0.02));
        g = cf_stars(pp * 1.6, t) * 2.2;
        g += vec3f(0.5, 0.9, 1.1) * exp(-dot(ld, ld) * 14.0) * 0.4;
      } else if (st == 1) {
        // ORRERY — three worlds around a coal
        g = vec3f(0.02, 0.015, 0.03);
        g += vec3f(3.0, 1.7, 0.5) * exp(-dot(q, q) * 30.0);
        for (var k = 1; k <= 3; k++) {
          let fk = f32(k);
          let a = t * (0.9 - fk * 0.18) + fk * 2.1;
          let pp = q - vec2f(cos(a), sin(a)) * (0.22 + fk * 0.17);
          var pc = vec3f(0.45, 0.5, 0.65);
          if (k == 2) { pc = vec3f(0.2, 0.45, 0.8); }
          if (k == 3) { pc = vec3f(0.8, 0.5, 0.25); }
          g += pc * exp(-dot(pp, pp) * 260.0) * 1.6;
        }
      } else if (st == 2) {
        // GARNET — the crystal
        let qa = rotate(q, t * 0.4);
        let cd = abs(qa.x) * 0.866 + abs(qa.y) * 0.5;
        let inside = smoothstep(0.62, 0.58, max(cd, abs(qa.y)));
        let facet = 0.6 + 0.4 * sin(qa.x * 9.0 + qa.y * 7.0 + t * 0.8);
        g = mix(vec3f(0.02, 0.01, 0.02), vec3f(0.75, 0.18, 0.25) * facet, inside);
        g += vec3f(1.6, 0.9, 0.7) * pow(max(0.0, facet - 0.75) * 4.0, 2.0) * inside;
      } else if (st == 3) {
        // ONE DAY — a sky that keeps its whole day
        let ph = fract(t * 0.05);
        let el = sin(ph * 6.28318) * 0.8;
        let day = smoothstep(-0.2, 0.4, el);
        g = mix(vec3f(0.02, 0.02, 0.06), vec3f(0.25, 0.5, 0.8), day * (0.5 - q.y * 0.5));
        g = mix(g, vec3f(0.9, 0.4, 0.15), smoothstep(0.3, 0.0, abs(el)) * max(0.0, -q.y + 0.2) * 0.9);
        let sun = vec2f(cos(ph * 6.28318 - 1.57) * 0.6, -el * 0.55 + 0.1);
        g += vec3f(3.0, 2.0, 0.9) * exp(-dot(q - sun, q - sun) * 60.0) * max(day, 0.15);
        if (q.y > 0.25) { g = mix(g, g * vec3f(0.5, 0.6, 0.8), 0.6); }   // the sea below
      } else if (st == 4) {
        // SAIL — one boat, one sea
        g = mix(vec3f(0.35, 0.5, 0.65), vec3f(0.05, 0.14, 0.2), smoothstep(-0.1, 0.5, q.y));
        let w = sin(q.x * 9.0 + t * 1.4) * 0.05;
        g = mix(g, vec3f(0.03, 0.10, 0.14), smoothstep(w + 0.02, w - 0.02, -q.y + 0.1) * 0.0 + smoothstep(w - 0.02, w + 0.06, q.y - 0.05));
        let sail = max(max(-(q.x + 0.05) * 3.0, q.y + 0.15), (q.x * 0.9 + q.y * 0.8) - 0.28);
        g = mix(g, vec3f(1.0, 0.96, 0.88), smoothstep(0.02, -0.02, sail));
      } else if (st == 5) {
        // SOLSTICE — a sun you carry over a valley
        g = vec3f(0.03, 0.04, 0.09);
        let sp = vec2f(sin(t * 0.5) * 0.45, -0.3 + cos(t * 0.5) * 0.12);
        g += vec3f(3.2, 2.2, 0.9) * exp(-dot(q - sp, q - sp) * 40.0);
        let hill = q.y - (0.25 + 0.15 * sin(q.x * 3.0 + 1.0));
        let lit = max(0.0, 1.0 - length(q - sp) * 1.4);
        g = mix(g, mix(vec3f(0.03, 0.05, 0.02), vec3f(0.15, 0.3, 0.08), lit), smoothstep(-0.02, 0.02, hill));
      } else if (st == 6) {
        // TIDERUNNER — wind over water
        let band = sin(q.y * 14.0 - t * 1.1 + sin(q.x * 4.0) * 0.7);
        g = mix(vec3f(0.05, 0.13, 0.17), vec3f(0.12, 0.25, 0.3), 0.5 + 0.5 * band);
        g += vec3f(0.8, 0.85, 0.85) * pow(max(0.0, band - 0.8) * 5.0, 2.0) * 0.4;
        let bt = q - vec2f(sin(t * 0.4) * 0.4, 0.0);
        g += vec3f(0.9, 0.85, 0.75) * exp(-dot(bt, bt) * 300.0) * 1.2;
      } else if (st == 7) {
        // SIGNAL — a television waiting for a word
        let sn = hash21(floor(q * 24.0) + floor(t * 9.0));
        g = vec3f(sn * 0.5);
        g += vec3f(0.3, 1.0, 0.45) * exp(-dot(q, q) * 8.0) * (0.28 + 0.14 * sin(t * 2.0));
        g *= 0.82 + 0.18 * sin(q.y * 60.0 - t * 8.0);
      } else if (st == 99) {
        // its shader icon is still rendering — a quiet sweeping spinner, not a
        // default planet, so a loading bubble reads as "on its way"
        let ang = atan2(q.y, -q.x);
        let rd = length(q);
        let ring = smoothstep(0.09, 0.0, abs(rd - 0.5));
        let sweep = fract(ang / 6.2831 + t * 0.7);
        let comet = smoothstep(0.0, 0.55, sweep) * smoothstep(1.0, 0.55, sweep);
        let cA = 0.5 + 0.5 * cos(6.2831 * (hue + vec3f(0.0, 0.33, 0.67)));
        g = vec3f(0.02, 0.02, 0.03) + cA * ring * (0.12 + comet * 1.3);
      } else if (st >= 9) {
        // a real world — its screenshot, folded into the bubble by the shader.
        // A BIG (champion) bubble insets its icon so it doesn't fill edge-to-edge
        // and read as oversized next to the category glyphs.
        g = cafeIcon(st - 9, q * select(1.0, 1.32, big > 0));
        g *= 0.9 + 0.2 * (1.0 - length(q));   // gentle spherical shading
      } else {
        // a young world — a banded seed-planet in its own hue
        let cA = 0.5 + 0.5 * cos(6.2831 * (hue + vec3f(0.0, 0.33, 0.67)));
        g = cA * (0.22 + 0.5 * fbm3(q * 3.0 + vec2f(t * 0.08, f32(i) * 3.7)));
        g += cA * 0.4 * smoothstep(0.6, 1.0, 1.0 - abs(q.y * 2.2 + 0.3 * sin(q.x * 3.0 + t * 0.4)));
        let mn = q - vec2f(cos(t * 0.5 + f32(i) * 1.9), sin(t * 0.5 + f32(i) * 1.9) * 0.6) * 0.78;
        g += vec3f(0.85) * exp(-dot(mn, mn) * 260.0);
        g *= 0.85 + 0.3 * (1.0 - length(q));
      }
      // (the head-count number is gone — presence is the dancing players now)
      // glass edge + hover bloom — the top three wear their OWN rim colors:
      // champion solar gold, SUB-MAINS sky blue, PLAYER WORLDS spring green
      let edge = smoothstep(1.0, 0.86, length(q));
      col = mix(col, g, edge);
      var rim = vec3f(1.2, 0.85, 0.4);
      var rimBase = 0.25;
      if (bigBand == 1) { rim = vec3f(1.5, 1.0, 0.3); rimBase = 0.45; }
      else if (bigBand == 2) { rim = vec3f(0.45, 0.75, 1.55); rimBase = 0.45; }
      else if (bigBand == 3) { rim = vec3f(0.4, 1.45, 0.65); rimBase = 0.45; }
      else if (bigBand == 4) { rim = vec3f(1.4, 0.75, 0.35); rimBase = 0.45; }
      if (isBranch) { rim = vec3f(0.30, 0.62, 1.75); rimBase = 0.6; }        // BRANCH — a blue outline on the round bubble
      if (isPlayerWorld) { rim = vec3f(0.40, 1.45, 0.65); rimBase = 0.5; }   // PLAYER WORLD — a green rim (matches the PLAYER WORLDS door)
      col += rim * exp(-pow((length(q) - 0.97) * 9.0, 2.0)) * (rimBase + hov * 1.3);
      // THE DOCK ⚓ — a slow-breathing double ring outside the rim: you are moored here
      if (isDocked) {
        let breathe = 0.6 + 0.4 * sin(t * 1.6);
        col += vec3f(0.55, 0.95, 1.05) * exp(-pow((length(q) - 1.12) * 24.0, 2.0)) * breathe * 0.9;
        col += vec3f(0.35, 0.80, 0.95) * exp(-pow((length(q) - 1.24) * 30.0, 2.0)) * breathe * 0.5;
      }
    } else {
      // halo when hovered
      col += vec3f(1.0, 0.7, 0.3) * exp(-pow((d - rr) * 22.0, 2.0)) * hov * 0.8;
    }
    // ── the maker's handle, curved along the bottom rim (white bitmap caption) ──
    // chars packed 12/bubble in the population buffer; glyphs sit radially in a
    // thin band just off the rim, upright (top toward centre), reading L→R across
    // the bottom arc. System bubbles have no author → nlen 0 → nothing drawn.
    {
      let charH = R * 0.22;
      let namR0 = rr + R * 0.05;
      let namR1 = namR0 + charH;
      if (d > namR0 && d < namR1) {
        var nlen = 0;
        for (var cc = 0; cc < 16; cc++) {
          if (cf_popc(i, cc) == 0) { break; }
          nlen = cc + 1;
        }
        if (nlen > 0) {
          let dA = (charH * (5.0 / 7.0)) / namR0;      // arc angle per monospace char
          let halfArc = f32(nlen) * dA * 0.5;
          let ang = atan2(uv.x - ctr.x, uv.y - ctr.y);  // 0 = straight down, + toward right
          if (abs(ang) < halfArc) {
            let tg = (ang + halfArc) / dA;
            let jc = i32(floor(tg));
            let ul = fract(tg);
            let vl = (d - namR0) / charH;
            let cov = char5x7(vec2f(ul, vl), cf_popc(i, jc));
            col = mix(col, vec3f(1.0, 1.0, 1.0), cov * (0.7 + hov * 0.3));
          }
        }
      }
    }
    // presence players HOVER at the edge — half inside, half out — so they draw
    // in a band that spills BEYOND the disc, not clipped by the d<rr face mask.
    // Additive onto col; the SMALL scale of the cursor's big roaming effect.
    // One player per real occupant (headCount), up to 6.
    if (d < rr * 1.6) {
      let ql = (uv - ctr) / rr;                              // disc-local; >1 outside the bubble
      let nP = min(headCount, 6);
      for (var k = 0; k < nP; k++) {
        let ga = f32(k) * 2.39996 + f32(i) * 1.7;            // static seat around the rim
        let orb = vec2f(cos(ga), sin(ga));
        let plocal = (ql - orb) * 3.2;                       // seat ON the rim (radius 1.0), spilling out
        let hueK = 0.5 + 0.5 * cos(6.2831 * (f32(k) * 0.16 + vec3f(0.0, 0.33, 0.67)));
        let ph = t * 1.5 + f32(k) * 1.3 + f32(i) * 0.7;      // each dances on its own beat
        col += cf_player(plocal, orb, ph, 0, hueK * 1.6) * 1.8; // hold the seat, dance in place
      }
    }
    // NEW-WORLD PIP — a small bright dot on the upper-right rim of any world this
    // browser has not entered yet (unvisited, decoded above). It clears the moment
    // you visit. Drawn outside the face mask so it rides ON the rim, like the crown.
    if (unvisited) {
      let dotC = ctr + vec2f(R * 0.60, -R * 0.60);
      let dd = length(uv - dotC);
      let pulse = 0.75 + 0.25 * sin(t * 3.0 + f32(i));
      col += vec3f(0.55, 1.0, 0.82) * (smoothstep(R * 0.16, R * 0.09, dd) * 1.7 + exp(-pow(dd / (R * 0.20), 2.0)) * 0.45) * pulse;
    }
  }

  // the CROWN, over everything — a small gold crown resting on the champion's
  // brow (no ring, no halo — just the crown)
  for (var i = 0; i < i32(uni(3) + 0.5); i++) {
    let sv = uni(8 + i * 4);
    let sr = i32(floor(sv));
    let abc = sr % 400;
    if (abc < 200) { continue; }        // crown flag lives in the 200 band, under the big band
    let bigc = sr / 400;
    let ctr = vec2f((uni(6 + i * 4) - cam.x) * zm / 256.0, (uni(7 + i * 4) - cam.y) * zm / 256.0);
    let R = 0.098 * zm * select(1.0, 1.25, bigc > 0);
    // SOLAR CROWN — a small sun-forged crown above the brow: molten gold body,
    // breathing corona, rays flaring off the teeth
    let cp = (uv - (ctr + vec2f(0.0, -R * 1.28))) / (R * 0.38);
    if (abs(cp.x) < 2.2 && cp.y > -2.2 && cp.y < 1.4) {
      // three teeth: a triangle wave over the band, tips pointing up (soft edges)
      let teeth = 1.0 - abs(fract(cp.x * 1.5 + 0.5) - 0.5) * 2.0;
      let topY = -0.12 - teeth * 0.88;
      let m = smoothstep(1.04, 0.98, abs(cp.x)) * smoothstep(topY - 0.06, topY + 0.05, cp.y) * smoothstep(0.55, 0.45, cp.y);
      // molten gold: banded shimmer rolling across the metal
      let molten = 0.75 + 0.25 * sin(cp.x * 7.0 - t * 2.6) * sin(cp.y * 5.0 + t * 1.9);
      let gold = mix(vec3f(0.85, 0.55, 0.12), vec3f(1.0, 0.9, 0.5), clamp(0.5 - cp.y * 0.6, 0.0, 1.0)) * molten;
      col = mix(col, gold, m);
      // corona: the whole crown breathes light like a low sun
      let bd = length(vec2f(cp.x * 0.62, cp.y + 0.25));
      col += vec3f(1.0, 0.72, 0.28) * exp(-bd * bd * 2.6) * (0.16 + 0.05 * sin(t * 1.7)) * (1.0 - m);
      // rays flaring off the three tips
      for (var k = -1; k <= 1; k++) {
        let jp = cp - vec2f(f32(k) * 0.667, -1.0);
        let jd = length(jp);
        let ja = atan2(jp.y, jp.x);
        let flare = 0.5 + 0.5 * sin(ja * 6.0 + t * 2.4 + f32(k) * 2.1);
        col += vec3f(1.0, 0.95, 0.72) * exp(-jd * jd * 30.0) * (0.55 + 0.35 * flare);
        col += vec3f(1.0, 0.85, 0.45) * exp(-jd * 6.0) * flare * 0.22;
      }
    }
  }

  // the local player — the "you" roaming the open grid, dancing in place. Its
  // look/hue/size are BREWED: read from the uniform tail (packed after all the
  // bubbles, so bubble offsets never move). fx, hue, size = uni(sb, sb+1, sb+2).
  let sb = 6 + i32(uni(3) + 0.5) * 4;
  // fx -1 = a custom BREWED GLYPH field is riding the cursor instead — the
  // preset dance (and its soft core) stands down. round(), not +0.5: the old
  // truncation folded -1 back to 0 and the comet haunted the glyph.
  let selfFx = i32(round(uni(sb)));
  let selfHue = uni(sb + 1);
  let selfSize = max(uni(sb + 2), 0.25);
  let selfTint = 0.5 + 0.5 * cos(6.2831 * (selfHue + vec3f(0.0, 0.33, 0.67)));
  if (selfFx == 5) {
    // DEFAULT CURSOR — nothing brewed yet: a small stylized pointer whose TIP
    // sits on the real pointer position (local origin), mixed OVER the scene.
    // Brewed looks (presets 0-4, custom glyphs) are untouched.
    let dc = cf_defcursor((uv - mp) * (10.0 / selfSize), t * 1.6);
    col = mix(col, dc.rgb, dc.a);
  } else if (selfFx >= 0) {
    col += cf_player((uv - mp) * (4.5 / selfSize), vec2f(0.0, 1.0), t * 1.6, selfFx, selfTint * 1.3) * 1.1;
    col += selfTint * 0.9 * exp(-dot(uv - mp, uv - mp) * 1400.0) * 0.4;   // a soft core in your hue
  } else {
    // BREWED GLYPH — the player's own WGSL fills the mod_playerglyph container
    // (a no-op until the engine swaps it in). Same seat as the presets, but a
    // tighter cell: a glyph fills its whole cell to |uv|=1, so the preset scale
    // read twice as large as intended. 9.0 ≈ a cursor-sized icon at size 1.
    // The distance guard is the frame budget: only pixels inside the cell pay
    // for the glyph at all — user code can be arbitrarily fancy without taxing
    // the other ~99% of the screen.
    let gd = uv - mp;
    let gcell = selfSize / 9.0;
    if (dot(gd, gd) < gcell * gcell * 1.1) {
      let gl = mod_playerglyph(gd * (9.0 / selfSize), t);
      col += gl.rgb * clamp(gl.a, 0.0, 1.0) * 1.5;
    }
  }

  // the OTHER players — their live cursors, dancing, so you see them move around
  // the cafe. Packed after the self-icon: count at sb+3, then (x, y, hue, seat)
  // each. seat >= 0 means their BREWED GLYPH sits in that mod_pg slot — draw
  // their real icon; seat -1 is the comet everyone starts as.
  let ob = sb + 3;
  let nOthers = i32(uni(ob) + 0.5);
  for (var k = 0; k < nOthers; k++) {
    let opos = vec2f(uni(ob + 1 + k * 4), uni(ob + 2 + k * 4));
    let ohue = uni(ob + 3 + k * 4);
    let oseat = i32(round(uni(ob + 4 + k * 4)));
    let otint = 0.5 + 0.5 * cos(6.2831 * (ohue + vec3f(0.0, 0.33, 0.67)));
    if (oseat >= 0) {
      // their glyph, slightly smaller than your own (13 vs your 9) — same
      // distance guard: only pixels inside their cell run their code
      let od = uv - opos;
      let ocell = 1.0 / 13.0;
      if (dot(od, od) < ocell * ocell * 1.2) {
        var og = vec4f(0.0);
        if (oseat == 0) { og = mod_pg0(od * 13.0, t); }
        else if (oseat == 1) { og = mod_pg1(od * 13.0, t); }
        else { og = mod_pg2(od * 13.0, t); }
        col += og.rgb * clamp(og.a, 0.0, 1.0) * 1.4;
      }
    } else {
      // un-brewed player: the SAME default pixel arrow you wear, tinted by their
      // hue so players still read apart. A touch smaller than your own (12 vs
      // your 10). The white body takes the tint; the dark outline stays dark.
      let dc = cf_defcursor((uv - opos) * 12.0, t * 1.6);
      col = mix(col, dc.rgb * (0.45 + otint), dc.a);
    }
  }

  if (col.x != col.x || col.y != col.y || col.z != col.z) { col = vec3f(0.01); }
  return vec4f(clamp(col, vec3f(0.0), vec3f(60.0)), 1.0);
}`

const HOOK = `
try {
  const wd = sim.worldData
  // a fresh session keeps the universe (positions are shared, live for all
  // players) but must drop per-session state: a stashed portalSig matches its
  // own frozen layout and would mute the doors forever, and a stashed
  // 'launched' latch would keep them mute after returning from a world.
  if (wd.__fresh) {
    delete wd.__fresh
    if (wd.__cu) {
      const R = wd.__cu
      R.portalSig = null; R.lastHover = -1; R.prevDown = false; R.kN = {}
      R.launched = 0; R.drag = 0; R.pollT = 0; R.sharedAt = 0
    }
  }
  // wake starts 0: a joining player adopts the shared universe at rest —
  // only real perturbations (a birth, a chant shift, a filter flip) wake it
  if (!wd.__cu || wd.__cu.v !== 2) wd.__cu = { v: 2, bubbles: {}, order: [], cam: { x: 256, y: 256, z: 1 },
    pollT: 0, wake: 0, mineKey: '', drag: 0, dx: 0, dy: 0, downX: 0, downY: 0, moved: 0, prevDown: false, lastHover: -1, kN: {} }
  const U = wd.__cu
  if (!U.boot) U.boot = Date.now()
  // CALM BOOT: for the first seconds, arrivals adopt the shared layout without
  // waking the field — the load must show the live state, never a guess that
  // then re-packs. (First poll runs with 700ms patience fallbacks; the 2s
  // re-poll's fuller data used to jolt every bubble.)
  const calmBoot = Date.now() - U.boot < 8000
  const dt2 = Math.min(dt, 0.05)
  // ── whose universe? MY WORLDS flips the door into a personal submain ──
  const MF = (typeof window !== 'undefined' && window.__cafeMine && window.__cafeMine.on) ? window.__cafeMine : null
  // PLAYER WORLDS — a big front-door bubble opens a filter of just the player-made
  // worlds (the same scene, spaces only). window.__cafePlayers carries the flag.
  // PLAYER WORLDS filter: 0 off · 1 makers directory · 'house' the house shelf
  const PLv = (typeof window !== 'undefined' && window.__cafePlayers) || 0
  const PL = PLv ? 1 : 0
  const HOUSE = PLv === 'house'
  // SUB-MAIN: the group layer. Every user can found ONE named sub-main —
  // a /group formation, not a world. The viewer shows only sub-mains (yours
  // at the heart); entering one morphs this same universe into the group's
  // shelf. window.__cafeSub carries the slug while inside a group.
  const SUB = !!wd.__submain
  const subKey = SUB ? String((typeof window !== 'undefined' && window.__cafeSub) || '') : ''
  const mineKey = MF ? String(MF.handle || MF.ownerId || MF.who || '') : PL ? (HOUSE ? 'house' : 'players') : (SUB ? 'sub:' + subKey : '')
  // every mode keeps its OWN persisted layout, so a joining player or a reload
  // adopts it AT REST instead of replaying the rim fly-in: main = the shared
  // universe, MY WORLDS = per-deed, SUB-MAIN = per-group (or the viewer roster).
  const layoutSlot = MF ? ('cafe:universe:mine:' + mineKey)
    : PL ? ('cafe:universe:' + (HOUSE ? 'house' : 'players'))
    : SUB ? ('cafe:universe:' + mineKey)
    : 'cafe:universe'
  // a filter/mode flip loads a DIFFERENT saved layout: re-poll now and clear the
  // adopt-watermark so the new slot is taken at rest. NO forced wake — if that
  // layout is saved the bubbles land settled; only a genuinely new world (the
  // newborn branch) wakes the field, so unchanged rosters never re-animate.
  if (U.mineKey !== mineKey) { U.mineKey = mineKey; U.pollT = 0; U.hintedEmpty = false; U.sharedAt = 0
    // NESTED PRESENCE (web/docs/presence-nesting-spec.md) — emit this view's
    // location path on view change (deduped by mineKey, no React-state lag). The
    // shell keys the live-cursor room off it. STEP 1: only PLAYER WORLDS acts on
    // this (the confirmed bleed); main + sub-mains keep their current rooms.
    if (typeof window !== 'undefined') {
      const path = MF ? 'main/mine/' + mineKey
        : PL ? (HOUSE ? 'main/players/house' : 'main/players')
        : SUB ? (subKey ? 'main/subs/sub:' + subKey : 'main/subs')
        : 'main'
      window.dispatchEvent(new CustomEvent('cafe:presence', { detail: { path } }))
    }
    // SNAP: a mode flip re-centers the view on the new roster instantly. Without
    // this the camera keeps wherever main was panned/zoomed, so MY WORLDS opens
    // off in a corner and never "arrives".
    U.cam.x = 256; U.cam.y = 256; U.cam.z = 1; U.drag = 0 }
  // a poke = the shell just changed a shelf; re-poll now instead of waiting
  const poke = (typeof window !== 'undefined' && window.__cafePoke) || 0
  if (poke > (U.pokeAt || 0)) { U.pokeAt = poke; U.pollT = 0 }
  const STYLE_OF = { 'FABRIC': 0, 'ORRERY': 1, 'GARNET': 2, 'ONE DAY': 3, 'SAIL': 4, 'SOLSTICE': 5, 'TIDERUNNER': 6, 'SIGNAL': 7 }
  const hueOf = n => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 997; return (h % 100) / 100 }
  const angOf = n => { let h = 0; for (const c of n) h = (h * 37 + c.charCodeAt(0)) % 9973; return (h % 628) / 100 }

  // ── the universe breathes: poll the shelf; newborns arrive at the edge ──
  U.pollT -= dt2
  if (U.pollT <= 0) {
    // the FIRST fill must not wait for the slow web: scene list and layout
    // are local and fast; spaces/scores/crowns ride Neon and can take seconds
    // on a cold start. Race them against a short patience on the first pass —
    // doors (and their tooltips) appear immediately; a quick re-poll enriches.
    const firstFill = U.order.length === 0
    // a HIDDEN tab polls nothing — background tabs were keeping Neon compute
    // awake all night. 30s cadence when visible: the shelf changes slowly.
    if (!firstFill && typeof document !== 'undefined' && document.visibilityState === 'hidden') { U.pollT = 10; return }
    U.pollT = firstFill ? 2 : 30
    ;(async () => {
      try {
        const now = Date.now()
        const patience = (pr, fb) => firstFill
          ? Promise.race([pr, new Promise(res => setTimeout(() => res(fb), 700))])
          : pr
        const [sc, sp, sl, uvr, tvr, smr, snr] = await Promise.all([
          fetch('/api/engine/scene?action=list').then(r => r.json()),
          patience(fetch('/api/spaces/browse').then(r => r.json()).catch(() => ({ spaces: null })), { spaces: null }),
          patience(fetch('/api/engine/save?action=list').then(r => r.json()).catch(() => ({ slots: [] })), { slots: [] }),
          fetch('/api/engine/save?slot=' + encodeURIComponent(layoutSlot)).then(r => r.json()).catch(() => null),
          (MF || SUB || PL) ? Promise.resolve(null) : patience(fetch('/api/engine/save?slot=tournament%3Amain').then(r => r.json()).catch(() => null), null),
          SUB ? fetch('/api/engine/save?slot=submains%3Aindex').then(r => r.json()).catch(() => null) : Promise.resolve(null),
          // SUMMONED bubbles (main only): time-boxed visibility overrides —
          // POST /api/hub/summon writes them; the roster honors them below
          (MF || SUB || PL) ? Promise.resolve(null) : fetch('/api/hub/summon').then(r => r.json()).catch(() => null),
        ])
        const cellAt = {}
        for (const s of (sl.slots || [])) {
          if (s.slot.startsWith('cell:')) cellAt[s.slot.slice(5)] = s.savedAt
        }
        // one universe, every screen: the shared layout is truth; adopt any
        // arrangement newer than the one we last saw (including our own saves)
        const shared = (uvr && uvr.data && uvr.data.v === 3 && uvr.data.bubbles) ? uvr.data : null
        const adopt = (shared && shared.at > (U.sharedAt || 0)) ? shared : null
        if (adopt) U.sharedAt = adopt.at
        if (mineKey !== U.mineKey) return   // filter flipped mid-flight; stale poll
        const want = {}
        if (SUB) {
          const who = (typeof window !== 'undefined' && window.__cafeWho) || null
          const idx = (smr && smr.data && smr.data.v === 1 && smr.data.subs) ? smr.data.subs : {}
          if (!subKey) {
            // the viewer: every sub-main is a bubble; yours sinks to the heart,
            // the rest rank by how many have gathered there
            for (const slug of Object.keys(idx)) {
              const G2 = idx[slug]
              if (!G2 || !G2.name) continue
              want[String(G2.name).toUpperCase()] = { launch: 'sub:' + slug, style: 8,
                mineSub: !!(who && G2.ownerId === who.id), heat: Object.keys(G2.members || {}).length }
            }
          } else {
            // inside a group: its shelf — the worlds its members pinned
            const G2 = idx[subKey]
            const shelf = (G2 && G2.shelf) || {}
            for (const n of Object.keys(shelf)) {
              const e = shelf[n]
              if (!e || !e.launch) continue
              want[n] = { launch: e.launch, style: STYLE_OF[n] ?? 8 }
            }
          }
          // tell the shell where we stand — it draws FOUND / JOIN / PIN.
          // ONLY on a real answer: a failed subs-index fetch (smr null) or a
          // not-yet-resolved identity briefly reads as "not a member, founded
          // nothing" — the shell's buttons were flashing to those wrong states
          // and back on every degraded poll. Silence keeps the last true state.
          const smrReal = !!(smr && smr.data)
          const whoReady = typeof window === 'undefined' || window.__cafeWho !== undefined
          if (typeof window !== 'undefined' && smrReal && whoReady) {
            const G3 = subKey ? idx[subKey] : null
            const detail = {
              mode: subKey ? 'group' : 'viewer',
              slug: subKey || null,
              name: G3 ? G3.name : null,
              haveOwn: !!(who && Object.keys(idx).some(s3 => idx[s3] && idx[s3].ownerId === who.id)),
              ownSlug: (who && Object.keys(idx).find(s3 => idx[s3] && idx[s3].ownerId === who.id)) || null,
              member: !!(who && G3 && G3.members && G3.members[who.id]),
              owner: !!(who && G3 && G3.ownerId === who.id),
              pinsLocked: !!(G3 && G3.pinsLocked),
              members: G3 ? (G3.members || {}) : {},
              ownerId: G3 ? (G3.ownerId || null) : null,
              admins: G3 ? (G3.admins || []) : [],
              bans: G3 ? (G3.bans || {}) : {},
              shelf: G3 ? Object.keys(G3.shelf || {}) : [],
            }
            const sig2 = JSON.stringify(detail)
            if (sig2 !== U.lastSubmodeSig) {
              U.lastSubmodeSig = sig2
              window.dispatchEvent(new CustomEvent('cafe:submode', { detail }))
            }
          }
        } else if (MF) {
          // personal submain: only worlds on this player's deed —
          // their brews (blank drafts included) and their branches, newest version each
          const best = {}
          for (const n of (sc.scenes || [])) {
            const f = n.indexOf(' \u2442 ')
            const vAt = n.lastIndexOf(' \u00b7 v')
            if (f < 0 || vAt < f) continue
            // the AUTHOR is the first token after the \u2442, before any label \u2014 match
            // it by handle (works for another maker's deed) OR the legacy who.
            // (slicing to vAt kept the label attached, so labeled branches never
            //  matched \u2014 this also makes them show, which #14 wanted.)
            const author = n.slice(f + 3).split(' \u00b7 ')[0]
            if (author !== MF.who && author !== MF.handle) continue
            const v = parseInt(n.slice(vAt + 4), 10) || 0
            const base = n.slice(0, vAt)
            if (!best[base] || v > best[base].v) best[base] = { v, scene: n, style: STYLE_OF[n.slice(0, f)] ?? 8 }
          }
          for (const base of Object.keys(best)) {
            want[base] = { launch: best[base].scene, style: best[base].style, square: 1, author: (best[base].scene.split(' ⑂ ')[1] || '').split(' · ')[0].trim() }   // a BRANCH reads as a square, distinct from a round world
          }
          // canonical worlds ASSIGNED to me (scene-makers) belong on my deed too
          const mineAttr = (sp && sp.sceneMakers) || {}
          for (const n of Object.keys(mineAttr)) {
            if (mineAttr[n] && mineAttr[n].handle === MF.handle && !want[n]) {
              want[n] = { launch: n, style: STYLE_OF[n] ?? 8 }
            }
          }
          for (const s of (sp.spaces || [])) {
            // match by ownerId (your own deed) OR handle (viewing another maker)
            if (!s.owner || (s.owner.id !== MF.ownerId && s.owner.handle !== MF.handle)) continue
            // an unnamed blank DRAFT (still auto-timestamp-named, nothing built)
            // is abandoned scaffolding, not a world — keep it off the deed. Naming
            // a world PATCHes its real name in, so only truly-abandoned drafts
            // still carry the "YYYY-MM-DD HH:MM" stamp. Named or built worlds show.
            if (s.blank && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s.name || '')) continue
            const disp = (s.name || s.slug).toUpperCase()
            if (!want[disp]) want[disp] = { launch: 'space:' + s.slug, style: 8, hue: s.hue, author: (s.owner && s.owner.handle) || '' }
          }
        } else if (HOUSE) {
          // THE HOUSE — everything unassigned to a real maker: the canonical
          // house/AI-made worlds, plus guest-made / unclaimed player spaces.
          const attributed = (sp && sp.sceneMakers) || {}
          for (const n of (sc.scenes || [])) {
            if (n === 'CAFE' || n === 'SUB-MAIN' || n.includes('␂')) continue
            if (n.includes(' ⑂ ')) continue   // branches belong to their author, not the house
            if (attributed[n]) continue        // a canonical world assigned to a maker leaves the house
            want[n] = { launch: n, style: STYLE_OF[n] ?? 8 }
          }
          for (const s of (sp.spaces || [])) {
            if (s.blank || s.building || s.isPublic === false) continue
            const o = s.owner
            if (o && o.handle && !o.isGuest) continue   // a claimed world belongs to its maker, not the house
            const disp = (s.name || s.slug).toUpperCase()
            if (!want[disp]) want[disp] = { launch: 'space:' + s.slug, style: 8, hue: s.hue, author: (s.owner && s.owner.handle) || '' }
          }
        } else if (PL) {
          // PLAYER WORLDS — a MAKERS directory: one bubble per player who has
          // built worlds (opens their space/shelf), plus a HOUSE bubble gathering
          // unclaimed/guest-made worlds.
          // the makers directory comes straight from the browse makers list —
          // one per player, carrying their BREWED ICON (fx preset + hue avatar).
          const makerList = (sp && sp.makers) || []
          for (const m of makerList) {
            const disp = (m.name || m.handle).toUpperCase()
            // fx 0-4 = a brewed preset avatar (rendered as the bubble face);
            // otherwise a living emblem in the player's own hue.
            const style = (typeof m.fx === 'number' && m.fx >= 0 && m.fx <= 4) ? (30 + m.fx) : 8
            want[disp] = { launch: 'maker:' + m.handle, style, hue: m.hue != null ? m.hue : hueOf(m.handle), author: m.handle }
          }
          // THE HOUSE always stands — it holds the canonical AI-made worlds too
          want['THE HOUSE'] = { launch: 'house:', style: 8, hue: 0.09, big: 1, cat: 4 }
        } else {
          for (const n of (sc.scenes || [])) {
            if (n === 'CAFE' || n === 'SUB-MAIN' || n.includes('\u2402')) continue
            if (n.includes(' \u2442 ')) continue
            want[n] = { launch: n, style: STYLE_OF[n] ?? 8 }
          }
          // player-made worlds surface directly on main too, right alongside the
          // canonical worlds and the three big front-door bubbles.
          for (const s of (sp.spaces || [])) {
            if (s.blank || s.building || s.isPublic === false) continue
            const disp = (s.name || s.slug).toUpperCase()
            if (!want[disp]) want[disp] = { launch: 'space:' + s.slug, style: 8, hue: s.hue, author: (s.owner && s.owner.handle) || '' }
          }
          // SUMMONED bubbles — worlds absent from main (private / building /
          // pressure-hidden) that someone summoned via search. Time-boxed by the
          // API (24h TTL); the bubble appears, but entering still runs the
          // world's own access rules. SEARCH-DOCK's glide treats it as native.
          for (const sn of ((snr && snr.summons) || [])) {
            if (!sn || !sn.slug) continue
            const disp = (sn.name || sn.slug).toUpperCase()
            if (!want[disp]) want[disp] = { launch: 'space:' + sn.slug, style: 8, summoned: 1 }
          }
          // THREE big front-door bubbles. SUB-MAINS opens the group layer; PLAYER
          // WORLDS opens the player-made shelf (those worlds collapse behind it
          // instead of crowding main); the CHAMPION is a core world sized big in
          // place below (marked where the crown is set). Fixed positions = anchored.
          // a tight triangle at the heart: CHAMPION at the apex (pinned where the
          // crown is set, below), SUB-MAINS + PLAYER WORLDS along the base.
          // LOCKED center triangle: champion at the apex (seated where the crown
          // lands, below), SUB-MAINS + PLAYER WORLDS along the base. The field
          // clusters around these three; they never drift.
          want['SUB-MAINS'] = { launch: 'SUB-MAIN', style: 8, hue: 0.58, big: 1, cat: 2, fixed: [215, 285] }
          want['PLAYER WORLDS'] = { launch: 'players:', style: 8, hue: 0.34, big: 1, cat: 3, fixed: [297, 285] }
        }
        for (const n of Object.keys(want)) {
          if (!U.bubbles[n]) {
            const sb = shared && shared.bubbles[n]
            if (sb) {
              // this world already has its place in the shared universe
              U.bubbles[n] = { x: (want[n].fixed ? want[n].fixed[0] : sb.x), y: (want[n].fixed ? want[n].fixed[1] : sb.y), vx: 0, vy: 0, justPlaced: 1, anchored: 1, pinned: want[n].fixed ? 1 : 0,
                born: sb.born || now, launch: want[n].launch, style: want[n].style, hue: (want[n].hue != null ? want[n].hue : hueOf(n)), score: 2 }
            } else {
              // truly newborn — spawn on the RIM at the emptiest bearing so it
              // never lands on top of a sibling; packing pressure and score then
              // sort it inward from there (the old center-spawn caused overlaps)
              const others = Object.keys(U.bubbles).map(k => U.bubbles[k]).filter(Boolean)
              let maxR = 40
              const angs = []
              for (const o of others) {
                angs.push(Math.atan2((o.y - 256) / 0.74, o.x - 256))
                maxR = Math.max(maxR, Math.hypot(o.x - 256, (o.y - 256) / 0.74))
              }
              let a2 = angOf(n)
              if (angs.length > 0) {
                angs.sort((p, q) => p - q)
                let widest = -1
                for (let k = 0; k < angs.length; k++) {
                  const lo = angs[k], hi = k + 1 < angs.length ? angs[k + 1] : angs[0] + 6.28318
                  if (hi - lo > widest) { widest = hi - lo; a2 = lo + (hi - lo) / 2 }
                }
              }
              // cap how far out a newborn spawns — an UNSAVED mode (a fresh maker
              // deed) makes every world "newborn", and maxR+78-each spiralled them
              // clear off-screen. Cap keeps the whole batch near the middle.
              const rr = Math.min(maxR + 78, 165)
              U.bubbles[n] = { x: 256 + Math.cos(a2) * rr, y: 256 + Math.sin(a2) * rr * 0.74, vx: 0, vy: 0,
                born: now, launch: want[n].launch, style: want[n].style, hue: (want[n].hue != null ? want[n].hue : hueOf(n)), score: 2 }
              // a birth perturbs the settled field — but not the loading one, UNLESS
              // there's no saved layout to adopt (a fresh deed): then we must pack.
              if (!calmBoot || !shared) U.wake = 10
            }
          }
          const B = U.bubbles[n]
          B.launch = want[n].launch
          B.big = !!want[n].big
          B.square = !!want[n].square   // a branch draws square, not round
          B.author = want[n].author || ''   // maker/owner handle → the rim caption
          B.playerWorld = (B.launch || '').startsWith('space:')   // a player-made world → green rim (its own icon stays)
          B.cat = want[n].cat || 0   // 2 = sub-mains glyph · 3 = player-worlds glyph (own render band, never an icon slot)
          if (want[n].fixed) {   // a locked seat — first pin wakes the field so neighbours clear out
            if (!B.pinned) U.wake = Math.max(U.wake, 5)
            B.x = want[n].fixed[0]; B.y = want[n].fixed[1]; B.vx = 0; B.vy = 0; B.anchored = 1; B.pinned = 1
          }
          if (adopt && adopt.bubbles[n] && !want[n].big) {   // the shared arrangement seats bubbles AT REST — never force-refixes motion
            const sb2 = adopt.bubbles[n]
            // Galen: 'I voted and the bubbles started moving, then were force
            // refixed.' A local reflow (vote, wake, drag) owns the field until it
            // settles; only a still bubble adopts the shared seat.
            const moving = (U.wake > 0) || (Math.abs(B.vx) + Math.abs(B.vy) > 0.02)
            if (!moving) { B.x = sb2.x; B.y = sb2.y; B.vx = 0; B.vy = 0; B.anchored = 1 }
            if (sb2.born) B.born = sb2.born
          }
          // participation pressure: cell activity + birth heat
          const cellAge = cellAt[n] ? (now - cellAt[n]) / 60000 : 999
          const bornHeat = Math.max(0, 1 - (now - B.born) / 120000)
          const T = (tvr && tvr.data && tvr.data.round) ? tvr.data : null
          // the tier a world has climbed — but its pull DECAYS over days without
          // fresh support, so the field clears out on its own (half-life ~3d).
          let reach = T && T.reached ? (T.reached[n] || 0) : 0
          if (reach > 1 && T && T.reachedAt && T.reachedAt[n]) {
            const ageDays = (now - T.reachedAt[n]) / 86400000
            reach = 1 + (reach - 1) * Math.pow(0.5, ageDays / 3)
          }
          // LIVE pressure: every vote cast in the open tier pushes its world
          // toward the crown right now — the constellation moves as people vote,
          // before any tier resolves.
          let live = 0
          if (T && T.cells) for (const c of T.cells) { const v = c.votes || {}; for (const k in v) if (v[k] === n) live++ }
          // the reigning world — or QUANTIC DOJO as the seeded first champion so
          // there's always a starting place until a vote crowns someone.
          const champName = (T && T.champion) || 'QUANTIC DOJO'
          const champ = n === champName
          B.crown = !!champ
          if (champ) {   // the reigning world sits LOCKED at the triangle's apex, wearing the crown
            B.big = true
            if (!B.pinned) U.wake = Math.max(U.wake, 5)
            B.x = 256; B.y = 210; B.vx = 0; B.vy = 0; B.anchored = 1; B.pinned = 1
          } else if (B.pinned && !B.cat) {   // dethroned — rejoin the floating field
            B.pinned = 0; B.anchored = 0; B.big = false
          }
          // NEW vs VOTED: a world that has climbed a tier, holds the crown, or is
          // taking live votes belongs to the voted cluster at center; everything
          // else is a new arrival held in the outer ring. A status flip re-settles
          // it into the other band (un-anchor so it can cross the buffer).
          const nowVoted = live > 0 || reach > 1 || champ || !!B.cat   // the big category bubbles belong to the central cluster too
          if (!B.justPlaced && !!B.voted !== nowVoted) { B.anchored = 0; U.wake = Math.max(U.wake, 7) }
          B.voted = nowVoted
          // a world with a hand-coded style is a house mini. Otherwise: if the
          // engine has rendered this world's OWN visual into an atlas slot, the
          // bubble shows that (the world's real look); else a LIVING EMBLEM in
          // the world's own palette (hue from its field colors). Nothing stored.
          if (want[n].hue != null) B.hue = want[n].hue
          const slots = (typeof window !== 'undefined' && window.__cafeIconSlots) || null
          B.iconSlot = slots && slots[n] != null ? slots[n] : null
          // before the first icon pass lands, an un-styled bubble (style 8) shows
          // a spinner instead of flashing the default emblem
          const ready = (typeof window !== 'undefined') ? window.__cafeIconReady : true
          B.iconLoading = !B.cat && B.style >= 8 && B.style < 30 && !ready   // atlas not uploaded yet: unstyled bubbles wait. Category glyphs (cat) and maker avatars (30-34) draw from the shader — no atlas.
          const ns = SUB
            ? 1 + ((want[n].heat || 0) * 0.5) + (want[n].mineSub ? 100 : 0)
            : 1 / (1 + cellAge / 20) + bornHeat + reach * 1.4 + live * 0.7 + (champ ? 6 : 0)
          // chant shifts perturb — but a bubble just placed from the shared
          // universe getting its first real score is not a shift, it's arrival.
          // Threshold 1.0: only REAL events move the field (a champion crowned
          // ±6, a tier climbed ±1.4, a birth) — the slow decay of heat and cell
          // age drifts scores by less and must NOT reshuffle the room. (At 0.03
          // the field woke on almost every poll and no layout ever held.)
          if (!B.justPlaced && !calmBoot && Math.abs(ns - B.score) > 1.0) U.wake = Math.max(U.wake, 7)
          delete B.justPlaced
          // the big three own the deepest gravity — champion #1, then the two
          // category bubbles — so they sink to the very heart and cluster there.
          B.score = champ ? 40 : (B.cat ? 26 : ns)
        }
        // a degraded first pass only ADDS — pruning waits for the full poll,
        // so a slow spaces fetch can't blink player worlds out and back
        const fullAnswer = Array.isArray(sc && sc.scenes) && Array.isArray(sp && sp.spaces)
        if (!firstFill && fullAnswer) for (const n of Object.keys(U.bubbles)) if (!want[n]) delete U.bubbles[n]
        // NOTHING renders without the roster's word — a stale shared-doc bubble
        // (a world hidden since it was saved) must never get even one frame.
        // On a degraded first pass it just waits in U.bubbles for the full poll.
        U.order = Object.keys(U.bubbles).filter(n => want[n]).sort((a2, b2) => U.bubbles[b2].score - U.bubbles[a2].score).slice(0, 200)
        if ((MF || SUB || PL) && U.order.length === 0 && !U.hintedEmpty && typeof window !== 'undefined') {
          U.hintedEmpty = true
          const emptyText = MF ? 'no worlds on your deed yet - brew yours'
            : HOUSE ? 'the house is empty — no unclaimed worlds right now'
            : PL ? 'no makers yet — sign up and brew the first world'
            : (subKey ? 'an empty shelf — members can pin worlds here' : 'no sub-mains yet — found yours')
          window.dispatchEvent(new CustomEvent('cafe:caption', { detail: { text: emptyText, kind: 'hint' } }))
        }
        if (!MF && !SUB && !PL) U.hintedEmpty = false
      } catch (e2) { /* shelf unreachable — the universe holds its shape */ }
    })()
  }

  // VOTE NUDGE — a completed vote (window.__cafeVoteNudge, stamped by the
  // tournament bar) briefly brings the whole field alive: un-anchor every
  // floating icon and give each a small deterministic kick, then wake the sim.
  // The settle block below re-anchors and re-saves the layout once everyone
  // comes to rest — unfreeze a beat, physics takes over, refreeze when settled.
  const voteNudge = (typeof window !== 'undefined' && window.__cafeVoteNudge) || 0
  if (voteNudge > (U.nudgeAt || 0) && U.order && U.order.length) {
    U.nudgeAt = voteNudge
    for (const n of U.order) {
      const B = U.bubbles[n]
      if (!B || B.pinned) continue          // pinned seats (doors / champion) hold their place
      B.anchored = 0
      const h = Math.sin(B.x * 12.9898 + B.y * 78.233 + voteNudge * 0.001) * 43758.5453
      const f = h - Math.floor(h)           // deterministic 0..1 (the file uses no Math.random)
      const a = f * 6.2831853
      const s = 9 + f * 6                    // ~9–15 impulse
      B.vx += Math.cos(a) * s
      B.vy += Math.sin(a) * s
    }
    U.wake = Math.max(U.wake, 1.4)           // ~1s of physics, then the settle block freezes + saves
  }

  // ── gravity with friction: everyone falls toward the middle, packing
  // pressure sorts them — the strongest chant sinks deepest. The sim only
  // runs while perturbed (a birth, a score shift); then friction locks it. ──
  if (U.wake > 0) {
    U.wake -= dt2
    const fr = Math.exp(-3.4 * dt2)
    let maxV = 0   // track the fastest bubble this frame — the field isn't "settled" until everyone has nearly stopped
    // NEW-vs-VOTED banding — MAIN ONLY. MY WORLDS / SUB-MAIN have no votes, so
    // there every world just clusters at center (banded = false). On main the
    // voted worlds pack the middle; new arrivals are held in an outer ring one
    // BUFFER (90) beyond the voted cluster's edge, so the two groups read clearly.
    const banded = !MF && !SUB && !PL   // only MAIN bands (voted center vs new ring); every other view just clusters + settles
    let votedR = 40
    if (banded) for (const n of U.order) { const B = U.bubbles[n]; if (B && B.voted) votedR = Math.max(votedR, Math.hypot(B.x - 256, B.y - 256)) }
    const ringR = Math.max(votedR + 90, 170)
    // Seats (category doors, champion, lone world) are pinned ONCE at roster
    // time; the pinned flag is now honored by every force so they hold on their
    // own — no per-frame reassert. This block only ESTABLISHES a pin the roster pass
    // may have missed (a lone world adopted from a stale shared layout), so a
    // freshly-joined tab still lands them locked before its first poll.
    const FIXEDSEAT = (!MF && !SUB && !PL) ? { 'SUB-MAINS': [215, 285], 'PLAYER WORLDS': [297, 285] } : null
    const lone = (MF || SUB || PL) && U.order.length === 1
    for (let i = 0; i < U.order.length; i++) {
      const B = U.bubbles[U.order[i]]
      if (!B) continue
      const seat = FIXEDSEAT && FIXEDSEAT[U.order[i]]
      if (seat && !B.pinned) { B.x = seat[0]; B.y = seat[1]; B.vx = 0; B.vy = 0; B.anchored = 1; B.pinned = 1 }
      else if (lone && !B.pinned) { B.x = 256; B.y = 256; B.vx = 0; B.vy = 0; B.anchored = 1; B.pinned = 1 }
      // an ANCHORED bubble came from the saved layout: it holds its exact place
      // as a fixed repulsor, so a newborn (or a late-loading world) settles into
      // the gaps WITHOUT dragging the arrangement everyone already sees.
      // PINNED means immovable — full stop. Forces and integration must honor it
      // the same way the floor correction and crown collider already do. Without
      // this, a bubble that gets un-anchored (line: voted-status flip) while
      // staying pinned — exactly what happens the frame a champion is crowned —
      // would accelerate and drift free until the next poll snapped it back.
      if (!B.anchored && !B.pinned) {
        const dx = 256 - B.x, dy = 256 - B.y
        const dd = Math.hypot(dx, dy) || 1
        if (banded && !B.voted) {
          // a new arrival springs to the outer ring: pushed OUT if it's inside the
          // buffer, pulled IN if it drifted past — the gap to the voted cluster holds
          const err = ringR - dd
          B.vx += (B.x - 256) / dd * err * 0.6 * dt2
          B.vy += (B.y - 256) / dd * err * 0.6 * dt2
        } else if (dd > 2) {
          const g = 26 * (0.5 + B.score * 2.2)   // participation breaks past friction
          B.vx += dx / dd * g * dt2
          B.vy += dy / dd * g * dt2
        }
      }
      for (let j = i + 1; j < U.order.length; j++) {
        const C = U.bubbles[U.order[j]]
        if (!C) continue
        let sx = B.x - C.x, sy = B.y - C.y
        let sd = Math.hypot(sx, sy)
        if (sd < 0.5) { sx = Math.cos(angOf(U.order[i])); sy = Math.sin(angOf(U.order[i])); sd = 1 }
        // a BIG bubble clears a wider berth so the field makes space around it.
        // Anchored (pinned) big bubbles push neighbours out but never move themselves.
        // ONE collision rule for every bubble — same class, sized by each one's
        // own radius (big ≈ 31u, small ≈ 25u) plus a constant breathing gap.
        const rSum = (B.big ? 31 : 25) + (C.big ? 31 : 25)
        // a big bubble keeps EXTRA distance from the field so its click zone is clear
        const clr = rSum + ((B.big || C.big) ? 50 : 28)
        if (sd < clr) {
          const push = (clr - sd) * 9 * dt2
          if (!B.anchored) { B.vx += sx / sd * push; B.vy += sy / sd * push }
          if (!C.anchored) { C.vx -= sx / sd * push; C.vy -= sy / sd * push }
        }
        // HARD floor: enforce a real GAP (not just no-overlap) as a direct position
        // correction, so even a SETTLED / adopted layout keeps its breathing room —
        // the soft velocity push only spaces things while they're moving. Moves
        // anchored bubbles too; only the PINNED three are immovable.
        const floor = rSum + ((B.big || C.big) ? 32 : 10)
        if (sd < floor) {
          const over = floor - sd, nx = sx / sd, ny = sy / sd
          if (!B.pinned && !C.pinned) { B.x += nx * over * 0.5; B.y += ny * over * 0.5; C.x -= nx * over * 0.5; C.y -= ny * over * 0.5 }
          else if (!B.pinned) { B.x += nx * over; B.y += ny * over }
          else if (!C.pinned) { C.x -= nx * over; C.y -= ny * over }
        }
      }
      // the CROWN is a physical object: an invisible collider above the champion's
      // brow — nothing may drift over it. (Champion sits pinned at 256,210; the
      // crown rides ~42u above with an ~18u radius.)
      if (!MF && !SUB && !PL && !B.pinned) {   // main commons only — that's where the champion reigns
        const kx = B.x - 256, ky = B.y - (210 - 42)
        const kr = 18 + (B.big ? 31 : 25)
        const kd = Math.hypot(kx, ky)
        if (kd < kr && kd > 0.01) { B.x += kx / kd * (kr - kd); B.y += ky / kd * (kr - kd) }
      }
      if (!B.anchored && !B.pinned) {
        B.vx *= fr; B.vy *= fr
        B.x += B.vx * dt2; B.y += B.vy * dt2
        const v = Math.abs(B.vx) + Math.abs(B.vy)
        if (v > maxV) maxV = v
      }
    }
    // don't lock mid-flight: if anything is still moving, keep the sim awake so
    // the field reaches rest (a big crowd like THE HOUSE needs time to pack in).
    // Cap the reprieve so a pathological jitter can't run forever.
    if (maxV > 3 && U.wake <= 0 && (U.settleGuard = (U.settleGuard || 0) + dt2) < 12) U.wake = 0.2
    if (U.wake <= 0) {
      U.settleGuard = 0   // friction locks them in place — and the whole field is
      // now the saved layout, so everything anchors: a later newborn moves alone.
      for (const n of U.order) { const B = U.bubbles[n]; if (B) { B.vx = 0; B.vy = 0; B.anchored = 1 } }
      // the settled arrangement becomes everyone's: publish it to THIS mode's
      // layout slot so every player (and every reload) adopts it at rest. MY
      // WORLDS and SUB-MAIN each persist too now, so they stop flying in.
      if (U.order.length > 0) {
        const at = Date.now()
        U.sharedAt = at
        const out = {}
        for (const n of Object.keys(U.bubbles)) {
          const B = U.bubbles[n]
          if (B) out[n] = { x: Math.round(B.x * 10) / 10, y: Math.round(B.y * 10) / 10, born: B.born }
        }
        fetch('/api/engine/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot: layoutSlot, data: { v: 3, at, bubbles: out } }) }).catch(() => {})
      }
    }
  }

  // ── exploring: drag empty space to pan · Z/X to zoom ──
  const kE = k => { const n = wd['key_' + k + '_n'] || 0; const was = U.kN[k] || 0; U.kN[k] = n; return n > was }
  if (kE('z')) { U.cam.z = Math.min(2.4, U.cam.z * 1.25); U.zoomHold = 0.28 }
  if (kE('x')) { U.cam.z = Math.max(0.35, U.cam.z / 1.25); U.zoomHold = 0.28 }
  U.zoomHold = Math.max(0, (U.zoomHold || 0) - dt2)
  const hasM = wd.mouse_x !== undefined
  const mgx = wd.mouse_x ?? 256, mgy = wd.mouse_y ?? 256
  const down = !!wd.mouse_down
  // cursor in universe coords
  // SEARCH-DOCK (Galen): the shell's search bar sets window.__cafeGoto; the hook
  // glides the camera to that bubble and DOCKS the player there (⚓ ring, packed
  // +8000). Dock survives reloads via sessionStorage; cross-shelf goto is picked
  // up on the destination shelf's next boot (cc-goto).
  if (typeof window !== 'undefined') {
    const goto2 = window.__cafeGoto
    if (goto2 && goto2.at !== U.gotoAt) {
      U.gotoAt = goto2.at
      const found = U.order.find(n => n === goto2.name || (U.bubbles[n] && U.bubbles[n].launch === goto2.launch))
      if (found) {
        U.gotoName = found; U.dockName = found
        try { sessionStorage.setItem('cc-dock', found) } catch { /* private mode */ }
      } else if (goto2.launch) {
        try { sessionStorage.setItem('cc-goto', JSON.stringify(goto2)) } catch { /* fine */ }
      }
    }
    if (!U.dockBooted) {
      U.dockBooted = 1
      try {
        const pend = JSON.parse(sessionStorage.getItem('cc-goto') || 'null')
        if (pend) {
          const found = U.order.find(n => n === pend.name || (U.bubbles[n] && U.bubbles[n].launch === pend.launch))
          if (found) { U.gotoName = found; U.dockName = found; sessionStorage.removeItem('cc-goto'); sessionStorage.setItem('cc-dock', found) }
        }
        if (!U.dockName) { const d = sessionStorage.getItem('cc-dock'); if (d && U.bubbles[d]) U.dockName = d }
      } catch { /* fine */ }
    }
  }
  // glide toward the searched bubble, zooming in as we arrive
  if (U.gotoName) {
    const GB = U.bubbles[U.gotoName]
    if (GB) {
      U.cam.x += (GB.x - U.cam.x) * Math.min(1, dt * 4)
      U.cam.y += (GB.y - U.cam.y) * Math.min(1, dt * 4)
      U.cam.z += (1.7 - U.cam.z) * Math.min(1, dt * 3)
      if (Math.hypot(GB.x - U.cam.x, GB.y - U.cam.y) < 2 && Math.abs(U.cam.z - 1.7) < 0.06) U.gotoName = null
    } else U.gotoName = null
  }
  const cux = U.cam.x + (mgx - 256) / U.cam.z
  const cuy = U.cam.y + (mgy - 256) / U.cam.z
  // NEAREST door within reach wins. The old test ("< 30" with a self-cancelling
  // zoom term) let a FARTHER door — whichever came last in draw order — claim the
  // hover whenever two hit-circles overlapped, so the tooltip named/linked the
  // wrong world. Picking the closest makes the name + click-target match the icon
  // the cursor is actually on.
  // BIG bubbles win outright when the cursor is inside their disc — they're the
  // navigation anchors and a tightly-packed neighbour must never steal their click.
  let hovered = -1, best = 1.0
  for (let i = 0; i < U.order.length; i++) {
    const B = U.bubbles[U.order[i]]
    if (!B) continue
    const d = Math.hypot(cux - B.x, cuy - B.y)
    if (B.big && d < 34) { hovered = i; best = -1; break }   // inside a big disc: claim it, stop looking
    const nd = d / (B.big ? 38 : 30)
    if (best >= 0 && nd < best) { best = nd; hovered = i }
  }
  if (down && !U.prevDown) { U.downX = mgx; U.downY = mgy; U.dx = mgx; U.dy = mgy; U.moved = 0; U.drag = hovered < 0 ? 1 : 0 }
  if (down && U.drag) {
    U.cam.x -= (mgx - U.dx) / U.cam.z
    U.cam.y -= (mgy - U.dy) / U.cam.z
    U.moved += Math.abs(mgx - U.dx) + Math.abs(mgy - U.dy)
  }
  // TETHER: the map has an edge. Never let the camera stray past the field into
  // empty void — the pan limit is the OUTERMOST world's distance from center
  // plus a margin, so you can always reach the edge worlds but not drag off into
  // blankness. Adapts to each mode (dense main vs a sparse MY WORLDS) and runs
  // every frame, so zooms and snaps stay inside it too.
  let fieldR = 60
  for (let i = 0; i < U.order.length; i++) {
    const B = U.bubbles[U.order[i]]
    if (B) fieldR = Math.max(fieldR, Math.hypot(B.x - 256, B.y - 256))
  }
  const maxOff = fieldR + 200
  const ox = U.cam.x - 256, oy = U.cam.y - 256
  const od = Math.hypot(ox, oy)
  if (od > maxOff) { U.cam.x = 256 + ox / od * maxOff; U.cam.y = 256 + oy / od * maxOff }
  U.dx = mgx; U.dy = mgy
  if (!down && U.prevDown) {
    if (hovered >= 0 && U.moved < 8 && typeof window !== 'undefined') {
      const B = U.bubbles[U.order[hovered]]
      if (B) {
        // stepping into a WORLD goes quiet (a late portals dispatch would
        // follow the player in) — but entering a sub-main morphs this same
        // scene, so the doors keep speaking
        // sub: and players: are IN-SCENE morphs — the universe keeps speaking;
        // only a real departure (loading another world) goes quiet
        // sub: · players: · house: are IN-SCENE morphs — the universe keeps
        // speaking; only a real departure (loading a world/profile) goes quiet
        const lm = String(B.launch)
        if (lm.slice(0, 4) !== 'sub:' && lm !== 'players:' && lm !== 'house:') U.launched = 1
        window.dispatchEvent(new CustomEvent('cafe:launch', { detail: B.launch }))
      }
    }
    U.drag = 0
  }
  U.prevDown = down
  if (!U.launched && hovered !== U.lastHover && typeof window !== 'undefined') {
    U.lastHover = hovered
    window.dispatchEvent(new CustomEvent('cafe:hover', { detail: hovered >= 0 ? U.order[hovered] : null }))
  }

  // ── tell the shell where the doors are (uv space) — it pins the hover
  // tooltip and live head-counts there. Sent when cam or layout moves, and
  // re-announced every 2s regardless: the shell drops portal events during
  // scene changes, so a one-shot could be lost forever ──
  U.portalT = (U.portalT || 0) - dt2
  if (typeof window !== 'undefined') {
    // live geometry EVERY tick: the shell's thumbnail layer reads this in its
    // own rAF loop so world-face inlays stay welded to the shader's bubbles
    // through pans and zooms (events are too slow — they ride React state)
    window.__cafeBubbles = U.launched ? [] : U.order.map(n => {
      const B = U.bubbles[n]
      return B && { name: n, x: (B.x - U.cam.x) * U.cam.z / 256, y: (B.y - U.cam.y) * U.cam.z / 256, r: 0.098 * U.cam.z * (B.big ? 1.25 : 1) }
    }).filter(Boolean)
    // DOM chrome (count chips) can't share the canvas's frame, so it visibly
    // lags the shader during motion. Flag when the camera is moving; the shell
    // hides the chips until it settles, where their placement is pixel-exact.
    window.__cafeCamMoving = (U.wake > 0 || (down && U.drag) || U.zoomHold > 0) ? 1 : 0
  }
  if (!U.launched && typeof window !== 'undefined') {
    let sig = ((U.cam.x * 10) | 0) + '|' + ((U.cam.y * 10) | 0) + '|' + ((U.cam.z * 100) | 0)
    for (const n of U.order) { const B = U.bubbles[n]; if (B) sig += '|' + n + ':' + ((B.x * 10) | 0) + ',' + ((B.y * 10) | 0) }
    if (sig !== U.portalSig || U.portalT <= 0) {
      U.portalSig = sig
      U.portalT = 2
      window.dispatchEvent(new CustomEvent('cafe:portals', {
        detail: U.order.map(n => {
          const B = U.bubbles[n]
          return B && { name: n, launch: B.launch, x: (B.x - U.cam.x) * U.cam.z / 256, y: (B.y - U.cam.y) * U.cam.z / 256, r: 0.098 * U.cam.z * (B.big ? 1.25 : 1) }
        }).filter(Boolean),
      }))
    }
  }

  // the group layer speaks for itself when empty — with or without shell UI
  if (SUB) {
    wd.hud = U.order.length ? [] : [{
      id: 'sm_empty', type: 'text', x: '22%', y: '46%',
      text: subKey ? 'an empty shelf \u2014 JOIN, then + PIN A WORLD (top center)'
                   : 'no sub-mains yet \u2014 \u2302 FOUND YOURS (top center) starts the first',
      color: '#c9b370', fontSize: '14px',
    }]
  }

  // ── publish: cam, count, cursor(uv), then (x, y, style+hue, headCount) per bubble ──
  // stride 4 now — the 4th value is the live head-count, drawn IN the bubble by
  // the shader (the shell fills window.__cafeCounts from /api/presence)
  const heads = (typeof window !== 'undefined' && window.__cafeCounts) || {}
  const visited = (typeof window !== 'undefined' && window.__cafeVisited) || {}
  // STEP 3 NESTING dock-count: a bubble shows an orb for everyone AT or BELOW the
  // child it leads to. Its launch → the child's canonical path; the count is the
  // prefix-rollup of the heartbeat paths (window.__cafeCounts, keyed by location
  // path). So descending into a sub-main shows on main's SUB-MAINS bubble AND on
  // that sub-main's own bubble in the directory. Player worlds live under
  // main/players so they nest regardless of which shelf opened them.
  const countKeys = Object.keys(heads)
  const childPathOf = (lz) => {
    lz = lz || ''
    if (lz === 'players:') return 'main/players'
    if (lz === 'house:') return 'main/players/house'
    if (lz === 'SUB-MAIN') return 'main/subs'
    if (lz.startsWith('sub:')) return 'main/subs/sub:' + lz.slice(4)
    if (lz.startsWith('space:')) return 'main/players/space:' + lz.slice(6)
    if (lz.startsWith('maker:')) return null   // a profile page, not a presence node
    if (lz && lz !== 'CAFE' && lz !== 'SUB-MAIN') return 'main/world:' + lz   // a core/house world bubble
    return null
  }
  const rollup = (cp) => { if (!cp) return 0; let s = 0; for (const k of countKeys) if (k === cp || k.startsWith(cp + '/')) s += heads[k] || 0; return s }
  const u = [U.cam.x, U.cam.y, U.cam.z, U.order.length, (mgx - 256) / 256, (mgy - 256) / 256]
  // author captions: pack each bubble's maker handle (16 chars = 4 vec4f) into the
  // population buffer, in U.order — the shader reads pop(i*3..) and draws it curved
  // along the bubble's bottom rim (char5x7). System bubbles have no author → blank.
  const pop = []   // flat entities only (4 floats each) — the renderer adds the count header
  for (const n of U.order) {
    const B = U.bubbles[n]
    const au = String(B.author || '').toUpperCase().slice(0, 16)
    for (let c = 0; c < 16; c++) pop.push(c < au.length ? (au.charCodeAt(c) & 0xff) : 0)
    // st>=9 → the world's own visual, rendered into atlas slot (st-9). else the
    // house mini (0-7) or living emblem (8), tinted by the world's hue.
    const styleInt = (!B.iconLoading && B.iconSlot != null && B.iconSlot >= 0) ? (9 + B.iconSlot) : (B.iconLoading ? 99 : B.style)
    const frac = (B.iconSlot != null && B.iconSlot >= 0) ? 0 : Math.min(0.999, B.hue != null ? B.hue : 0)
    const band = B.cat ? B.cat * 400 : (B.big ? 400 : 0)   // 800 sub-mains · 1200 player-worlds · 400 champion-big · 0 normal
    // a world bubble the browser hasn't entered gets a +1000 flag on its head
    // float → the shader draws a "new" pip. Nav bubbles (sub/maker/players/house)
    // and CAFE/SUB-MAIN never count as unvisited worlds.
    const lz = B.launch || ''
    const unvis = !!lz && !lz.startsWith('sub:') && !lz.startsWith('maker:') && !lz.startsWith('players:') && !lz.startsWith('house:') && lz !== 'CAFE' && lz !== 'SUB-MAIN' && !visited[lz]
    // docked orbs = who's AT or BELOW the child this bubble leads to (nesting):
    // main's PLAYER WORLDS/SUB-MAINS bubbles, a sub-main's bubble in the directory,
    // a world's bubble on its shelf. Live DOM cursors still show peers standing at
    // THIS level. NEST off → legacy (main only, keyed by bubble name).
    const nestOff = typeof window !== 'undefined' && window.__ccNestOff
    const showHeads = nestOff ? ((!MF && !SUB && !PL) ? (heads[n] || 0) : 0) : rollup(childPathOf(lz))
    u.push(B.x, B.y, band + (B.crown ? 200 : 0) + styleInt + frac, Math.min(99, showHeads) + (unvis ? 1000 : 0) + (B.square ? 2000 : 0) + (B.playerWorld ? 4000 : 0) + (n === U.dockName ? 8000 : 0))
  }
  // the local player's BREWED icon, packed at the tail (fx, hue, size) — read by
  // the shader at 6 + bubbleCount*4, so it never collides with the bubble stride
  const ic = (typeof window !== 'undefined' && window.__cafeIcon) || {}
  // BREWED GLYPH: when the engine has swapped the player's own WGSL into the
  // shader's mod_playerglyph container, fx packs as -1 — the shader draws the
  // glyph in the preset's seat and the preset stands down.
  // no brewed fx at all (icon state not landed yet) = 5, the default cursor
  u.push(wd.__glyphOn === 1 ? -1 : (typeof ic.fx === 'number' ? ic.fx | 0 : 5), typeof ic.hue === 'number' ? ic.hue : 0.55, typeof ic.size === 'number' ? ic.size : 1.0)
  // On MAIN the dancing shader orbs ARE the presence — suppress the DOM pips so
  // they don't double up. On the directory / sub-mains we do the OPPOSITE: no
  // docked orbs (heads packed 0 above), and let the DOM pips draw LIVE cursors.
  wd.noPresenceCursors = !MF && !SUB && !PL
  // other players — positions are already smoothly interpolated upstream (entity
  // interpolation in the engine's presence loop), so just pack them. Screen coords
  // (256 = center). Capped so we never overrun the 96-float buffer.
  const others = Array.isArray(wd.presence) ? wd.presence : []
  const cap = Math.max(0, Math.min(others.length, 12, Math.floor((256 - u.length - 1) / 4)))
  u.push(cap)
  for (let k = 0; k < cap; k++) {
    const o = others[k] || {}
    // stride 4: x, y, hue, glyph seat (mod_pg0-2 in the shader; -1 = comet)
    const sl = Number.isFinite(o.slot) ? o.slot : -1
    u.push((Number(o.x) - 256) / 256, (Number(o.y) - 256) / 256, ((Number(o.hue) || 0) % 360) / 360, sl)
  }
  wd.gpuUniforms = u
  wd.gpuPopulation = pop   // U.order.length*4 entities (4 vec4f names per bubble)
} catch (e) { /* keep the door open */ }
`

const scene = {
  name: 'CAFE',
  fields: [
    {
      id: 'cf_world_f', name: 'CAFE',
      color: [0.01, 0.01, 0.03, 1],
      effects: [], memory: [], proximity: [], properties: {},
      transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
      shapeType: 'rect', w: 512, h: 512,
      visualTypeName: 'cf_world',
    },
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    instructions: 'THE CAFE — a universe of worlds\n\nDRAG empty space to pan · Z / X to zoom\nHOVER a bubble to hear its name · CLICK to enter\n\nThe strongest chant sinks to the middle: bubbles cluster by participation, and newborn worlds glow hot before settling.\n\nMY WORLDS (top right) flips this into your own universe — every world on your deed, drafts included. BREW YOURS starts a new one.',
  },
  stepHooks: [{ id: 'cafe_door', author: 'fable', description: 'CAFE: hover-bloom portals, click to step through', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [{ name: 'cf_world', wgsl: WORLD }],
  // the BREWED GLYPH containers: no-ops the engine swaps for real cursor WGSL.
  // playerglyph = YOUR icon (from cafe:icon); pg0-2 = up to three OTHER
  // players' icons, arriving over presence. The shader calls them at cursors.
  modules: [
    { name: 'playerglyph', wgsl: 'fn mod_playerglyph(uv: vec2f, t: f32) -> vec4f { return vec4f(0.0); }' },
    { name: 'pg0', wgsl: 'fn mod_pg0(uv: vec2f, t: f32) -> vec4f { return vec4f(0.0); }' },
    { name: 'pg1', wgsl: 'fn mod_pg1(uv: vec2f, t: f32) -> vec4f { return vec4f(0.0); }' },
    { name: 'pg2', wgsl: 'fn mod_pg2(uv: vec2f, t: f32) -> vec4f { return vec4f(0.0); }' },
  ],
  timestamp: Date.now(),
}

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/CAFE.json'), JSON.stringify(scene, null, 1))
console.log('CAFE bundled to public/cartridges/CAFE.json')

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'CAFE', scene }),
})
console.log('CAFE saved:', res.status, await res.text())

// ── SUB-MAIN: the same navigation world, but its shelf is the branches.
// One cartridge, two doors: worldData.__submain flips the hook's roster.
const subScene = {
  ...scene,
  name: 'SUB-MAIN',
  fields: [{ ...scene.fields[0], id: 'cf_submain_f', name: 'SUB-MAIN' }],
  worldData: {
    noPixelSampling: true,
    __submain: 1,
    instructions: 'SUB-MAIN — the group layer\n\nEvery sub-main is a formation someone founded: a named gathering, not a world. Yours holds the center.\nHOVER a bubble to hear its name · CLICK to step into the group\nInside: its shelf — the worlds its members pinned. JOIN to belong, + PIN A WORLD to add to the shelf.\n\nOne sub-main per person — ⌂ FOUND YOURS starts it.\n◂ SUB-MAINS steps back out · ESC climbs home.',
  },
  timestamp: Date.now(),
}
writeFileSync(join(here, '../../../../public/cartridges/SUB-MAIN.json'), JSON.stringify(subScene, null, 1))
const res2 = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'SUB-MAIN', scene: subScene }),
})
console.log('SUB-MAIN saved:', res2.status, await res2.text())
