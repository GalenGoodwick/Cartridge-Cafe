// shooter3 HUD — screen-space overlay for the horror-shooter. No raymarch.
// Exports s3_hud(uv, hp01, ammo, score, dread01) -> vec4f (rgb, alpha); alpha 0
// where nothing is drawn so the integrator can composite it over the world.
//
// uv arrives -1..1 with y DOWN — the engine convention (uv.y=-1 top, +1 bottom;
// see render-core "MATCH THE ENGINE … uv.y increases DOWNWARD"). That already
// matches char5x7 / printInt (p in [0,1]², y DOWN), so s = uv*0.5+0.5 with no
// flip renders glyphs upright. Palette is thin, cold-white ink
// over near-black, with a rising red dread wash so the frame turns ominous as
// dread01 → 1. Legible on black; restrained on a lit scene.

// ── glyph cell helpers (screen coords s: 0..1, y DOWN) ────────────────────
// draw one glyph inside a box; returns coverage 0..1
fn s3_boxChar(s: vec2f, x0: f32, x1: f32, y0: f32, y1: f32, code: i32) -> f32 {
  if (s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1) { return 0.0; }
  let p = vec2f((s.x - x0) / (x1 - x0), (s.y - y0) / (y1 - y0));
  return char5x7(p, code);
}
// draw a right-aligned integer inside a box
fn s3_boxInt(s: vec2f, x0: f32, x1: f32, y0: f32, y1: f32, value: f32, digits: i32) -> f32 {
  if (s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1) { return 0.0; }
  let p = vec2f((s.x - x0) / (x1 - x0), (s.y - y0) / (y1 - y0));
  return printInt(p, value, digits);
}
// one glyph within a monospace run: start x0, cell width cw, index j (0.8 fill)
fn s3_cellChar(s: vec2f, x0: f32, cw: f32, y0: f32, y1: f32, j: i32, code: i32) -> f32 {
  let cx0 = x0 + f32(j) * cw;
  return s3_boxChar(s, cx0, cx0 + cw * 0.82, y0, y1, code);
}

fn s3_hud(uv: vec2f, hp01: f32, ammo: f32, score: f32, dread01: f32) -> vec4f {
  // screen coords, top-left origin, y DOWN — matches the glyph font + engine.
  let s = vec2f(uv.x * 0.5 + 0.5, uv.y * 0.5 + 0.5);
  let hp = clamp(hp01, 0.0, 1.0);
  let dr = clamp(dread01, 0.0, 1.0);

  var col = vec3f(0.0);
  var a = 0.0;

  // ── dread wash: a red vignette that swells from the corners with dread01 ──
  // (built in uv space so it is symmetric regardless of the glyph y-flip)
  {
    let edge = smoothstep(0.55, 1.25, length(uv));   // 0 centre → 1 corners
    // a slow, uneasy pulse so high dread never sits perfectly still
    let breath = 0.82 + 0.18 * sin(uni(0) * 2.1);
    let vig = edge * dr * breath;
    col = vec3f(0.42, 0.02, 0.015) * vig;
    a = vig * 0.65;
  }

  // ── HEALTH BAR — bottom-left, red→green by hp01, dark empty track, frame ──
  {
    let x0 = 0.035; let x1 = 0.315; let y0 = 0.905; let y1 = 0.940;
    if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) {
      let bt = 0.0035;                                          // border thickness
      let border = s.x < x0 + bt || s.x > x1 - bt || s.y < y0 + bt || s.y > y1 - bt;
      let fillX = x0 + (x1 - x0) * hp;
      if (border) {
        col = vec3f(0.55, 0.56, 0.62); a = 0.85;
      } else if (s.x <= fillX) {
        // red at 0 → amber mid → green at full; scale value so low HP reads hot
        let hc = mix(vec3f(0.95, 0.09, 0.06), vec3f(0.16, 0.92, 0.26), smoothstep(0.0, 1.0, hp));
        col = hc * (0.85 + 0.15 * hp); a = 0.92;
      } else {
        col = vec3f(0.05, 0.02, 0.02); a = 0.55;                // depleted track
      }
    }
    // "HP" label just above the bar
    let ly0 = 0.868; let ly1 = 0.898;
    let lc = max(s3_cellChar(s, 0.035, 0.024, ly0, ly1, 0, 72),   // H
                 s3_cellChar(s, 0.035, 0.024, ly0, ly1, 1, 80));  // P
    if (lc > 0.0) { col = vec3f(0.72, 0.74, 0.80); a = lc * 0.9; }
  }

  // ── AMMO — bottom-right, printInt (3 digits), with a small label ──
  {
    let x0 = 0.80; let x1 = 0.965; let y0 = 0.905; let y1 = 0.945;
    let cov = s3_boxInt(s, x0, x1, y0, y1, ammo, 3);
    if (cov > 0.0) { col = vec3f(0.86, 0.88, 0.94); a = cov * 0.95; }
    // "AMMO" label above the count
    let ly0 = 0.868; let ly1 = 0.898;
    let lx0 = 0.80; let cw = 0.026;
    var lab = s3_cellChar(s, lx0, cw, ly0, ly1, 0, 65);   // A
    lab = max(lab, s3_cellChar(s, lx0, cw, ly0, ly1, 1, 77)); // M
    lab = max(lab, s3_cellChar(s, lx0, cw, ly0, ly1, 2, 77)); // M
    lab = max(lab, s3_cellChar(s, lx0, cw, ly0, ly1, 3, 79)); // O
    if (lab > 0.0) { col = vec3f(0.66, 0.68, 0.74); a = lab * 0.85; }
  }

  // ── SCORE — top-right, printInt (6 digits), with a label ──
  {
    let x0 = 0.74; let x1 = 0.965; let y0 = 0.070; let y1 = 0.110;
    let cov = s3_boxInt(s, x0, x1, y0, y1, score, 6);
    if (cov > 0.0) { col = vec3f(0.90, 0.90, 0.95); a = cov * 0.95; }
    // "SCORE" label above the number
    let ly0 = 0.032; let ly1 = 0.062;
    let lx0 = 0.74; let cw = 0.026;
    var lab = s3_cellChar(s, lx0, cw, ly0, ly1, 0, 83);   // S
    lab = max(lab, s3_cellChar(s, lx0, cw, ly0, ly1, 1, 67)); // C
    lab = max(lab, s3_cellChar(s, lx0, cw, ly0, ly1, 2, 79)); // O
    lab = max(lab, s3_cellChar(s, lx0, cw, ly0, ly1, 3, 82)); // R
    lab = max(lab, s3_cellChar(s, lx0, cw, ly0, ly1, 4, 69)); // E
    if (lab > 0.0) { col = vec3f(0.62, 0.63, 0.70); a = lab * 0.82; }
  }

  // ── DREAD METER — thin vertical bar, right edge, fills bottom→top ──
  {
    let x0 = 0.972; let x1 = 0.990; let y0 = 0.32; let y1 = 0.90;
    if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) {
      let fillTop = y1 - (y1 - y0) * dr;                 // fills upward with dread
      if (s.y >= fillTop) {
        let up = (y1 - s.y) / (y1 - y0);                 // 0 bottom → 1 top of bar
        let hot = mix(vec3f(0.55, 0.05, 0.04), vec3f(1.0, 0.28, 0.12), up);
        col = hot; a = 0.9;
      } else {
        col = vec3f(0.06, 0.02, 0.02); a = 0.5;          // empty channel
      }
    }
  }

  // ── CROSSHAIR — thin center cross with a gap, cold-white, reddens w/ dread ──
  {
    let ax = abs(uv.x); let ay = abs(uv.y);
    let th = 0.0038;
    let inR = 0.013; let outR = 0.050;
    let horiz = ay < th && ax > inR && ax < outR;
    let vert  = ax < th && ay > inR && ay < outR;
    let dot   = length(uv) < 0.0028;
    if (horiz || vert || dot) {
      col = mix(vec3f(0.92, 0.95, 1.0), vec3f(1.0, 0.18, 0.12), dr);
      a = 0.9;
    }
  }

  return vec4f(col, clamp(a, 0.0, 1.0));
}
