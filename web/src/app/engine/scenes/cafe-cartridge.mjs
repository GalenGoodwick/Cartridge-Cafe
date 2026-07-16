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
    let st = stRaw % 200;
    let hue = fract(sv);
    let headCount = i32(uni(9 + i * 4) + 0.5);
    let ctr = vec2f((uni(6 + i * 4) - cam.x) * zm / 256.0, (uni(7 + i * 4) - cam.y) * zm / 256.0);
    let d = length(uv - ctr);
    let R = 0.098 * zm;
    let hov = smoothstep(R * 1.9, R * 1.1, length(mp - ctr));
    let rr = R * (1.0 + hov * 0.12);
    if (d < rr) {
      let q = (uv - ctr) / rr;                     // -1..1 inside the disc
      var g = vec3f(0.0);
      if (st == 0) {
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
        // a real world — its screenshot, folded into the bubble by the shader
        g = cafeIcon(st - 9, q);
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
      // glass edge + hover bloom
      let edge = smoothstep(1.0, 0.86, length(q));
      col = mix(col, g, edge);
      col += vec3f(1.2, 0.85, 0.4) * exp(-pow((length(q) - 0.97) * 9.0, 2.0)) * (0.25 + hov * 1.3);
    } else {
      // halo when hovered
      col += vec3f(1.0, 0.7, 0.3) * exp(-pow((d - rr) * 22.0, 2.0)) * hov * 0.8;
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
  }

  // the crown, over everything — the champion's ring outshines its neighbors
  for (var i = 0; i < i32(uni(3) + 0.5); i++) {
    let sv = uni(8 + i * 4);
    if (i32(floor(sv)) < 200) { continue; }
    let ctr = vec2f((uni(6 + i * 4) - cam.x) * zm / 256.0, (uni(7 + i * 4) - cam.y) * zm / 256.0);
    let d = length(uv - ctr);
    let R = 0.098 * zm;
    let ringR = R * 1.24 + sin(t * 2.2) * 0.006;
    col += vec3f(1.0, 0.82, 0.32) * smoothstep(0.012, 0.002, abs(d - ringR)) * 1.3;
    col += vec3f(1.0, 0.7, 0.25) * exp(-max(d - R, 0.0) * 22.0) * 0.4;
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
  if (selfFx >= 0) {
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
  // the cafe. Packed after the self-icon: count at sb+3, then (x, y, hue) each.
  let ob = sb + 3;
  let nOthers = i32(uni(ob) + 0.5);
  for (var k = 0; k < nOthers; k++) {
    let opos = vec2f(uni(ob + 1 + k * 3), uni(ob + 2 + k * 3));
    let ohue = uni(ob + 3 + k * 3);
    let otint = 0.5 + 0.5 * cos(6.2831 * (ohue + vec3f(0.0, 0.33, 0.67)));
    // smaller than your own effect (self is /4.5) — other players read as lesser
    // presence; no center pip, the dance IS the player.
    col += cf_player((uv - opos) * 6.5, vec2f(0.0, 1.0), t * 1.6 + f32(k) * 1.7, 0, otint * 1.3) * 1.05;
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
  const dt2 = Math.min(dt, 0.05)
  // ── whose universe? MY WORLDS flips the door into a personal submain ──
  const MF = (typeof window !== 'undefined' && window.__cafeMine && window.__cafeMine.on) ? window.__cafeMine : null
  // SUB-MAIN: the group layer. Every user can found ONE named sub-main —
  // a /group formation, not a world. The viewer shows only sub-mains (yours
  // at the heart); entering one morphs this same universe into the group's
  // shelf. window.__cafeSub carries the slug while inside a group.
  const SUB = !!wd.__submain
  const subKey = SUB ? String((typeof window !== 'undefined' && window.__cafeSub) || '') : ''
  const mineKey = MF ? String(MF.ownerId || MF.who || '') : (SUB ? 'sub:' + subKey : '')
  if (U.mineKey !== mineKey) { U.mineKey = mineKey; U.pollT = 0; U.wake = 10; U.hintedEmpty = false }
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
    U.pollT = firstFill ? 2 : 8
    ;(async () => {
      try {
        const now = Date.now()
        const patience = (pr, fb) => firstFill
          ? Promise.race([pr, new Promise(res => setTimeout(() => res(fb), 700))])
          : pr
        const [sc, sp, sl, uvr, tvr, smr] = await Promise.all([
          fetch('/api/engine/scene?action=list').then(r => r.json()),
          patience(fetch('/api/spaces/browse').then(r => r.json()).catch(() => ({ spaces: [] })), { spaces: [] }),
          patience(fetch('/api/engine/save?action=list').then(r => r.json()).catch(() => ({ slots: [] })), { slots: [] }),
          (MF || SUB) ? Promise.resolve(null) : fetch('/api/engine/save?slot=cafe%3Auniverse').then(r => r.json()).catch(() => null),
          (MF || SUB) ? Promise.resolve(null) : patience(fetch('/api/engine/save?slot=tournament%3Amain').then(r => r.json()).catch(() => null), null),
          SUB ? fetch('/api/engine/save?slot=submains%3Aindex').then(r => r.json()).catch(() => null) : Promise.resolve(null),
        ])
        const cellAt = {}
        for (const s of (sl.slots || [])) {
          if (s.slot.startsWith('cell:')) cellAt[s.slot.slice(5)] = s.savedAt
        }
        // one universe, every screen: the shared layout is truth; adopt any
        // arrangement newer than the one we last saw (including our own saves)
        const shared = (uvr && uvr.data && uvr.data.v === 2 && uvr.data.bubbles) ? uvr.data : null
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
          // tell the shell where we stand — it draws FOUND / JOIN / PIN
          if (typeof window !== 'undefined') {
            const G3 = subKey ? idx[subKey] : null
            window.dispatchEvent(new CustomEvent('cafe:submode', { detail: {
              mode: subKey ? 'group' : 'viewer',
              slug: subKey || null,
              name: G3 ? G3.name : null,
              haveOwn: !!(who && Object.keys(idx).some(s3 => idx[s3] && idx[s3].ownerId === who.id)),
              member: !!(who && G3 && G3.members && G3.members[who.id]),
              owner: !!(who && G3 && G3.ownerId === who.id),
              pinsLocked: !!(G3 && G3.pinsLocked),
              members: G3 ? (G3.members || {}) : {},
              ownerId: G3 ? (G3.ownerId || null) : null,
              admins: G3 ? (G3.admins || []) : [],
              bans: G3 ? (G3.bans || {}) : {},
              shelf: G3 ? Object.keys(G3.shelf || {}) : [],
            } }))
          }
        } else if (MF) {
          // personal submain: only worlds on this player's deed —
          // their brews (blank drafts included) and their branches, newest version each
          const best = {}
          for (const n of (sc.scenes || [])) {
            const f = n.indexOf(' \u2442 ')
            const vAt = n.lastIndexOf(' \u00b7 v')
            if (f < 0 || vAt < f) continue
            if (n.slice(f + 3, vAt) !== MF.who) continue
            const v = parseInt(n.slice(vAt + 4), 10) || 0
            const base = n.slice(0, vAt)
            if (!best[base] || v > best[base].v) best[base] = { v, scene: n, style: STYLE_OF[n.slice(0, f)] ?? 8 }
          }
          for (const base of Object.keys(best)) {
            want[base] = { launch: best[base].scene, style: best[base].style }
          }
          for (const s of (sp.spaces || [])) {
            if (!s.owner || s.owner.id !== MF.ownerId) continue
            const disp = (s.name || s.slug).toUpperCase()
            if (!want[disp]) want[disp] = { launch: 'space:' + s.slug, style: 8, hue: s.hue }
          }
        } else {
          for (const n of (sc.scenes || [])) {
            if (n === 'CAFE' || n === 'SUB-MAIN' || n.includes('\u2402')) continue
            if (n.includes(' \u2442 ')) continue
            want[n] = { launch: n, style: STYLE_OF[n] ?? 8 }
          }
          for (const s of (sp.spaces || [])) {
            if (s.blank || s.building) continue   // unbuilt / stuck-in-AI worlds stay off main
            const disp = (s.name || s.slug).toUpperCase()
            if (!want[disp]) want[disp] = { launch: 'space:' + s.slug, style: 8, hue: s.hue }
          }
        }
        for (const n of Object.keys(want)) {
          if (!U.bubbles[n]) {
            const sb = shared && shared.bubbles[n]
            if (sb) {
              // this world already has its place in the shared universe
              U.bubbles[n] = { x: sb.x, y: sb.y, vx: 0, vy: 0, justPlaced: 1,
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
              const rr = maxR + 78
              U.bubbles[n] = { x: 256 + Math.cos(a2) * rr, y: 256 + Math.sin(a2) * rr * 0.74, vx: 0, vy: 0,
                born: now, launch: want[n].launch, style: want[n].style, hue: (want[n].hue != null ? want[n].hue : hueOf(n)), score: 2 }
              U.wake = 10   // a birth perturbs the whole field
            }
          }
          const B = U.bubbles[n]
          B.launch = want[n].launch
          if (adopt && adopt.bubbles[n]) {   // the shared arrangement wins
            const sb2 = adopt.bubbles[n]
            B.x = sb2.x; B.y = sb2.y; B.vx = 0; B.vy = 0
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
          const champ = T && T.champion === n
          B.crown = !!champ
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
          B.iconLoading = B.style >= 8 && !ready   // atlas not uploaded yet: NO bubble wears an icon-style (it would sample black)
          const ns = SUB
            ? 1 + ((want[n].heat || 0) * 0.5) + (want[n].mineSub ? 100 : 0)
            : 1 / (1 + cellAge / 20) + bornHeat + reach * 1.4 + live * 0.7 + (champ ? 6 : 0)
          // chant shifts perturb — but a bubble just placed from the shared
          // universe getting its first real score is not a shift, it's arrival
          if (!B.justPlaced && Math.abs(ns - B.score) > 0.03) U.wake = Math.max(U.wake, 7)
          delete B.justPlaced
          B.score = ns
        }
        // a degraded first pass only ADDS — pruning waits for the full poll,
        // so a slow spaces fetch can't blink player worlds out and back
        if (!firstFill) for (const n of Object.keys(U.bubbles)) if (!want[n]) delete U.bubbles[n]
        U.order = Object.keys(U.bubbles).sort((a2, b2) => U.bubbles[b2].score - U.bubbles[a2].score).slice(0, 19)
        if ((MF || SUB) && U.order.length === 0 && !U.hintedEmpty && typeof window !== 'undefined') {
          U.hintedEmpty = true
          const emptyText = MF ? 'no worlds on your deed yet - brew yours'
            : (subKey ? 'an empty shelf — members can pin worlds here' : 'no sub-mains yet — found yours')
          window.dispatchEvent(new CustomEvent('cafe:caption', { detail: { text: emptyText, kind: 'hint' } }))
        }
        if (!MF && !SUB) U.hintedEmpty = false
      } catch (e2) { /* shelf unreachable — the universe holds its shape */ }
    })()
  }

  // ── gravity with friction: everyone falls toward the middle, packing
  // pressure sorts them — the strongest chant sinks deepest. The sim only
  // runs while perturbed (a birth, a score shift); then friction locks it. ──
  if (U.wake > 0) {
    U.wake -= dt2
    const fr = Math.exp(-3.4 * dt2)
    for (let i = 0; i < U.order.length; i++) {
      const B = U.bubbles[U.order[i]]
      if (!B) continue
      const dx = 256 - B.x, dy = 256 - B.y
      const dd = Math.hypot(dx, dy)
      if (dd > 2) {
        const g = 26 * (0.5 + B.score * 2.2)   // participation breaks past friction
        B.vx += dx / dd * g * dt2
        B.vy += dy / dd * g * dt2
      }
      for (let j = i + 1; j < U.order.length; j++) {
        const C = U.bubbles[U.order[j]]
        if (!C) continue
        let sx = B.x - C.x, sy = B.y - C.y
        let sd = Math.hypot(sx, sy)
        if (sd < 0.5) { sx = Math.cos(angOf(U.order[i])); sy = Math.sin(angOf(U.order[i])); sd = 1 }
        if (sd < 76) {   // breathing room: bubbles repel inside 76, not 56
          const push = (76 - sd) * 9 * dt2
          B.vx += sx / sd * push; B.vy += sy / sd * push
          C.vx -= sx / sd * push; C.vy -= sy / sd * push
        }
      }
      B.vx *= fr; B.vy *= fr
      B.x += B.vx * dt2; B.y += B.vy * dt2
    }
    if (U.wake <= 0) {   // friction locks them in place
      for (const n of U.order) { const B = U.bubbles[n]; if (B) { B.vx = 0; B.vy = 0 } }
      // the settled arrangement becomes everyone's: publish it to the shared
      // universe slot so every player (and every reload) sees this layout
      if (!MF && !SUB && U.order.length > 0) {
        const at = Date.now()
        U.sharedAt = at
        const out = {}
        for (const n of U.order) {
          const B = U.bubbles[n]
          if (B) out[n] = { x: Math.round(B.x * 10) / 10, y: Math.round(B.y * 10) / 10, born: B.born }
        }
        fetch('/api/engine/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot: 'cafe:universe', data: { v: 2, at, bubbles: out } }) }).catch(() => {})
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
  const cux = U.cam.x + (mgx - 256) / U.cam.z
  const cuy = U.cam.y + (mgy - 256) / U.cam.z
  let hovered = -1
  for (let i = 0; i < U.order.length; i++) {
    const B = U.bubbles[U.order[i]]
    if (B && Math.hypot(cux - B.x, cuy - B.y) < 30 / Math.max(U.cam.z, 0.001) * U.cam.z ? Math.hypot(cux - B.x, cuy - B.y) < 30 : false) hovered = i
  }
  if (down && !U.prevDown) { U.downX = mgx; U.downY = mgy; U.dx = mgx; U.dy = mgy; U.moved = 0; U.drag = hovered < 0 ? 1 : 0 }
  if (down && U.drag) {
    U.cam.x -= (mgx - U.dx) / U.cam.z
    U.cam.y -= (mgy - U.dy) / U.cam.z
    U.moved += Math.abs(mgx - U.dx) + Math.abs(mgy - U.dy)
  }
  U.dx = mgx; U.dy = mgy
  if (!down && U.prevDown) {
    if (hovered >= 0 && U.moved < 8 && typeof window !== 'undefined') {
      const B = U.bubbles[U.order[hovered]]
      if (B) {
        // stepping into a WORLD goes quiet (a late portals dispatch would
        // follow the player in) — but entering a sub-main morphs this same
        // scene, so the doors keep speaking
        if (String(B.launch).slice(0, 4) !== 'sub:') U.launched = 1
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
      return B && { name: n, x: (B.x - U.cam.x) * U.cam.z / 256, y: (B.y - U.cam.y) * U.cam.z / 256, r: 0.098 * U.cam.z }
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
          return B && { name: n, launch: B.launch, x: (B.x - U.cam.x) * U.cam.z / 256, y: (B.y - U.cam.y) * U.cam.z / 256, r: 0.098 * U.cam.z }
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
  const u = [U.cam.x, U.cam.y, U.cam.z, U.order.length, (mgx - 256) / 256, (mgy - 256) / 256]
  for (const n of U.order) {
    const B = U.bubbles[n]
    // st>=9 → the world's own visual, rendered into atlas slot (st-9). else the
    // house mini (0-7) or living emblem (8), tinted by the world's hue.
    const styleInt = (!B.iconLoading && B.iconSlot != null && B.iconSlot >= 0) ? (9 + B.iconSlot) : (B.iconLoading ? 99 : B.style)
    const frac = (B.iconSlot != null && B.iconSlot >= 0) ? 0 : Math.min(0.999, B.hue != null ? B.hue : 0)
    u.push(B.x, B.y, (B.crown ? 200 : 0) + styleInt + frac, Math.min(99, heads[n] || 0))
  }
  // the local player's BREWED icon, packed at the tail (fx, hue, size) — read by
  // the shader at 6 + bubbleCount*4, so it never collides with the bubble stride
  const ic = (typeof window !== 'undefined' && window.__cafeIcon) || {}
  // BREWED GLYPH: when the engine has swapped the player's own WGSL into the
  // shader's mod_playerglyph container, fx packs as -1 — the shader draws the
  // glyph in the preset's seat and the preset stands down.
  u.push(wd.__glyphOn === 1 ? -1 : (ic.fx | 0), typeof ic.hue === 'number' ? ic.hue : 0.55, typeof ic.size === 'number' ? ic.size : 1.0)
  // the dancing shader effect IS the other player here — suppress the DOM cursor
  // pip that would otherwise draw a dot on top of it
  wd.noPresenceCursors = true
  // other players — positions are already smoothly interpolated upstream (entity
  // interpolation in the engine's presence loop), so just pack them. Screen coords
  // (256 = center). Capped so we never overrun the 96-float buffer.
  const others = Array.isArray(wd.presence) ? wd.presence : []
  const cap = Math.max(0, Math.min(others.length, 8, Math.floor((96 - u.length - 1) / 3)))
  u.push(cap)
  for (let k = 0; k < cap; k++) {
    const o = others[k] || {}
    u.push((Number(o.x) - 256) / 256, (Number(o.y) - 256) / 256, ((Number(o.hue) || 0) % 360) / 360)
  }
  wd.gpuUniforms = u
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
  // the BREWED GLYPH container: a no-op the engine swaps for the player's own
  // WGSL (FieldEngine, on cafe:icon). The world shader calls it at the cursor.
  modules: [{ name: 'playerglyph', wgsl: 'fn mod_playerglyph(uv: vec2f, t: f32) -> vec4f { return vec4f(0.0); }' }],
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
